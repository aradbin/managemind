// Custom domains (phase-3-plan §3.9, ADR 0019): a store's own hostname,
// served by the store zone through Cloudflare for SaaS. A domain is pending
// until Cloudflare sees the client's CNAME and issues the certificate, then
// active; after 7 days without that it fails, and can be retried. Owners and
// Managers manage them (`settings.write`, Q10). Every status change writes a
// history row; host changes emit tenant_domain.* events, which update the
// KV host map (ADR 0015) and purge the store's pages (ADR 0018).
//
// The rows live in platform.tenant_domains, which has no RLS: every query
// here filters by the transaction's tenant.
import { schema } from '@managemind/db';
import {
  type CustomHostnameProvider,
  type HostnameState,
  isLive,
} from '@managemind/providers/hostnames';
import { AppError, defineMachine } from '@managemind/shared';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { requireWithinLimit } from '../billing/entitlements';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import { normalizeHost } from './hosts';

const d = schema.tenantDomains;
const h = schema.tenantDomainHistory;

export type DomainStatus = (typeof schema.DOMAIN_STATUSES)[number];

export const domainLifecycle = defineMachine<
  DomainStatus,
  'activate' | 'fail' | 'retry' | 'remove',
  void
>({
  name: 'tenant_domain',
  initial: 'pending',
  states: schema.DOMAIN_STATUSES,
  transitions: {
    pending: { activate: { to: 'active' }, fail: { to: 'failed' }, remove: { to: 'removed' } },
    active: { remove: { to: 'removed' } },
    failed: { activate: { to: 'active' }, retry: { to: 'pending' }, remove: { to: 'removed' } },
  },
});

/** A store has at most 2 domains (§3.9); removed ones don't count. */
export const MAX_DOMAINS = 2;
/** How long a pending domain is checked before it fails. */
export const DOMAIN_CHECK_DAYS = 7;

/** Multi-label public suffixes our clients use, so `shop.com.bd` counts as a bare domain. */
const TWO_LEVEL_SUFFIXES = new Set([
  'com.bd',
  'net.bd',
  'org.bd',
  'edu.bd',
  'gov.bd',
  'ac.bd',
  'info.bd',
  'mil.bd',
  'co.bd',
  'co.uk',
  'org.uk',
  'com.au',
  'co.in',
  'com.my',
  'com.sg',
]);

const HOSTNAME =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** True for a registrable domain without a subdomain: shop.com, shop.com.bd. */
export function isBareDomain(hostname: string): boolean {
  const labels = hostname.split('.');
  const suffix = labels.slice(-2).join('.');
  return labels.length === (TWO_LEVEL_SUFFIXES.has(suffix) ? 3 : 2);
}

export interface DomainRules {
  platformDomain: string;
  storeDomain: string;
}

/** The hostname as stored, or validation_failed with the reason (§3.9, Q9). */
export function checkCustomHostname(input: string, rules: DomainRules): string {
  const hostname = normalizeHost(input)
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const refuse = (code: string, message: string) =>
    new AppError('validation_failed', { fields: [{ path: 'hostname', code, message }] });
  if (!HOSTNAME.test(hostname)) throw refuse('invalid', 'not a valid domain name');
  for (const ours of [rules.platformDomain, rules.storeDomain]) {
    if (hostname === ours || hostname.endsWith(`.${ours}`)) {
      throw refuse('reserved', 'this domain belongs to the platform');
    }
  }
  if (isBareDomain(hostname)) {
    throw refuse(
      'bare_domain',
      `use www.${hostname}, and forward ${hostname} to it at your registrar`,
    );
  }
  return hostname;
}

export interface Domain {
  id: string;
  hostname: string;
  status: DomainStatus;
  isPrimary: boolean;
  sslStatus: string | null;
  /** The TXT record Cloudflare asks for when the client's DNS is on Cloudflare. */
  ownershipRecord: { type: 'TXT'; name: string; value: string } | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  checkAttempts: number;
  /** Why it failed, or what's wrong with an active domain (a flag for the admin). */
  failureReason: string | null;
  /** On the Turnstile widget (phase-4-plan §3.15); off, the host relies on rate limits alone. */
  turnstile: boolean;
  createdAt: string;
}

type Row = typeof d.$inferSelect;

const toDomain = (row: Row): Domain => ({
  id: row.id,
  hostname: row.hostname,
  status: row.status,
  isPrimary: row.isPrimary,
  sslStatus: row.sslStatus,
  ownershipRecord: (row.ownershipRecord as Domain['ownershipRecord']) ?? null,
  verifiedAt: row.verifiedAt?.toISOString() ?? null,
  lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  checkAttempts: row.checkAttempts,
  failureReason: row.failureReason,
  turnstile: row.turnstile,
  createdAt: row.createdAt.toISOString(),
});

