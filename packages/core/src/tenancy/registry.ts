// The platform's view of stores (phase-1-plan §7.1, platform routes):
// registry data only, never a store's own records. Support and super admins
// read it; nothing here reaches into the store schema.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { and, asc, count, desc, eq, gt, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { type Actor, requirePlatformRole } from '../access';
import type { PlatformTx } from '../platform';

const t = schema.tenants;

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: (typeof schema.TENANT_STATUSES)[number];
  /** The subscription's plan code, or the Phase 1 label for stores without one. */
  plan: string;
  kind: (typeof schema.TENANT_KINDS)[number];
  statusReason: (typeof schema.SUSPENSION_REASONS)[number] | null;
  closedAt: Date | null;
  purgeAfter: Date | null;
  /** Setup checklist progress as of the last health check (phase-5b-plan §3.2); null before one. */
  setup: { done: number; total: number } | null;
  createdAt: Date;
}

const summary = {
  id: t.id,
  slug: t.slug,
  name: t.name,
  status: t.status,
  plan: sql<string>`coalesce(${schema.plans.code}, ${t.plan})`,
  kind: t.kind,
  statusReason: t.statusReason,
  closedAt: t.closedAt,
  purgeAfter: t.purgeAfter,
  setup: sql<{ done: number; total: number } | null>`case
    when ${schema.storeHealth.checklist} ? 'total'
    then jsonb_build_object('done', ${schema.storeHealth.checklist}->'done', 'total', ${schema.storeHealth.checklist}->'total')
  end`,
  createdAt: t.createdAt,
};

/** The tenant row with its plan and last health check. */
const fromTenants = (tx: PlatformTx) =>
  tx.db
    .select(summary)
    .from(t)
    .leftJoin(schema.subscriptions, eq(schema.subscriptions.tenantId, t.id))
    .leftJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .leftJoin(schema.storeHealth, eq(schema.storeHealth.tenantId, t.id));

export interface TenantQuery {
  q?: string;
  /** A status, or setting_up: active stores whose setup checklist isn't done. */
  status?: TenantSummary['status'] | 'setting_up';
  /** One kind or several. */
  kind?: readonly TenantSummary['kind'][];
  /** One plan code or several. */
  plan?: readonly string[];
  after?: string;
  /** Rows to skip, for numbered pages; `after` is then ignored. */
  offset?: number;
  limit?: number;
}

const settingUp = sql`(${t.status} = 'active' and coalesce((${schema.storeHealth.checklist}->>'done')::int < (${schema.storeHealth.checklist}->>'total')::int, false))`;
const planCode = sql`coalesce(${schema.plans.code}, ${t.plan})`;

const tenantFilters = (query: TenantQuery, withCursor: boolean, withStatus = true) => {
  const q = query.q?.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return and(
    q ? or(ilike(t.slug, `%${q}%`), ilike(t.name, `%${q}%`)) : undefined,
    withStatus && query.status === 'setting_up' ? settingUp : undefined,
    withStatus && query.status && query.status !== 'setting_up'
      ? eq(t.status, query.status)
      : undefined,
    query.kind?.length ? inArray(t.kind, [...query.kind]) : undefined,
    query.plan?.length ? sql`${planCode} = any(${sql.param([...query.plan])}::text[])` : undefined,
    withCursor && query.after && query.offset === undefined ? gt(t.slug, query.after) : undefined,
  );
};

/** Stores by slug, filtered by a search on slug or name and by status. */
export async function listTenants(
  tx: PlatformTx,
  actor: Actor,
  query: TenantQuery = {},
): Promise<TenantSummary[]> {
  requirePlatformRole(actor, 'support');
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  return fromTenants(tx)
    .where(tenantFilters(query, true))
    .orderBy(asc(t.slug))
    .limit(limit)
    .offset(query.offset ?? 0);
}

/** How many stores match the search and status, for numbered pages. */
export async function countTenants(
  tx: PlatformTx,
  actor: Actor,
  query: TenantQuery = {},
): Promise<number> {
  requirePlatformRole(actor, 'support');
  const [row] = await tx.db
    .select({ n: count() })
    .from(t)
    .leftJoin(schema.subscriptions, eq(schema.subscriptions.tenantId, t.id))
    .leftJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .leftJoin(schema.storeHealth, eq(schema.storeHealth.tenantId, t.id))
    .where(tenantFilters(query, false));
  return row?.n ?? 0;
}

/** How many stores each of the list's tabs holds, with the search and other filters. */
export async function countTenantTabs(
  tx: PlatformTx,
  actor: Actor,
  query: TenantQuery = {},
): Promise<Record<'all' | 'active' | 'setting_up' | 'suspended' | 'closed' | 'purged', number>> {
  requirePlatformRole(actor, 'support');
  const [row] = await tx.db
    .select({
      all: count(),
      active: sql<number>`count(*) filter (where ${t.status} = 'active')::int`,
      setting_up: sql<number>`count(*) filter (where ${settingUp})::int`,
      suspended: sql<number>`count(*) filter (where ${t.status} = 'suspended')::int`,
      closed: sql<number>`count(*) filter (where ${t.status} = 'closed')::int`,
      purged: sql<number>`count(*) filter (where ${t.status} = 'purged')::int`,
    })
    .from(t)
    .leftJoin(schema.subscriptions, eq(schema.subscriptions.tenantId, t.id))
    .leftJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .leftJoin(schema.storeHealth, eq(schema.storeHealth.tenantId, t.id))
    .where(tenantFilters(query, false, false));
  return {
    all: Number(row?.all ?? 0),
    active: Number(row?.active ?? 0),
    setting_up: Number(row?.setting_up ?? 0),
    suspended: Number(row?.suspended ?? 0),
    closed: Number(row?.closed ?? 0),
    purged: Number(row?.purged ?? 0),
  };
}

