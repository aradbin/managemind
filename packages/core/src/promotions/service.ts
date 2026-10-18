// Promotions and their codes (phase-4-plan §3.13): the campaign list with
// uses, orders, discounts and sales; the builder's create and edit; batches
// of unique codes; and the test cart, which prices a cart against the live
// promotions, plus the one being built, and says why each other one didn't
// apply. Promotions are never deleted (orders point at them): staff end
// them. The engine itself is pricing/engine.ts.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  codeBatchInput,
  PAYMENT_METHODS,
  PROMOTION_LIMITS,
  type PromotionAction,
  type PromotionConditions,
  type PromotionInput,
  promotionInput,
} from '@managemind/shared/orders';
import { normalizePhone } from '@managemind/shared/phone';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput, pgError } from '../catalog/common';
import type { Localized } from '../orders/variants';
import { emit } from '../outbox';
import type { PromotionRule } from '../pricing/engine';
import { orderSettings, type Quote, quote } from '../pricing/quote';
import type { TenantTx } from '../tenant';

/** Where a promotion stands now: its status, read with its dates. */
export type PromotionState = 'draft' | 'scheduled' | 'live' | 'paused' | 'ended';

export interface Promotion {
  id: string;
  title: Localized;
  kind: 'automatic' | 'code';
  status: 'draft' | 'active' | 'paused' | 'ended';
  state: PromotionState;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  exclusive: boolean;
  maxDiscount: number | null;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  conditions: PromotionConditions;
  action: PromotionAction;
  /** The shared code ("EID500"); batch codes are listed separately. */
  code: string | null;
  codeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionSummary extends Promotion {
  /** Orders that used it and weren't cancelled. */
  orders: number;
  discountTotal: number;
  /** Those orders' totals. */
  sales: number;
}

type Row = Omit<Promotion, 'maxDiscount' | 'startsAt' | 'endsAt' | 'createdAt' | 'updatedAt'> & {
  maxDiscount: string | number | null;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  orders?: number;
  discountTotal?: string | number;
  sales?: string | number;
};

const iso = (v: Date | string) => new Date(v).toISOString();

const COLUMNS = sql`p.id, p.title, p.kind, p.status, p.starts_at as "startsAt", p.ends_at as "endsAt",
  p.priority, p.exclusive, p.max_discount as "maxDiscount", p.usage_limit as "usageLimit",
  p.usage_count as "usageCount", p.per_customer_limit as "perCustomerLimit", p.conditions, p.action,
  p.created_at as "createdAt", p.updated_at as "updatedAt",
  case
    when p.status = 'draft' then 'draft'
    when p.status = 'paused' then 'paused'
    when p.status = 'ended' or (p.ends_at is not null and p.ends_at <= now()) then 'ended'
    when p.starts_at is not null and p.starts_at > now() then 'scheduled'
    else 'live' end as state,
  (select c.code from store.promotion_codes c
    where c.promotion_id = p.id and c.usage_limit is null order by c.created_at, c.id limit 1) as code,
  (select count(*)::int from store.promotion_codes c where c.promotion_id = p.id) as "codeCount"`;

const STATS = sql`
  (select count(distinct a.order_id)::int from store.order_adjustments a join store.orders o on o.id = a.order_id
    where a.promotion_id = p.id and o.status <> 'cancelled') as orders,
  (select coalesce(sum(a.amount), 0) from store.order_adjustments a join store.orders o on o.id = a.order_id
    where a.promotion_id = p.id and o.status <> 'cancelled') as "discountTotal",
  (select coalesce(sum(o.total), 0) from store.orders o
    where o.status <> 'cancelled'
      and exists (select 1 from store.order_adjustments a where a.order_id = o.id and a.promotion_id = p.id)) as sales`;

function toPromotion(r: Row): Promotion {
  const { orders: _o, discountTotal: _d, sales: _s, ...rest } = r;
  return {
    ...rest,
    maxDiscount: r.maxDiscount === null ? null : Number(r.maxDiscount),
    startsAt: r.startsAt === null ? null : iso(r.startsAt),
    endsAt: r.endsAt === null ? null : iso(r.endsAt),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

const toSummary = (r: Row): PromotionSummary => ({
  ...toPromotion(r),
  orders: r.orders ?? 0,
  discountTotal: Number(r.discountTotal ?? 0),
  sales: Number(r.sales ?? 0),
});

const listQuery = z.object({
  state: z.enum(['draft', 'scheduled', 'live', 'paused', 'ended']).optional(),
  kind: z.enum(['automatic', 'code']).optional(),
  q: z.string().trim().max(100).optional(),
});

/** The campaign list, newest first, with what each one did. */
export async function listPromotions(
  tx: TenantTx,
  actor: Actor,
  query: unknown = {},
): Promise<PromotionSummary[]> {
  authorize(actor, 'promotions.read');
  const q = parseInput(listQuery, query);
  const search = q.q
    ? sql`and (p.title::text ilike ${`%${q.q}%`} or exists (
        select 1 from store.promotion_codes c where c.promotion_id = p.id and upper(c.code) = upper(${q.q})))`
    : sql``;
  const { rows } = await tx.db.execute<Row>(sql`
    select * from (select ${COLUMNS}, ${STATS} from store.promotions p
     where true ${q.kind ? sql`and p.kind = ${q.kind}` : sql``} ${search}) x
     ${q.state ? sql`where x.state = ${q.state}` : sql``}
     order by x."createdAt" desc, x.id desc limit 200`);
  return rows.map(toSummary);
}

export async function getPromotion(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<PromotionSummary> {
  authorize(actor, 'promotions.read');
  const { rows } = await tx.db.execute<Row>(
    sql`select ${COLUMNS}, ${STATS} from store.promotions p where p.id = ${id}`,
  );
  if (!rows[0]) throw new AppError('not_found');
  return toSummary(rows[0]);
}

/** At most PROMOTION_LIMITS.activeAutomatic automatic promotions active at once. */
async function checkActiveLimit(tx: TenantTx, p: PromotionInput, id?: string) {
  if (p.kind !== 'automatic' || p.status !== 'active') return;
  const { rows } = await tx.db.execute<{ n: number }>(sql`
    select count(*)::int as n from store.promotions
     where kind = 'automatic' and status = 'active' and (ends_at is null or ends_at > now())
       ${id ? sql`and id <> ${id}` : sql``}`);
  if ((rows[0]?.n ?? 0) >= PROMOTION_LIMITS.activeAutomatic) {
    throw new AppError('limit_exceeded', {
      detail: `At most ${PROMOTION_LIMITS.activeAutomatic} automatic promotions can be active`,
    });
  }
}

function codeTaken(e: unknown): never {
  const { code, constraint } = pgError(e);
  if (code === '23505' && constraint === 'promotion_codes_code_unique') {
    throw new AppError('conflict', {
      detail: 'Another promotion already has this code',
      fields: [{ path: 'code', code: 'taken', message: 'already in use' }],
    });
  }
  throw e;
}

/** Sets the shared code: renames the existing one, or adds it. */
async function writeSharedCode(tx: TenantTx, promotionId: string, code: string | undefined) {
  if (code === undefined) return;
  const { rows } = await tx.db.execute<{ id: string }>(sql`
    select id from store.promotion_codes
     where promotion_id = ${promotionId} and usage_limit is null order by created_at, id limit 1`);
  if (rows[0]) {
    await tx.db
      .update(schema.promotionCodes)
      .set({ code })
      .where(eq(schema.promotionCodes.id, rows[0].id))
      .catch(codeTaken);
  } else {
    await tx.db.insert(schema.promotionCodes).values({ promotionId, code }).catch(codeTaken);
  }
}

const values = (p: PromotionInput) => ({
  title: p.title,
  kind: p.kind,
  status: p.status,
  startsAt: p.startsAt === null ? null : new Date(p.startsAt),
  endsAt: p.endsAt === null ? null : new Date(p.endsAt),
  priority: p.priority,
  exclusive: p.exclusive,
  maxDiscount: p.maxDiscount,
  usageLimit: p.usageLimit,
  perCustomerLimit: p.perCustomerLimit,
  conditions: p.conditions,
  action: p.action,
});

async function changed(tx: TenantTx, id: string, change: 'created' | 'updated' | 'deleted') {
  await emit(tx, 'promotion.changed', {
    aggregateType: 'promotion',
    aggregateId: id,
    payload: { change },
  });
}

export async function createPromotion(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<PromotionSummary> {
  authorize(actor, 'promotions.write');
  const p = parseInput(promotionInput, input);
  await checkActiveLimit(tx, p);
  const [row] = await tx.db
    .insert(schema.promotions)
    .values(values(p))
    .returning({ id: schema.promotions.id });
  if (!row) throw new AppError('internal');
  await writeSharedCode(tx, row.id, p.code);
  const created = await getPromotion(tx, actor, row.id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'promotion.created',
    entityType: 'promotion',
    entityId: row.id,
    after: created,
  });
  await changed(tx, row.id, 'created');
  return created;
}

/** Edits a promotion: any field, merged over what it has. The kind can't change. */
export async function updatePromotion(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<PromotionSummary> {
  authorize(actor, 'promotions.write');
  const before = await getPromotion(tx, actor, id);
  const patch = (input ?? {}) as Record<string, unknown>;
  if (patch.kind !== undefined && patch.kind !== before.kind) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'kind', code: 'immutable', message: 'make a new promotion instead' }],
    });
  }
  const current = {
    title: before.title,
    kind: before.kind,
    status: before.status,
    startsAt: before.startsAt,
    endsAt: before.endsAt,
    priority: before.priority,
    exclusive: before.exclusive,
    maxDiscount: before.maxDiscount,
    usageLimit: before.usageLimit,
    perCustomerLimit: before.perCustomerLimit,
    conditions: before.conditions,
    action: before.action,
  };
  const p = parseInput(promotionInput, { ...current, ...patch });
  await checkActiveLimit(tx, p, id);
  await tx.db
    .update(schema.promotions)
    .set({ ...values(p), updatedAt: sql`now()` })
    .where(eq(schema.promotions.id, id));
  await writeSharedCode(tx, id, p.code);
  const after = await getPromotion(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'promotion.updated',
    entityType: 'promotion',
    entityId: id,
    before,
    after,
  });
  await changed(tx, id, 'updated');
  return after;
}