async function load(tx: TenantTx, id: string, forUpdate = false): Promise<Row> {
  const query = tx.db
    .select()
    .from(d)
    .where(and(eq(d.id, id), eq(d.tenantId, tx.tenantId), ne(d.status, 'removed')));
  const [row] = await (forUpdate ? query.for('update') : query);
  if (!row) throw new AppError('not_found');
  return row;
}

async function history(
  tx: TenantTx,
  row: Pick<Row, 'id'>,
  from: DomainStatus | null,
  to: DomainStatus,
  actorId: string | null,
  reason?: string,
) {
  await tx.db.insert(h).values({
    tenantId: tx.tenantId,
    domainId: row.id,
    fromStatus: from,
    toStatus: to,
    actorId,
    reason: reason ?? null,
  });
}

/** The store's domains, newest first, without removed ones (`settings.read`). */
export async function listDomains(tx: TenantTx, actor: Actor): Promise<Domain[]> {
  authorize(actor, 'settings.read');
  const rows = await tx.db
    .select()
    .from(d)
    .where(and(eq(d.tenantId, tx.tenantId), ne(d.status, 'removed')))
    .orderBy(desc(d.createdAt));
  return rows.map(toDomain);
}

const providerState = (state: HostnameState) => ({
  providerRef: state.ref,
  sslStatus: state.sslStatus,
  ownershipRecord: state.ownership,
});

/**
 * Adds a domain: refuses our own domains, bare domains, a third domain and a
 * hostname another store has; creates the custom hostname at Cloudflare; and
 * stores it pending. The caller schedules the first checks.
 */
export async function addDomain(
  tx: TenantTx,
  actor: Actor,
  input: { hostname: string },
  deps: DomainRules & { provider: CustomHostnameProvider },
): Promise<Domain> {
  authorize(actor, 'settings.write');
  const hostname = checkCustomHostname(input.hostname, deps);
  const [count] = await tx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(d)
    .where(and(eq(d.tenantId, tx.tenantId), ne(d.status, 'removed')));
  if ((count?.n ?? 0) >= MAX_DOMAINS) throw new AppError('limit_exceeded');
  await requireWithinLimit(tx, 'customDomains', async () => count?.n ?? 0);
  const [taken] = await tx.db
    .select({ id: d.id })
    .from(d)
    .where(and(eq(d.hostname, hostname), ne(d.status, 'removed')));
  if (taken)
    throw new AppError('conflict', { detail: 'this domain is already connected to a store' });

  const [row] = await tx.db.insert(d).values({ tenantId: tx.tenantId, hostname }).returning();
  if (!row) throw new AppError('internal', { detail: 'domain insert returned no row' });
  let state: HostnameState;
  try {
    state = await deps.provider.create(hostname);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 409)
      throw new AppError('conflict', { detail: 'this domain is already on Cloudflare', cause: e });
    throw e;
  }
  const [updated] = await tx.db
    .update(d)
    .set(providerState(state))
    .where(eq(d.id, row.id))
    .returning();
  await history(tx, row, null, 'pending', actor.userId);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'domain.added',
    entityType: 'tenant_domain',
    entityId: row.id,
    after: { hostname },
  });
  await emit(tx, 'tenant_domain.added', {
    aggregateType: 'tenant_domain',
    aggregateId: row.id,
    payload: { hostname },
  });
  return toDomain(updated as Row);
}

/** When the current round of checks began: the domain's creation or its last retry. */
async function checksSince(tx: TenantTx, row: Row): Promise<Date> {
  const [last] = await tx.db
    .select({ at: h.createdAt })
    .from(h)
    .where(and(eq(h.domainId, row.id), eq(h.toStatus, 'pending')))
    .orderBy(desc(h.createdAt))
    .limit(1);
  return last?.at ?? row.createdAt;
}

export interface CheckResult {
  domain: Domain;
  /** No further scheduled checks are needed: active, or failed. */
  done: boolean;
  /** An active domain found broken now (newly flagged), for the owner's email. */
  newlyFlagged: boolean;
}

/**
 * Checks a domain at Cloudflare (a scheduled re-check, the daily job or
 * "Check now"). Pending becomes active once the hostname and its certificate
 * are live, or failed after 7 days with Cloudflare's reason. A failed domain
 * checked by hand starts a new round. An active domain stays active; a
 * problem is only flagged. `state` passes a state already fetched (the
 * daily job lists the whole zone once).
 */
