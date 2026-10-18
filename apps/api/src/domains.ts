// Custom domains in the API (phase-3-plan §3.9, ADR 0019): which provider to
// use, the delayed re-checks and the daily re-check. Nothing polls the
// database on a short timer: a new domain gets four delayed queue messages
// (after 1, 5, 15 and 60 minutes), then the daily job checks it once a day
// until it is active or 7 days have passed.
import {
  checkDomain,
  domainsToCheck,
  relayEvents,
  systemActor,
  withTenant,
} from '@managemind/core';
import { createDb, schema } from '@managemind/db';
import { domainProblemEmail } from '@managemind/providers/email';
import {
  type CustomHostnameProvider,
  cloudflareHostnames,
  pendingHostnames,
} from '@managemind/providers/hostnames';
import { AppError } from '@managemind/shared';
import { and, eq } from 'drizzle-orm';
import { createMailer } from './auth/email';
import { queueSink, withClient } from './db';
import { type ApiConfig, type Env, getConfig } from './env';
import { log } from './log';
import { handleSaleEdges, type SaleEdgeMessage } from './sales';

export interface DomainCheckMessage {
  kind: 'domain_check';
  tenantId: string;
  domainId: string;
}

/** Re-checks of a new domain, in seconds after it was added (§3.9). */
export const DOMAIN_CHECK_DELAYS = [60, 300, 900, 3600] as const;

/**
 * Cloudflare for SaaS when the store zone and its token are configured
 * (production); on previews and locally a provider that keeps every domain
 * pending. Production without the token refuses: domains can't work yet.
 */
export function hostnameProvider(env: Env, config: ApiConfig): CustomHostnameProvider {
  if (env.CF_STORE_TOKEN && env.STORE_ZONE_ID) {
    return cloudflareHostnames({ zoneId: env.STORE_ZONE_ID, token: env.CF_STORE_TOKEN });
  }
  if (config.ENVIRONMENT === 'production') {
    throw new AppError('feature_unavailable', { detail: 'custom domains are not set up yet' });
  }
  return pendingHostnames();
}

/** Queues a domain's re-checks; previews have no domain queue and skip them. */
export async function scheduleDomainChecks(env: Env, tenantId: string, domainId: string) {
  if (!env.DOMAINS) return;
  await env.DOMAINS.sendBatch(
    DOMAIN_CHECK_DELAYS.map((delaySeconds) => ({
      body: { kind: 'domain_check' as const, tenantId, domainId },
      contentType: 'json' as const,
      delaySeconds,
    })),
  );
}

/** The DNS records the client adds: the CNAME, and Cloudflare's TXT when it asks for one. */
export function dnsInstructions(
  hostname: string,
  ownership: { name: string; value: string } | null,
  storeDomain: string,
) {
  return [
    { type: 'CNAME' as const, name: hostname, value: `stores.${storeDomain}` },
    ...(ownership ? [{ type: 'TXT' as const, name: ownership.name, value: ownership.value }] : []),
  ];
}

/**
 * The delayed queue: domain re-checks, and scheduled sales' window edges
 * (sales.ts), told apart by `kind`.
 */
export type DelayedMessage = DomainCheckMessage | SaleEdgeMessage;

export async function handleDelayedQueue(
  batch: MessageBatch<DelayedMessage>,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  const sales = batch.messages.filter(
    (m): m is Message<SaleEdgeMessage> => m.body.kind === 'sale_edge',
  );
  const domains = batch.messages.filter(
    (m): m is Message<DomainCheckMessage> => m.body.kind !== 'sale_edge',
  );
  if (sales.length) await handleSaleEdges(sales, env, ctx);
  if (domains.length) await handleDomainQueue({ ...batch, messages: domains }, env, ctx);
}

/** Delayed re-checks: a domain no longer pending needs nothing more. */
export async function handleDomainQueue(
  batch: Pick<MessageBatch<DomainCheckMessage>, 'messages'>,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  const config = getConfig(env);
  let provider: CustomHostnameProvider;
  try {
    provider = hostnameProvider(env, config);
  } catch {
    for (const m of batch.messages) m.ack();
    return;
  }
  await withClient(env, ctx, async (client) => {
    for (const message of batch.messages) {
      const { tenantId, domainId } = message.body;
      try {
        const [row] = await createDb(client)
          .select({ status: schema.tenantDomains.status })
          .from(schema.tenantDomains)
          .where(
            and(eq(schema.tenantDomains.id, domainId), eq(schema.tenantDomains.tenantId, tenantId)),
          );
        if (row?.status === 'pending') {
          const result = await withTenant(
            client,
            tenantId,
            (tx) => checkDomain(tx, systemActor, domainId, { provider }),
            {
              afterCommit: (events) =>
                relayEvents(client, events, queueSink(env.OUTBOX)).then(() => {}),
            },
          );
          log('info', 'domain checked', {
            tenant_id: tenantId,
            domain_id: domainId,
            status: result.domain.status,
          });
        }
        message.ack();
      } catch (e) {
        log('error', 'domain check failed', {
          tenant_id: tenantId,
          domain_id: domainId,
          error: String(e),
        });
        message.retry({ delaySeconds: 60 });
      }
    }
  });
}

/**
 * The daily re-check (§3.9): one list call for the whole zone, then every
 * pending and active domain against it. Pending ones become active or, after
 * 7 days, failed; an active one that broke is flagged, and its store's
 * owners are emailed once.
 */
export async function recheckDomains(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  client: Parameters<Parameters<typeof withClient>[2]>[0],
): Promise<{ checked: number; flagged: number }> {
  const config = getConfig(env);
  if (!(env.CF_STORE_TOKEN && env.STORE_ZONE_ID)) return { checked: 0, flagged: 0 };
  const provider = hostnameProvider(env, config);
  const rows = await domainsToCheck(createDb(client));
  if (!rows.length) return { checked: 0, flagged: 0 };
  const states = new Map((await provider.list()).map((s) => [s.ref, s]));
  const mailer = createMailer(env, config, ctx);
  let flagged = 0;
  for (const row of rows) {
    const state = row.providerRef ? (states.get(row.providerRef) ?? null) : null;
    const result = await withTenant(
      client,
      row.tenantId,
      (tx) => checkDomain(tx, systemActor, row.id, { provider, state }),
      {
        afterCommit: (events) => relayEvents(client, events, queueSink(env.OUTBOX)).then(() => {}),
      },
    );
    if (!result.newlyFlagged) continue;
    flagged++;
    const owners = await client.query<{ email: string; locale: 'bn' | 'en'; store: string }>(
      `select u.email, u.locale, t.name as store
         from platform.memberships m join platform.users u on u.id = m.user_id
         join platform.tenants t on t.id = m.tenant_id
        where m.tenant_id = $1 and m.role = 'owner'`,
      [row.tenantId],
    );
    for (const owner of owners.rows) {
      mailer.sendLater(
        {
          to: owner.email,
          ...domainProblemEmail({
            locale: owner.locale,
            platformName: config.PLATFORM_NAME,
            storeName: owner.store,
            domain: result.domain.hostname,
            problem: result.domain.failureReason ?? '',
            link: `https://${config.ADMIN_HOST ?? config.PLATFORM_DOMAIN}/settings/domains`,
          }),
        },
        'domain_problem',
      );
    }
  }
  log('info', 'domains rechecked', { checked: rows.length, flagged });
  return { checked: rows.length, flagged };
}