// ---- Codes ------------------------------------------------------------------------------

/** No 0/O or 1/I/L, so a code read aloud or from paper is typed right. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(prefix: string, length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = prefix;
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** A batch of unique codes (up to 5,000), each with its own use limit. */
export async function generateCodes(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<{ created: number; codes: string[] }> {
  authorize(actor, 'promotions.write');
  const batch = parseInput(codeBatchInput, input);
  const p = await getPromotion(tx, actor, id);
  if (p.kind !== 'code') {
    throw new AppError('validation_failed', {
      fields: [{ path: 'kind', code: 'not_code', message: 'only code promotions have codes' }],
    });
  }
  const codes: string[] = [];
  for (let attempt = 0; codes.length < batch.count && attempt < 10; attempt++) {
    const wanted = batch.count - codes.length;
    const candidates = [...new Set(Array.from({ length: wanted }, () => randomCode(batch.prefix)))];
    for (let i = 0; i < candidates.length; i += 1000) {
      const { rows } = await tx.db.execute<{ code: string }>(sql`
        insert into store.promotion_codes (promotion_id, code, usage_limit)
        select ${id}, c, ${batch.usageLimit} from unnest(${sql.param(candidates.slice(i, i + 1000))}::text[]) c
        on conflict do nothing returning code`);
      codes.push(...rows.map((r) => r.code));
    }
  }
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'promotion.codes_generated',
    entityType: 'promotion',
    entityId: id,
    after: { count: codes.length, prefix: batch.prefix, usageLimit: batch.usageLimit },
  });
  return { created: codes.length, codes };
}

