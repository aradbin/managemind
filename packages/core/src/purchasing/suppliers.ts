// Suppliers and what the store owes them (phase-8-plan §3.1, §3.7). A
// supplier's balance is derived every time: its opening balance, plus every
// receipt at its landed total, less every payment. Nothing stores a running
// balance that could drift (ADR 0031).
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  type AgeingBucket,
  supplierAgeing,
  supplierInput,
  supplierPatch,
} from '@managemind/shared/back-office';
import { eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import type { TenantTx } from '../tenant';
import { money, requireBackOffice, today } from './common';

export interface SupplierAddress {
  line1: string;
  line2?: string;
  city?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phones: string[];
  email: string | null;
  address: SupplierAddress | null;
  note: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /** With purchasing.pay only. */
  openingBalance?: number;
  /** Owed to the supplier now; below zero is an advance. With purchasing.pay only. */
  balance?: number;
}

const s = schema.suppliers;

type Row = typeof s.$inferSelect;

const toSupplier = (row: Row, actor: Actor, balance?: number): Supplier => ({
  id: row.id,
  name: row.name,
  contactName: row.contactName,
  phones: row.phones,
  email: row.email,
  address: (row.address as SupplierAddress | null) ?? null,
  note: row.note,
  archived: row.archivedAt !== null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  ...(actor.permissions.has('purchasing.pay')
    ? { openingBalance: row.openingBalance, balance: balance ?? row.openingBalance }
    : {}),
});

/** Every supplier's received and paid totals, or one's. */
async function balances(tx: TenantTx, supplierId?: string): Promise<Map<string, number>> {
  const one = supplierId ? sql`where s.id = ${supplierId}` : sql``;
  const { rows } = await tx.db.execute<{ id: string; balance: string }>(sql`
    select s.id,
           s.opening_balance
           + coalesce((select sum(r.total) from store.goods_receipts r where r.supplier_id = s.id), 0)
           - coalesce((select sum(p.amount) from store.supplier_payments p where p.supplier_id = s.id), 0)
             as balance
      from store.suppliers s ${one}`);
  return new Map(rows.map((r) => [r.id, Number(r.balance)]));
}

/** GET /suppliers: by name; archived ones only when asked. */
export async function listSuppliers(
  tx: TenantTx,
  actor: Actor,
  query: { q?: string | undefined; archived?: boolean | undefined } = {},
): Promise<{ items: Supplier[] }> {
  authorize(actor, 'purchasing.read');
  await requireBackOffice(tx);
  const q = query.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await tx.db
    .select()
    .from(s)
    .where(
      sql`${query.archived ? sql`${s.archivedAt} is not null` : sql`${s.archivedAt} is null`}
          ${like ? sql`and (app.search_text(${s.name}) like app.search_text(${like}) or exists (select 1 from unnest(${s.phones}) ph where ph like ${like}))` : sql``}`,
    )
    .orderBy(sql`lower(${s.name})`, s.id)
    .limit(500);
  const owed = actor.permissions.has('purchasing.pay') ? await balances(tx) : new Map();
  return { items: rows.map((r) => toSupplier(r, actor, owed.get(r.id))) };
}

async function loadSupplier(tx: TenantTx, id: string, lock = false): Promise<Row> {
  const query = tx.db.select().from(s).where(eq(s.id, id));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new AppError('not_found');
  return row;
}

/** A supplier that new POs and receipts may name: it exists and isn't archived. */
export async function activeSupplier(tx: TenantTx, id: string): Promise<Row> {
  const row = await loadSupplier(tx, id);
  if (row.archivedAt) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'supplierId', code: 'archived', message: 'the supplier is archived' }],
    });
  }
  return row;
}

export async function getSupplier(tx: TenantTx, actor: Actor, id: string): Promise<Supplier> {
  authorize(actor, 'purchasing.read');
  await requireBackOffice(tx);
  const row = await loadSupplier(tx, id);
  const owed = actor.permissions.has('purchasing.pay') ? await balances(tx, id) : new Map();
  return toSupplier(row, actor, owed.get(id));
}

const audited = (row: Row) => ({
  name: row.name,
  contactName: row.contactName,
  phones: row.phones,
  email: row.email,
  address: row.address,
  note: row.note,
  openingBalance: row.openingBalance,
  archived: row.archivedAt !== null,
});

/** An opening balance is a due: setting one needs purchasing.pay. */
function checkOpeningBalance(actor: Actor, value: number | undefined) {
  if (value !== undefined && value !== 0 && !actor.permissions.has('purchasing.pay')) {
    throw new AppError('forbidden', { detail: 'opening balances need purchasing.pay' });
  }
}

export async function createSupplier(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<Supplier> {
  authorize(actor, 'purchasing.write');
  await requireBackOffice(tx);
  const v = parseInput(supplierInput, input);
  checkOpeningBalance(actor, v.openingBalance);
  const [row] = await tx.db
    .insert(s)
    .values({
      name: v.name,
      contactName: v.contactName ?? null,
      phones: v.phones ?? [],
      email: v.email ?? null,
      address: v.address ?? null,
      note: v.note ?? null,
      openingBalance: v.openingBalance ?? 0,
    })
    .returning();
  if (!row) throw new AppError('internal');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'supplier.created',
    entityType: 'supplier',
    entityId: row.id,
    after: audited(row),
  });
  return toSupplier(row, actor);
}