export interface TenantDetail extends TenantSummary {
  defaultLocale: 'bn' | 'en';
  domains: { hostname: string; status: string; isPrimary: boolean }[];
  owners: { userId: string; name: string; email: string }[];
  memberCount: number;
}

export async function getTenantDetail(
  tx: PlatformTx,
  actor: Actor,
  tenantId: string,
): Promise<TenantDetail> {
  requirePlatformRole(actor, 'support');
  const [found] = await fromTenants(tx).where(eq(t.id, tenantId));
  const [locale] = await tx.db
    .select({ defaultLocale: t.defaultLocale })
    .from(t)
    .where(eq(t.id, tenantId));
  const tenant = found && locale ? { ...found, defaultLocale: locale.defaultLocale } : undefined;
  if (!tenant) throw new AppError('not_found');
  const d = schema.tenantDomains;
  const m = schema.memberships;
  const u = schema.users;
  const [domains, owners, [members]] = await Promise.all([
    tx.db
      .select({ hostname: d.hostname, status: d.status, isPrimary: d.isPrimary })
      .from(d)
      .where(eq(d.tenantId, tenantId))
      .orderBy(asc(d.hostname)),
    tx.db
      .select({ userId: u.id, name: u.name, email: u.email })
      .from(m)
      .innerJoin(u, eq(u.id, m.userId))
      .where(and(eq(m.tenantId, tenantId), eq(m.role, 'owner')))
      .orderBy(asc(u.name)),
    tx.db.select({ n: count() }).from(m).where(eq(m.tenantId, tenantId)),
  ]);
  return { ...tenant, domains, owners, memberCount: members?.n ?? 0 };
}

export interface PlatformAuditRow {
  id: string;
  tenantId: string | null;
  /** The store's name, when the entry is about one. */
  tenantName: string | null;
  actorType: string;
  actorId: string | null;
  /** The person's name, for a user. */
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

export interface PlatformAuditQuery {
  /** Older than this entry (uuidv7 ids sort by time); or `offset`. */
  before?: string;
  offset?: number;
  limit?: number;
  /** Words in the action, the person's name or email, the store's name. */
  q?: string;
  actions?: readonly string[];
  tenantIds?: readonly string[];
}

function auditWhere(page: PlatformAuditQuery) {
  const a = schema.platformAuditLog;
  const u = schema.users;
  const tn = schema.tenants;
  const q = page.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
  return and(
    page.before ? lt(a.id, page.before) : undefined,
    page.actions?.length ? inArray(a.action, [...page.actions]) : undefined,
    page.tenantIds?.length ? inArray(a.tenantId, [...page.tenantIds]) : undefined,
    like
      ? or(ilike(a.action, like), ilike(u.name, like), ilike(u.email, like), ilike(tn.name, like))
      : undefined,
  );
}

/** The platform audit log, newest first (super admins), with names for people and stores. */
export async function listPlatformAudit(
  tx: PlatformTx,
  actor: Actor,
  page: PlatformAuditQuery = {},
): Promise<PlatformAuditRow[]> {
  requirePlatformRole(actor, 'super_admin');
  const a = schema.platformAuditLog;
  const u = schema.users;
  const tn = schema.tenants;
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 100);
  // Ids are uuidv7, so they sort by time.
  return tx.db
    .select({
      id: a.id,
      tenantId: a.tenantId,
      tenantName: tn.name,
      actorType: a.actorType,
      actorId: a.actorId,
      actorName: u.name,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      before: a.before,
      after: a.after,
      createdAt: a.createdAt,
    })
    .from(a)
    .leftJoin(u, eq(u.id, a.actorId))
    .leftJoin(tn, eq(tn.id, a.tenantId))
    .where(auditWhere(page))
    .orderBy(desc(a.id))
    .limit(limit)
    .offset(page.before ? 0 : Math.max(page.offset ?? 0, 0));
}

/** How many entries match, and the actions and stores the filters offer. */
export async function platformAuditSummary(
  tx: PlatformTx,
  actor: Actor,
  page: PlatformAuditQuery = {},
): Promise<{ total: number; actions: string[]; stores: { id: string; name: string }[] }> {
  requirePlatformRole(actor, 'super_admin');
  const a = schema.platformAuditLog;
  const u = schema.users;
  const tn = schema.tenants;
  const [totalRow] = await tx.db
    .select({ n: count() })
    .from(a)
    .leftJoin(u, eq(u.id, a.actorId))
    .leftJoin(tn, eq(tn.id, a.tenantId))
    .where(auditWhere({ ...page, before: '' }));
  const actions = await tx.db.selectDistinct({ action: a.action }).from(a).orderBy(asc(a.action));
  const stores = await tx.db
    .selectDistinct({ id: tn.id, name: tn.name })
    .from(a)
    .innerJoin(tn, eq(tn.id, a.tenantId))
    .orderBy(asc(tn.name));
  return {
    total: Number(totalRow?.n ?? 0),
    actions: actions.map((x) => x.action),
    stores,
  };
}