const codesQuery = z.object({
  after: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type PromotionCode = {
  id: string;
  code: string;
  usageLimit: number | null;
  usageCount: number;
  createdAt: string;
};

/** A promotion's codes in the order they were made, with their uses (for export and review). */
export async function listCodes(
  tx: TenantTx,
  actor: Actor,
  id: string,
  query: unknown = {},
): Promise<{ items: PromotionCode[]; nextCursor: string | null }> {
  authorize(actor, 'promotions.read');
  const q = parseInput(codesQuery, query);
  await getPromotion(tx, actor, id);
  const limit = q.limit ?? 200;
  const { rows } = await tx.db.execute<PromotionCode & { createdAt: Date | string }>(sql`
    select id, code, usage_limit as "usageLimit", usage_count as "usageCount", created_at as "createdAt"
      from store.promotion_codes where promotion_id = ${id}
       ${q.after ? sql`and id > ${q.after}::uuid` : sql``}
     order by id limit ${limit + 1}`);
  const items = rows.slice(0, limit).map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
  return {
    items,
    nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
  };
}

// ---- The test cart ------------------------------------------------------------------------

/** The id the test cart gives a promotion that isn't saved yet. */
export const DRAFT_PROMOTION_ID = '00000000-0000-4000-8000-000000000000';

export const testCartInput = z
  .object({
    lines: z
      .array(z.object({ variantId: z.uuid(), quantity: z.int().min(1).max(1000) }).strict())
      .min(1)
      .max(50),
    areaId: z.int().min(1).nullable().default(null),
    paymentMethod: z.enum(PAYMENT_METHODS).default('cod'),
    phone: z.string().max(32).optional(),
    code: z.string().trim().min(1).max(32).optional(),
    /** The promotion being built, tried as if it were live. */
    draft: z.unknown().optional(),
    /** A saved promotion to try as if it were live (a draft, scheduled or paused one). */
    promotionId: z.uuid().optional(),
  })
  .strict();

export interface TestCartResult {
  quote: Quote;
  /** Every promotion considered, applied or not, and why not. */
  results: {
    promotionId: string;
    title: Localized;
    applied: boolean;
    amount: number;
    reason: string | null;
  }[];
}

export async function testCart(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<TestCartResult> {
  authorize(actor, 'promotions.read');
  const t = parseInput(testCartInput, input);
  const extraRules: PromotionRule[] = [];
  if (t.draft !== undefined) {
    const d = parseInput(promotionInput, t.draft);
    extraRules.push({
      id: DRAFT_PROMOTION_ID,
      title: d.title,
      kind: d.kind,
      priority: d.priority,
      exclusive: d.exclusive,
      maxDiscount: d.maxDiscount,
      conditions: d.conditions,
      action: d.action,
      ...(d.kind === 'code' ? { code: d.code ?? 'TEST', codeId: DRAFT_PROMOTION_ID } : {}),
    });
  }
  if (t.promotionId) {
    const p = await getPromotion(tx, actor, t.promotionId);
    extraRules.push({
      id: p.id,
      title: p.title,
      kind: p.kind,
      priority: p.priority,
      exclusive: p.exclusive,
      maxDiscount: p.maxDiscount,
      conditions: p.conditions,
      action: p.action,
      ...(p.kind === 'code' && !t.code ? { code: p.code ?? 'TEST', codeId: p.id } : {}),
    });
  }
  const settings = await orderSettings(tx);
  const q = await quote(tx, {
    lines: t.lines,
    areaId: t.areaId,
    code: t.code ?? null,
    phone: t.phone ? normalizePhone(t.phone) : null,
    paymentMethod: t.paymentMethod,
    maxQuantityPerLine: null,
    settings,
    extraRules,
  });
  const titles = new Map<string, Localized>(extraRules.map((r) => [r.id, r.title]));
  const missing = q.notApplied.map((n) => n.promotionId).filter((id) => !titles.has(id));
  if (missing.length) {
    const { rows } = await tx.db.execute<{ id: string; title: Localized }>(sql`
      select id, title from store.promotions where id = any(${sql.param(missing)}::uuid[])`);
    for (const r of rows) titles.set(r.id, r.title);
  }
  const results: TestCartResult['results'] = [
    ...q.promotions.map((a) => ({
      promotionId: a.promotionId,
      title: a.title,
      applied: true,
      amount: a.amount,
      reason: null,
    })),
    ...q.notApplied.map((n) => ({
      promotionId: n.promotionId,
      title: titles.get(n.promotionId) ?? {},
      applied: false,
      amount: 0,
      reason: n.reason,
    })),
  ];
  return { quote: q, results };
}
