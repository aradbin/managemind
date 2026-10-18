// Turnstile on store hosts (phase-4-plan §3.15, Q13). The widget lists the
// hostnames it may run on: the store domain covers every store subdomain,
// and each custom domain is added when it becomes active and removed when
// it goes, by the outbox consumer on domain events. A free widget holds 10
// hostnames; a domain that doesn't fit is recorded as not on the widget, and
// that host relies on rate limits alone (the admin shows it).
import type { OutboxEvent, TenantTx } from '@managemind/core';
import {
  cloudflareTurnstileWidget,
  type TurnstileWidgetProvider,
} from '@managemind/providers/turnstile';
import { captureMessage } from '@sentry/cloudflare';
import { sql } from 'drizzle-orm';
import type { Context } from 'hono';
import type pg from 'pg';
import type { AppEnv, Env } from './env';
import { log } from './log';

export const touchesDomains = (event: OutboxEvent) => event.eventType.startsWith('tenant_domain.');

/** The widget, when the site key, the account and a token with Turnstile: Edit are all there. */
export function turnstileWidget(env: Env): TurnstileWidgetProvider | null {
  if (!env.TURNSTILE_SITE_KEY || !env.CF_ACCOUNT_ID || !env.CF_STORE_TOKEN) return null;
  return cloudflareTurnstileWidget({
    accountId: env.CF_ACCOUNT_ID,
    siteKey: env.TURNSTILE_SITE_KEY,
    token: env.CF_STORE_TOKEN,
  });
}

/**
 * Brings the widget in line with one store's domains: active ones on it,
 * the rest off it. Recomputed from the rows, so a redelivery changes nothing.
 */
export async function syncTurnstileHosts(
  client: pg.Client,
  widget: TurnstileWidgetProvider,
  tenantId: string,
): Promise<{ added: string[]; removed: string[]; refused: string[] }> {
  const { rows } = await client.query<{ id: string; hostname: string; status: string }>(
    'select id, hostname, status from platform.tenant_domains where tenant_id = $1',
    [tenantId],
  );
  const active = new Set(rows.filter((r) => r.status === 'active').map((r) => r.hostname));
  const gone = new Set(rows.filter((r) => r.status !== 'active').map((r) => r.hostname));
  const current = await widget.hostnames();
  const kept = current.filter((h) => !gone.has(h) || active.has(h));
  const removed = current.filter((h) => !kept.includes(h));
  const added = [...active].filter((h) => !kept.includes(h));
  let final = kept;
  let refused: string[] = [];
  if (added.length || removed.length) {
    if (await widget.setHostnames([...kept, ...added])) final = [...kept, ...added];
    else {
      // Over the widget's limit: the removals still go through.
      refused = added;
      if (removed.length) await widget.setHostnames(kept);
      log('warn', 'turnstile widget full', { tenant_id: tenantId, refused });
      captureMessage('turnstile widget full: a custom domain relies on rate limits alone', {
        level: 'warning',
        extra: { tenantId, refused },
      });
    }
  }
  for (const r of rows) {
    await client.query('update platform.tenant_domains set turnstile = $2 where id = $1', [
      r.id,
      r.status === 'active' && final.includes(r.hostname),
    ]);
  }
  return { added: added.filter((h) => !refused.includes(h)), removed, refused };
}

/**
 * The site key for a store host, or null when the check is off there: no
 * keys (local development, the API tests), or a custom domain the widget
 * doesn't list. The store domain's subdomains are always on the widget.
 * `onWidget` says whether an active custom domain is listed (null: not one).
 */
export async function turnstileKeyFor(
  env: Env,
  host: string,
  storeDomain: string,
  onWidget: (host: string) => Promise<boolean | null>,
): Promise<string | null> {
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) return null;
  const h = host.toLowerCase();
  if (h === storeDomain || h.endsWith(`.${storeDomain}`)) return env.TURNSTILE_SITE_KEY;
  // A host that isn't a custom domain (a preview's workers.dev host) uses the key.
  const listed = await onWidget(h);
  return listed === false ? null : env.TURNSTILE_SITE_KEY;
}

/** Whether an active custom domain is on the widget, in a store transaction. */
export const domainOnWidget = (tx: TenantTx) => async (host: string) => {
  const { rows } = await tx.db.execute<{ turnstile: boolean }>(
    sql`select turnstile from platform.tenant_domains where hostname = ${host} and status = 'active'`,
  );
  return rows[0] ? rows[0].turnstile : null;
};

/** The site key for the store host a storefront request came through, or null. */
export const shopSiteKey = (c: Context<AppEnv>, tx: TenantTx) =>
  turnstileKeyFor(
    c.env,
    c.req.header('x-forwarded-host') ?? '',
    c.var.config.STORE_DOMAIN,
    domainOnWidget(tx),
  );