export async function updateSupplier(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Supplier> {
  authorize(actor, 'purchasing.write');
  await requireBackOffice(tx);
  const v = parseInput(supplierPatch, input);
  const before = await loadSupplier(tx, id, true);
  if (
    v.openingBalance !== undefined &&
    v.openingBalance !== before.openingBalance &&
    !actor.permissions.has('purchasing.pay')
  ) {
    throw new AppError('forbidden', { detail: 'opening balances need purchasing.pay' });
  }
  const [row] = await tx.db
    .update(s)
    .set({
      ...(v.name !== undefined ? { name: v.name } : {}),
      ...(v.contactName !== undefined ? { contactName: v.contactName } : {}),
      ...(v.phones !== undefined ? { phones: v.phones } : {}),
      ...(v.email !== undefined ? { email: v.email } : {}),
      ...(v.address !== undefined ? { address: v.address } : {}),
      ...(v.note !== undefined ? { note: v.note } : {}),
      ...(v.openingBalance !== undefined ? { openingBalance: v.openingBalance } : {}),
      ...(v.archived !== undefined
        ? { archivedAt: v.archived ? (before.archivedAt ?? new Date()) : null }
        : {}),
    })
    .where(eq(s.id, id))
    .returning();
  if (!row) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'supplier.updated',
    entityType: 'supplier',
    entityId: id,
    before: audited(before),
    after: audited(row),
  });
  const owed = actor.permissions.has('purchasing.pay') ? await balances(tx, id) : new Map();
  return toSupplier(row, actor, owed.get(id));
}

// ---- The ledger and dues (§3.7) -----------------------------------------------------------

export interface LedgerEntry {
  /** The Dhaka day. */
  on: string;
  kind: 'opening' | 'receipt' | 'payment';
  id: string | null;
  /** The receipt's number, or the payment's reference. */
  reference: string | null;
  /** What it added to the balance: receipts and the opening balance up, payments down. */
  amount: number;
  balance: number;
}

/** GET /suppliers/{id}/ledger: the supplier's khata page, oldest first (purchasing.pay). */
export async function supplierLedger(
  tx: TenantTx,
  actor: Actor,
  id: string,
  range: { from?: string | undefined; to?: string | undefined } = {},
): Promise<{ opening: number; entries: LedgerEntry[]; closing: number }> {
  authorize(actor, 'purchasing.pay');
  await requireBackOffice(tx);
  const supplier = await loadSupplier(tx, id);
  const { rows } = await tx.db.execute<{
    on: string;
    kind: 'receipt' | 'payment';
    id: string;
    reference: string | null;
    amount: string;
  }>(sql`
    select * from (
      select r.received_on::text as on, 'receipt' as kind, r.id, 'GR-' || lpad(r.number::text, 4, '0') as reference,
             r.total as amount, r.created_at as at
        from store.goods_receipts r where r.supplier_id = ${id}
      union all
      select p.paid_on::text, 'payment', p.id, p.reference, -p.amount, p.created_at
        from store.supplier_payments p where p.supplier_id = ${id}
    ) x order by x.on, x.at`);
  const openedOn = supplier.createdAt.toISOString().slice(0, 10);
  let balance = 0;
  const all: LedgerEntry[] = [];
  if (supplier.openingBalance !== 0) {
    balance = supplier.openingBalance;
    all.push({
      on: openedOn,
      kind: 'opening',
      id: null,
      reference: null,
      amount: supplier.openingBalance,
      balance,
    });
  }
  for (const r of rows) {
    balance += Number(r.amount);
    all.push({
      on: r.on,
      kind: r.kind,
      id: r.id,
      reference: r.reference,
      amount: Number(r.amount),
      balance,
    });
  }
  const before = range.from ? all.filter((e) => e.on < (range.from as string)) : [];
  const opening = before.length ? (before[before.length - 1] as LedgerEntry).balance : 0;
  const entries = all.filter(
    (e) => (!range.from || e.on >= range.from) && (!range.to || e.on <= range.to),
  );
  return { opening, entries, closing: balance };
}

export interface SupplierDue {
  supplierId: string;
  name: string;
  archived: boolean;
  balance: number;
  buckets: Record<AgeingBucket, number>;
}

/**
 * What the store owes each supplier, aged oldest receipt first (§3.7): the
 * suppliers report's balances and ageing (purchasing.pay).
 */
export async function supplierDues(
  tx: TenantTx,
  actor: Actor,
  on = today(),
): Promise<SupplierDue[]> {
  authorize(actor, 'purchasing.pay');
  await requireBackOffice(tx);
  const { rows } = await tx.db.execute<{
    id: string;
    name: string;
    archived: boolean;
    created_at: string;
    opening_balance: string;
    receipts: { on: string; amount: number }[] | null;
    paid: string;
  }>(sql`
    select s.id, s.name, s.archived_at is not null as archived, s.created_at, s.opening_balance,
           (select json_agg(json_build_object('on', r.received_on, 'amount', r.total) order by r.received_on)
              from store.goods_receipts r where r.supplier_id = s.id and r.received_on <= ${on}::date) as receipts,
           coalesce((select sum(p.amount) from store.supplier_payments p
                      where p.supplier_id = s.id and p.paid_on <= ${on}::date), 0) as paid
      from store.suppliers s
     order by lower(s.name), s.id`);
  return rows
    .map((r) => {
      const { balance, buckets } = supplierAgeing({
        openedOn: new Date(r.created_at).toISOString().slice(0, 10),
        openingBalance: Number(r.opening_balance),
        receipts: (r.receipts ?? []).map((x) => ({ on: x.on, amount: Number(x.amount) })),
        paid: money(r.paid) ?? 0,
        today: on,
      });
      return { supplierId: r.id, name: r.name, archived: r.archived, balance, buckets };
    })
    .filter((d) => d.balance !== 0 || !d.archived);
}