export async function checkDomain(
  tx: TenantTx,
  actor: Actor,
  id: string,
  deps: {
    provider: CustomHostnameProvider;
    manual?: boolean;
    state?: HostnameState | null;
    now?: Date;
  },
): Promise<CheckResult> {
  if (deps.manual) authorize(actor, 'settings.write');
  const row = await load(tx, id, true);
  const now = deps.now ?? new Date();
  let status = row.status;
  if (status === 'failed' && deps.manual) {
    domainLifecycle.transition(status, 'retry');
    await history(tx, row, 'failed', 'pending', actor.userId, 'checked again');
    status = 'pending';
  }
  const state =
    deps.state !== undefined
      ? deps.state
      : row.providerRef
        ? await deps.provider.get(row.providerRef)
        : null;
  const live = state ? isLive(state) : false;
  const problem = !state
    ? 'Cloudflare no longer knows this hostname'
    : live
      ? null
      : (state.errors[0] ?? `waiting for the DNS record (certificate: ${state.sslStatus})`);

  const set: Partial<typeof d.$inferInsert> = {
    lastCheckedAt: now,
    checkAttempts: status === row.status ? row.checkAttempts + 1 : 1,
    ...(state ? { sslStatus: state.sslStatus, ownershipRecord: state.ownership } : {}),
  };
  let newlyFlagged = false;
  let event: 'activated' | 'failed' | null = null;
  if (status !== 'active' && live) {
    domainLifecycle.transition(status, 'activate');
    Object.assign(set, { status: 'active', verifiedAt: now, failureReason: null });
    await history(tx, row, status, 'active', deps.manual ? actor.userId : null);
    event = 'activated';
  } else if (status === 'pending') {
    const since = row.status === 'pending' ? await checksSince(tx, row) : now;
    const expired = now.getTime() - since.getTime() >= DOMAIN_CHECK_DAYS * 86_400_000;
    set.failureReason = problem;
    if (expired) {
      domainLifecycle.transition('pending', 'fail');
      set.status = 'failed';
      await history(tx, row, 'pending', 'failed', null, problem ?? undefined);
      event = 'failed';
    } else if (status !== row.status) {
      set.status = 'pending';
    }
  } else if (status === 'active') {
    newlyFlagged = problem !== null && row.failureReason === null;
    set.failureReason = problem;
  }
  const [updated] = await tx.db.update(d).set(set).where(eq(d.id, row.id)).returning();
  if (event === 'activated') {
    await emit(tx, 'tenant_domain.updated', {
      aggregateType: 'tenant_domain',
      aggregateId: row.id,
      payload: { hostname: row.hostname },
    });
  }
  const domain = toDomain(updated as Row);
  return { domain, done: domain.status !== 'pending', newlyFlagged };
}

/** Makes an active domain the store's primary host (`settings.write`); the subdomain then redirects to it. */
export async function makePrimaryDomain(tx: TenantTx, actor: Actor, id: string): Promise<Domain> {
  authorize(actor, 'settings.write');
  const row = await load(tx, id, true);
  if (row.status !== 'active') {
    throw new AppError('illegal_transition', { detail: 'only an active domain can be primary' });
  }
  if (row.isPrimary) return toDomain(row);
  await tx.db
    .update(d)
    .set({ isPrimary: false })
    .where(and(eq(d.tenantId, tx.tenantId), eq(d.isPrimary, true)));
  const [updated] = await tx.db.update(d).set({ isPrimary: true }).where(eq(d.id, id)).returning();
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'domain.made_primary',
    entityType: 'tenant_domain',
    entityId: id,
    after: { hostname: row.hostname },
  });
  await emit(tx, 'tenant_domain.updated', {
    aggregateType: 'tenant_domain',
    aggregateId: id,
    payload: { hostname: row.hostname },
  });
  return toDomain(updated as Row);
}

/**
 * Removes a domain: deletes the custom hostname at Cloudflare first, so it
 * can't stay attached after the store lets it go, then marks the row removed.
 */
export async function removeDomain(
  tx: TenantTx,
  actor: Actor,
  id: string,
  deps: { provider: CustomHostnameProvider },
): Promise<void> {
  authorize(actor, 'settings.write');
  const row = await load(tx, id, true);
  domainLifecycle.transition(row.status, 'remove');
  if (row.providerRef) await deps.provider.delete(row.providerRef);
  await tx.db.update(d).set({ status: 'removed', isPrimary: false }).where(eq(d.id, id));
  await history(tx, row, row.status, 'removed', actor.userId);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'domain.removed',
    entityType: 'tenant_domain',
    entityId: id,
    before: { hostname: row.hostname, status: row.status, isPrimary: row.isPrimary },
  });
  await emit(tx, 'tenant_domain.removed', {
    aggregateType: 'tenant_domain',
    aggregateId: id,
    payload: { hostname: row.hostname },
  });
}

/** Domains the daily job checks, across stores: pending ones, and active ones. */
export async function domainsToCheck(
  db: TenantTx['db'],
): Promise<{ id: string; tenantId: string; status: DomainStatus; providerRef: string | null }[]> {
  return db
    .select({ id: d.id, tenantId: d.tenantId, status: d.status, providerRef: d.providerRef })
    .from(d)
    .where(sql`${d.status} in ('pending', 'active')`);
}
