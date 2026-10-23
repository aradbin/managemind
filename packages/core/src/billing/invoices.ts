// Our invoices to clients (phase-5b-plan §3.7, §3.8), after Stripe Billing:
// drafted on each store's billing day, issued with a number that never
// changes, then paid or void. Payments are recorded by a super admin, or
// settled by SSLCommerz on our own merchant account. The daily job drafts,
// issues drafts after 2 days, and takes the reminder steps; a payment that
// leaves nothing overdue lifts an overdue suspension.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  addDays,
  BILLING_PAYMENT_METHODS,
  type BillingPaymentMethod,
  billingPeriod,
  DRAFT_REVIEW_DAYS,
  type DunningStep,
  draftInvoiceLines,
  dunningDue,
  type InvoiceLine,
  type InvoiceStatus,
  invoiceMachine,
  invoiceNumber,
  mergeEntitlements,
  PAYMENT_TERMS_DAYS,
  previousPeriod,
  withTotals,
} from '@managemind/shared/billing';
import { tenantSettings } from '@managemind/shared/settings';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, auditActor, requirePlatformRole } from '../access';
import { emit } from '../outbox';
import { type PlatformTx, recordPlatformAudit } from '../platform';
import { transitionTenant } from '../tenancy/service';
import { type DbClient, type TenantTx, type WithTenantOptions, withTenant } from '../tenant';
import { getSubscription } from './plans';

const i = schema.invoices;
const il = schema.invoiceLines;
const bp = schema.billingPayments;

// ---- Our invoice details (Q8) -------------------------------------------------------

export const issuerInput = z
  .object({
    legalName: z.string().trim().min(1).max(200),
    address: z.string().trim().min(1).max(500),
    tradeLicense: z.string().trim().max(50).optional(),
    /** BIN, when VAT-registered. */
    bin: z.string().trim().max(50).optional(),
    /** Basis points (1500 = 15%); null when not VAT-registered. */
    vatRateBp: z.int().min(0).max(5000).nullable().default(null),
    email: z.email().max(254).optional(),
    phone: z.string().trim().max(30).optional(),
    /** How a client pays: shown on every invoice and the billing page. */
    bank: z
      .object({
        name: z.string().trim().max(100),
        accountName: z.string().trim().max(100),
        accountNumber: z.string().trim().max(50),
        branch: z.string().trim().max(100).optional(),
        routing: z.string().trim().max(20).optional(),
      })
      .strict()
      .optional(),
    bkash: z.string().trim().max(30).optional(),
    nagad: z.string().trim().max(30).optional(),
  })
  .strict();
export type Issuer = z.infer<typeof issuerInput>;

const ISSUER_KEY = 'invoice_issuer';

/** Our invoice details, or null until a super admin has set them. */
export async function getIssuer(tx: { db: TenantTx['db'] }): Promise<Issuer | null> {
  const [row] = await tx.db
    .select({ value: schema.platformSettings.value })
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.key, ISSUER_KEY));
  const parsed = issuerInput.safeParse(row?.value);
  return parsed.success ? parsed.data : null;
}

export async function setIssuer(tx: PlatformTx, actor: Actor, input: unknown): Promise<Issuer> {
  requirePlatformRole(actor, 'super_admin');
  const parsed = issuerInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError('validation_failed', {
      fields: parsed.error.issues.map((x) => ({
        path: x.path.join('.'),
        code: x.code,
        message: x.message,
      })),
    });
  }
  const before = await getIssuer(tx);
  const s = schema.platformSettings;
  await tx.db
    .insert(s)
    .values({ key: ISSUER_KEY, value: parsed.data })
    .onConflictDoUpdate({ target: s.key, set: { value: parsed.data } });
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    action: 'billing.issuer_updated',
    before,
    after: parsed.data,
  });
  return parsed.data;
}

// ---- Reading -------------------------------------------------------------------------

export interface Invoice {
  id: string;
  number: string | null;
  tenantId: string;
  status: InvoiceStatus;
  /** Issued and past its due date. */
  overdue: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  issueAfter: Date | null;
  issuedOn: string | null;
  dueOn: string | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  subtotal: number;
  vat: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  issuer: Issuer | null;
  billedTo: BilledTo | null;
  lines: (InvoiceLine & { id: string; position: number })[];
  payments: {
    id: string;
    amount: number;
    method: BillingPaymentMethod;
    reference: string | null;
    paidOn: string;
    createdAt: Date;
  }[];
  createdAt: Date;
}

export interface BilledTo {
  storeName: string;
  slug: string;
  businessName: string | null;
  address: string | null;
  bin: string | null;
  emails: string[];
}

const invoiceColumns = {
  id: i.id,
  number: i.number,
  tenantId: i.tenantId,
  status: i.status,
  periodStart: i.periodStart,
  periodEnd: i.periodEnd,
  issueAfter: i.issueAfter,
  issuedOn: i.issuedOn,
  dueOn: i.dueOn,
  paidAt: i.paidAt,
  voidedAt: i.voidedAt,
  voidReason: i.voidReason,
  subtotal: i.subtotal,
  vat: i.vat,
  total: i.total,
  amountPaid: i.amountPaid,
  issuer: i.issuer,
  billedTo: i.billedTo,
  createdAt: i.createdAt,
};

type InvoiceRow = Omit<
  Invoice,
  'overdue' | 'amountDue' | 'lines' | 'payments' | 'issuer' | 'billedTo'
> & {
  issuer: unknown;
  billedTo: unknown;
};

function summary(row: InvoiceRow, today: string) {
  return {
    ...row,
    issuer: (row.issuer as Issuer | null) ?? null,
    billedTo: (row.billedTo as BilledTo | null) ?? null,
    overdue: row.status === 'issued' && row.dueOn !== null && today > row.dueOn,
    amountDue: row.status === 'issued' ? Math.max(0, row.total - row.amountPaid) : 0,
  };
}

export type InvoiceSummary = ReturnType<typeof summary>;

async function loadInvoice(
  tx: { db: TenantTx['db'] },
  id: string,
  today: string,
  forUpdate = false,
): Promise<Invoice> {
  const query = tx.db.select(invoiceColumns).from(i).where(eq(i.id, id));
  const [row] = await (forUpdate ? query.for('update') : query);
  if (!row) throw new AppError('not_found');
  const [lines, payments] = await Promise.all([
    tx.db
      .select({
        id: il.id,
        position: il.position,
        kind: il.kind,
        description: il.description,
        quantity: il.quantity,
        unitPrice: il.unitPrice,
        amount: il.amount,
        metric: il.metric,
      })
      .from(il)
      .where(eq(il.invoiceId, id))
      .orderBy(asc(il.position)),
    tx.db
      .select({
        id: bp.id,
        amount: bp.amount,
        method: bp.method,
        reference: bp.reference,
        paidOn: bp.paidOn,
        createdAt: bp.createdAt,
      })
      .from(bp)
      .where(eq(bp.invoiceId, id))
      .orderBy(asc(bp.createdAt)),
  ]);
  return {
    ...summary(row as InvoiceRow, today),
    lines: lines as Invoice['lines'],
    payments,
  };
}

/** One invoice (super_admin, or the store's billing.read through getStoreInvoice). */
export async function getInvoice(
  tx: PlatformTx,
  actor: Actor,
  id: string,
  today: string,
): Promise<Invoice> {
  requirePlatformRole(actor, 'support');
  return loadInvoice(tx, id, today);
}

/** The store's own invoice (billing.read); drafts are ours until issued. */
export async function getStoreInvoice(tx: TenantTx, id: string, today: string): Promise<Invoice> {
  const invoice = await loadInvoice(tx, id, today);
  if (invoice.tenantId !== tx.tenantId || invoice.status === 'draft') {
    throw new AppError('not_found');
  }
  return invoice;
}

export interface InvoiceFilter {
  status?: InvoiceStatus;
  tenantId?: string;
  /** Issued and past due. */
  overdue?: boolean;
  /** Issued and due within the next 7 days. */
  dueThisWeek?: boolean;
  /** The createdAt of the last one seen. */
  before?: string;
  limit?: number;
}

export async function listInvoices(
  tx: { db: TenantTx['db'] },
  actor: Actor,
  filter: InvoiceFilter,
  today: string,
): Promise<(InvoiceSummary & { storeName: string })[]> {
  if (!filter.tenantId || actor.kind !== 'system') requirePlatformRole(actor, 'support');
  const rows = await tx.db
    .select({ ...invoiceColumns, storeName: schema.tenants.name })
    .from(i)
    .innerJoin(schema.tenants, eq(schema.tenants.id, i.tenantId))
    .where(
      and(
        filter.status ? eq(i.status, filter.status) : undefined,
        filter.tenantId ? eq(i.tenantId, filter.tenantId) : undefined,
        filter.overdue ? and(eq(i.status, 'issued'), lt(i.dueOn, today)) : undefined,
        filter.dueThisWeek
          ? and(
              eq(i.status, 'issued'),
              sql`${i.dueOn} between ${today}::date and ${addDays(today, 7)}::date`,
            )
          : undefined,
        filter.before ? lt(i.createdAt, new Date(filter.before)) : undefined,
      ),
    )
    .orderBy(desc(i.createdAt))
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 100));
  return rows.map((r) => ({ ...summary(r as InvoiceRow, today), storeName: r.storeName }));
}

/** The store's issued, paid and void invoices, newest first (billing.read). */
export async function listStoreInvoices(tx: TenantTx, today: string) {
  const rows = await tx.db
    .select(invoiceColumns)
    .from(i)
    .where(and(eq(i.tenantId, tx.tenantId), inArray(i.status, ['issued', 'paid', 'void'])))
    .orderBy(desc(i.createdAt))
    .limit(50);
  return rows.map((r) => summary(r as InvoiceRow, today));
}

// ---- Drafting ------------------------------------------------------------------------

async function writeLines(tx: TenantTx, invoiceId: string, lines: readonly InvoiceLine[]) {
  await tx.db.delete(il).where(eq(il.invoiceId, invoiceId));
  if (!lines.length) return;
  await tx.db.insert(il).values(
    lines.map((l, position) => ({
      invoiceId,
      position,
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
      metric: l.metric ?? null,
    })),
  );
}

/** A month of one store's use, summed from the daily rows (flows only). */
async function usageOf(tx: TenantTx, from: string, to: string) {
  const { rows } = await tx.db.execute<{ metric: string; total: string | number }>(sql`
    select metric, coalesce(sum(value), 0) as total from platform.usage_daily
     where tenant_id = ${tx.tenantId} and day between ${from}::date and ${to}::date
       and metric in ('orders', 'emails')
     group by metric`);
  return Object.fromEntries(rows.map((r) => [r.metric, Number(r.total)])) as Partial<
    Record<'orders' | 'emails', number>
  >;
}

/**
 * Drafts the store's invoice for the period starting on `periodStart`: the
 * coming month's plan, last month's overage, and the setup fee on the first
 * one (§3.7). Nothing is drafted twice for a period, nor for a store without
 * a subscription, nor when there is nothing to charge. Issued automatically
 * after DRAFT_REVIEW_DAYS unless a super admin acts first (Q9).
 */
export async function draftInvoice(
  tx: TenantTx,
  periodStart: string,
  now = new Date(),
): Promise<string | null> {
  const sub = await getSubscription(tx, tx.tenantId);
  if (!sub || sub.status === 'cancelled') return null;
  const [existing] = await tx.db
    .select({ id: i.id })
    .from(i)
    .where(
      and(eq(i.tenantId, tx.tenantId), eq(i.periodStart, periodStart), sql`${i.status} <> 'void'`),
    );
  if (existing) return null;
  const [earlier] = await tx.db
    .select({ id: i.id })
    .from(i)
    .where(and(eq(i.tenantId, tx.tenantId), sql`${i.status} <> 'void'`))
    .limit(1);
  const issuer = await getIssuer(tx);
  const e = mergeEntitlements(sub.plan.entitlements, sub.entitlementOverride);
  const prev = previousPeriod(periodStart);
  const used = await usageOf(tx, prev.start, prev.end);
  const period = billingPeriod(periodStart);
  const draft = draftInvoiceLines({
    plan: sub.plan,
    priceOverride: sub.priceOverride,
    firstInvoice: !earlier,
    setupFeeOverride: sub.setupFeeOverride,
    period,
    trialEndsOn: sub.trialEndsOn,
    overage: (['orders', 'emails'] as const).map((metric) => ({
      metric,
      used: used[metric] ?? 0,
      included: metric === 'orders' ? e.limits.ordersPerMonth : e.limits.emailsPerMonth,
      unitPrice: sub.plan.overagePrices[metric] ?? 0,
    })),
    vatRateBp: issuer?.vatRateBp ?? null,
  });
  if (draft.total === 0) return null;
  const [row] = await tx.db
    .insert(i)
    .values({
      tenantId: tx.tenantId,
      periodStart: period.start,
      periodEnd: period.end,
      issueAfter: new Date(now.getTime() + DRAFT_REVIEW_DAYS * 86_400_000),
      subtotal: draft.subtotal,
      vat: draft.vat,
      total: draft.total,
      vatRateBp: draft.vat > 0 ? (issuer?.vatRateBp ?? null) : null,
    })
    .onConflictDoNothing()
    .returning({ id: i.id });
  if (!row) return null;
  await writeLines(tx, row.id, draft.lines);
  return row.id;
}

const manualLine = z
  .object({
    kind: z.enum(['setup', 'plan', 'overage', 'adjustment']),
    description: z.object({
      bn: z.string().trim().min(1).max(200),
      en: z.string().trim().min(1).max(200),
    }),
    quantity: z.int().min(1).max(1_000_000).default(1),
    unitPrice: z.int().min(-100_000_000_00).max(100_000_000_00),
  })
  .strict();
export const manualInvoiceInput = z
  .object({
    lines: z.array(manualLine).min(1).max(50),
    /** Reviewed by a person already: issued at once instead of waiting 2 days. */
    issueNow: z.boolean().default(false),
  })
  .strict();

/** A draft a super admin writes by hand (a one-off charge or a credit). */
export async function createManualInvoice(
  client: DbClient,
  actor: Actor,
  tenantId: string,
  input: unknown,
  options: WithTenantOptions & { today: string } = { today: '' },
): Promise<string> {
  requirePlatformRole(actor, 'super_admin');
  const parsed = manualInvoiceInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError('validation_failed', {
      fields: parsed.error.issues.map((x) => ({
        path: x.path.join('.'),
        code: x.code,
        message: x.message,
      })),
    });
  }
  return withTenant(
    client,
    tenantId,
    async (tx) => {
      const issuer = await getIssuer(tx);
      const lines: InvoiceLine[] = parsed.data.lines.map((l) => ({
        ...l,
        amount: l.quantity * l.unitPrice,
      }));
      if (lines.some((l) => l.kind !== 'adjustment' && l.unitPrice < 0)) {
        throw new AppError('validation_failed', {
          fields: [
            { path: 'lines', code: 'negative', message: 'only an adjustment takes money off' },
          ],
        });
      }
      const totals = withTotals(lines, issuer?.vatRateBp ?? null);
      if (totals.total < 0) {
        throw new AppError('validation_failed', {
          fields: [{ path: 'lines', code: 'negative', message: 'the total is below zero' }],
        });
      }
      const [row] = await tx.db
        .insert(i)
        .values({
          tenantId,
          createdBy: actor.userId,
          subtotal: totals.subtotal,
          vat: totals.vat,
          total: totals.total,
          vatRateBp: totals.vat > 0 ? (issuer?.vatRateBp ?? null) : null,
          issueAfter: parsed.data.issueNow
            ? null
            : new Date(Date.now() + DRAFT_REVIEW_DAYS * 86_400_000),
        })
        .returning({ id: i.id });
      if (!row) throw new AppError('internal');
      await writeLines(tx, row.id, totals.lines);
      await recordPlatformAudit(tx, {
        ...auditActor(actor, 'platform'),
        tenantId,
        action: 'invoice.drafted',
        entityType: 'invoice',
        entityId: row.id,
        after: { lines: totals.lines, total: totals.total },
      });
      if (parsed.data.issueNow) await issueInTx(tx, actor, row.id, options.today);
      return row.id;
    },
    options,
  );
}

// ---- Issuing and voiding -------------------------------------------------------------

async function billedTo(tx: TenantTx): Promise<BilledTo> {
  const [t] = await tx.db
    .select({
      name: schema.tenants.name,
      slug: schema.tenants.slug,
      settings: schema.tenants.settings,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tx.tenantId));
  const settings = tenantSettings.parse(t?.settings ?? {});
  const owners = await tx.db
    .select({ email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.tenantId, tx.tenantId), eq(schema.memberships.role, 'owner')));
  const a = settings.profile.address;
  return {
    storeName: t?.name ?? '',
    slug: t?.slug ?? '',
    businessName: settings.profile.businessName ?? null,
    address: a ? [a.line1, a.line2, a.city].filter(Boolean).join(', ') : null,
    bin: settings.profile.bin ?? null,
    emails: owners.map((o) => o.email),
  };
}

async function issueInTx(tx: TenantTx, actor: Actor, id: string, today: string): Promise<Invoice> {
  const invoice = await loadInvoice(tx, id, today, true);
  invoiceMachine.transition(invoice.status, 'issue', undefined);
  const issuer = await getIssuer(tx);
  if (!issuer) {
    throw new AppError('feature_unavailable', {
      detail: 'Our invoice details are not set yet: Platform → Billing → Invoice details',
    });
  }
  // VAT follows today's registration: recomputed on issue.
  const totals = withTotals(invoice.lines, issuer.vatRateBp);
  await writeLines(tx, id, totals.lines);
  const { rows } = await tx.db.execute<{ n: string }>(
    sql`select nextval('platform.invoice_number_seq') as n`,
  );
  const number = invoiceNumber(today, Number(rows[0]?.n));
  await tx.db
    .update(i)
    .set({
      status: 'issued',
      number,
      issuedOn: today,
      dueOn: addDays(today, PAYMENT_TERMS_DAYS),
      issuer,
      billedTo: await billedTo(tx),
      subtotal: totals.subtotal,
      vat: totals.vat,
      total: totals.total,
      vatRateBp: totals.vat > 0 ? issuer.vatRateBp : null,
    })
    .where(eq(i.id, id));
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    tenantId: tx.tenantId,
    action: 'invoice.issued',
    entityType: 'invoice',
    entityId: id,
    after: { number, total: totals.total },
  });
  await emit(tx, 'invoice.issued', {
    aggregateType: 'invoice',
    aggregateId: id,
    payload: { invoiceId: id, number, total: totals.total },
  });
  return loadInvoice(tx, id, today);
}

/** Issues a draft (super_admin, or the daily job after the review days). */
export async function issueInvoice(
  client: DbClient,
  actor: Actor,
  id: string,
  today: string,
  options: WithTenantOptions = {},
): Promise<Invoice> {
  requirePlatformRole(actor, 'super_admin');
  const tenantId = await tenantOf(client, id);
  return withTenant(client, tenantId, (tx) => issueInTx(tx, actor, id, today), options);
}

export async function voidInvoice(
  client: DbClient,
  actor: Actor,
  id: string,
  input: { reason: string },
  today: string,
  options: WithTenantOptions = {},
): Promise<Invoice> {
  requirePlatformRole(actor, 'super_admin');
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'reason', code: 'required', message: 'a reason is required' }],
    });
  }
  const tenantId = await tenantOf(client, id);
  return withTenant(
    client,
    tenantId,
    async (tx) => {
      const invoice = await loadInvoice(tx, id, today, true);
      invoiceMachine.transition(invoice.status, 'void', undefined);
      if (invoice.amountPaid > 0) {
        throw new AppError('conflict', { detail: 'payments were recorded against it' });
      }
      await tx.db
        .update(i)
        .set({ status: 'void', voidedAt: sql`now()`, voidReason: reason })
        .where(eq(i.id, id));
      await recordPlatformAudit(tx, {
        ...auditActor(actor, 'platform'),
        tenantId,
        action: 'invoice.voided',
        entityType: 'invoice',
        entityId: id,
        before: { status: invoice.status, number: invoice.number },
        after: { reason },
      });
      return loadInvoice(tx, id, today);
    },
    options,
  );
}

async function tenantOf(client: DbClient, invoiceId: string): Promise<string> {
  const { rows } = await client.query<{ tenant_id: string }>(
    'select tenant_id from platform.invoices where id = $1',
    [invoiceId],
  );
  const id = rows[0]?.tenant_id;
  if (!id) throw new AppError('not_found');
  return id;
}

// ---- Payments ------------------------------------------------------------------------

export const paymentInput = z
  .object({
    amount: z.int().min(1).max(100_000_000_00),
    method: z.enum(BILLING_PAYMENT_METHODS),
    reference: z.string().trim().max(100).optional(),
    paidOn: z.iso.date(),
  })
  .strict();

export interface RecordedPayment {
  invoice: Invoice;
  /** The store was suspended for being overdue, and nothing is overdue now. */
  reactivate: boolean;
}

/**
 * Records a payment against an issued invoice, in the caller's tenant
 * transaction. Covering the total marks it paid. A payment for more than is
 * due is refused: give the change back, or record what was kept.
 */
export async function recordInvoicePaymentInTx(
  tx: TenantTx,
  actor: Actor,
  invoiceId: string,
  input: z.input<typeof paymentInput> & { gatewayTranId?: string; gatewayValId?: string },
  today: string,
): Promise<RecordedPayment> {
  const p = paymentInput.parse({
    amount: input.amount,
    method: input.method,
    paidOn: input.paidOn,
    ...(input.reference ? { reference: input.reference } : {}),
  });
  const invoice = await loadInvoice(tx, invoiceId, today, true);
  if (invoice.tenantId !== tx.tenantId) throw new AppError('not_found');
  if (invoice.status !== 'issued') {
    throw new AppError('illegal_transition', { detail: `the invoice is ${invoice.status}` });
  }
  if (p.amount > invoice.amountDue) {
    throw new AppError('validation_failed', {
      fields: [
        { path: 'amount', code: 'too_much', message: `more than the ${invoice.amountDue} due` },
      ],
    });
  }
  await tx.db.insert(bp).values({
    invoiceId,
    tenantId: tx.tenantId,
    amount: p.amount,
    method: p.method,
    reference: p.reference ?? null,
    paidOn: p.paidOn,
    recordedBy: actor.userId,
    gatewayTranId: input.gatewayTranId ?? null,
    gatewayValId: input.gatewayValId ?? null,
  });
  const paid = invoice.amountPaid + p.amount;
  const done = paid >= invoice.total;
  await tx.db
    .update(i)
    .set({ amountPaid: paid, ...(done ? { status: 'paid' as const, paidAt: sql`now()` } : {}) })
    .where(eq(i.id, invoiceId));
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    tenantId: tx.tenantId,
    action: 'invoice.payment_recorded',
    entityType: 'invoice',
    entityId: invoiceId,
    after: { amount: p.amount, method: p.method, reference: p.reference ?? null, paid: done },
  });
  if (done) {
    await emit(tx, 'invoice.paid', {
      aggregateType: 'invoice',
      aggregateId: invoiceId,
      payload: { invoiceId, number: invoice.number ?? '' },
    });
  }
  // Nothing left overdue: the subscription is in good standing again.
  const [stillOverdue] = await tx.db
    .select({ id: i.id })
    .from(i)
    .where(and(eq(i.tenantId, tx.tenantId), eq(i.status, 'issued'), lt(i.dueOn, today)))
    .limit(1);
  let reactivate = false;
  if (!stillOverdue) {
    await tx.db
      .update(schema.subscriptions)
      .set({ status: 'active' })
      .where(
        and(
          eq(schema.subscriptions.tenantId, tx.tenantId),
          eq(schema.subscriptions.status, 'past_due'),
        ),
      );
    const [t] = await tx.db
      .select({ status: schema.tenants.status, reason: schema.tenants.statusReason })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tx.tenantId));
    reactivate = t?.status === 'suspended' && t.reason === 'overdue';
  }
  return { invoice: await loadInvoice(tx, invoiceId, today), reactivate };
}

/**
 * A super admin records a payment (bank transfer, bKash, Nagad, cash). A
 * payment that leaves nothing overdue reactivates an overdue suspension at
 * once (§3.8); any other suspension stays.
 */
export async function recordInvoicePayment(
  client: DbClient,
  actor: Actor,
  invoiceId: string,
  input: unknown,
  today: string,
  options: WithTenantOptions = {},
): Promise<Invoice> {
  requirePlatformRole(actor, 'super_admin');
  const parsed = paymentInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError('validation_failed', {
      fields: parsed.error.issues.map((x) => ({
        path: x.path.join('.'),
        code: x.code,
        message: x.message,
      })),
    });
  }
  if (parsed.data.method === 'sslcommerz') {
    throw new AppError('validation_failed', {
      fields: [
        { path: 'method', code: 'gateway', message: 'SSLCommerz payments settle by themselves' },
      ],
    });
  }
  const tenantId = await tenantOf(client, invoiceId);
  const result = await withTenant(
    client,
    tenantId,
    (tx) => recordInvoicePaymentInTx(tx, actor, invoiceId, parsed.data, today),
    options,
  );
  if (result.reactivate) await reactivateOverdue(client, tenantId, options);
  return result.invoice;
}

/** Lifts an overdue suspension; any other kind stays (§3.1). */
export async function reactivateOverdue(
  client: DbClient,
  tenantId: string,
  options: WithTenantOptions = {},
): Promise<void> {
  const system: Actor = {
    kind: 'system',
    userId: null,
    platformRole: null,
    permissions: new Set(),
  };
  await transitionTenant(
    client,
    system,
    tenantId,
    'reactivate',
    { reason: 'overdue invoices paid', onlyIf: 'overdue' },
    options,
  );
}

// ---- The daily job -------------------------------------------------------------------

export interface BillingRun {
  drafted: number;
  issued: number;
  reminders: { tenantId: string; invoiceId: string; step: DunningStep }[];
  suspended: string[];
  skipped: string[];
  failed: { tenantId: string; error: string }[];
}

/** The billing period a subscription is in on `today`, by its billing day. */
export function currentPeriodStart(billingDay: number, today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const month = d >= billingDay ? m - 1 : m - 2;
  return new Date(Date.UTC(y, month, billingDay)).toISOString().slice(0, 10);
}

/**
 * Billing's share of the nightly batch (§3.7, §3.8), for client stores only:
 * trials that ended become active; each subscription gets its current
 * period's draft (from the first period that starts after it was created);
 * drafts past their review days are issued once our invoice details exist;
 * then the reminder steps, each once per invoice, and the suspension at +14.
 */
export async function runBilling(
  client: DbClient,
  today: string,
  now = new Date(),
  /** Relays each store's events after its commit (invoice.issued, invoice.reminder). */
  options: Pick<WithTenantOptions, 'afterCommit'> = {},
): Promise<BillingRun> {
  const run: BillingRun = {
    drafted: 0,
    issued: 0,
    reminders: [],
    suspended: [],
    skipped: [],
    failed: [],
  };
  const system: Actor = {
    kind: 'system',
    userId: null,
    platformRole: null,
    permissions: new Set(),
  };
  await client.query(
    `update platform.subscriptions set status = 'active'
      where status = 'trialing' and trial_ends_on < $1::date`,
    [today],
  );
  const { rows: subs } = await client.query<{
    tenant_id: string;
    billing_day: number;
    created_on: string;
  }>(
    `select s.tenant_id, s.billing_day, (s.created_at at time zone 'Asia/Dhaka')::date::text as created_on
       from platform.subscriptions s join platform.tenants t on t.id = s.tenant_id
      where t.kind = 'client' and t.status in ('active', 'suspended') and s.status <> 'cancelled'`,
  );
  for (const s of subs) {
    const start = currentPeriodStart(s.billing_day, today);
    if (start < s.created_on) continue;
    try {
      const id = await withTenant(
        client,
        s.tenant_id,
        (tx) => draftInvoice(tx, start, now),
        options,
      );
      if (id) run.drafted++;
    } catch (e) {
      run.failed.push({ tenantId: s.tenant_id, error: String(e) });
    }
  }

  const { rows: due } = await client.query<{ id: string; tenant_id: string }>(
    `select i.id, i.tenant_id from platform.invoices i join platform.tenants t on t.id = i.tenant_id
      where i.status = 'draft' and i.issue_after <= $1 and t.kind = 'client'`,
    [now],
  );
  for (const d of due) {
    try {
      await withTenant(client, d.tenant_id, (tx) => issueInTx(tx, system, d.id, today), options);
      run.issued++;
    } catch (e) {
      if (e instanceof AppError && e.code === 'feature_unavailable') run.skipped.push(d.id);
      else run.failed.push({ tenantId: d.tenant_id, error: String(e) });
    }
  }

  const { rows: open } = await client.query<{
    id: string;
    tenant_id: string;
    due_on: string;
    hold_until: string | null;
  }>(
    `select i.id, i.tenant_id, i.due_on::text, s.hold_until::text
       from platform.invoices i
       join platform.tenants t on t.id = i.tenant_id
       left join platform.subscriptions s on s.tenant_id = i.tenant_id
      where i.status = 'issued' and t.kind = 'client' and i.due_on <= ($1::date + 3)
      order by i.due_on`,
    [today],
  );
  for (const inv of open) {
    try {
      const steps = dunningDue(inv.due_on, today, inv.hold_until);
      const suspend = await withTenant(
        client,
        inv.tenant_id,
        async (tx) => {
          let suspendNow = false;
          for (const step of steps) {
            const [sent] = await tx.db
              .insert(schema.reminders)
              .values({ invoiceId: inv.id, step })
              .onConflictDoNothing()
              .returning({ id: schema.reminders.id });
            if (!sent) continue;
            run.reminders.push({ tenantId: inv.tenant_id, invoiceId: inv.id, step });
            if (step === 'past_due') {
              await tx.db
                .update(schema.subscriptions)
                .set({ status: 'past_due' })
                .where(eq(schema.subscriptions.tenantId, inv.tenant_id));
            }
            if (step === 'suspend') suspendNow = true;
            await emit(tx, 'invoice.reminder', {
              aggregateType: 'invoice',
              aggregateId: inv.id,
              payload: { invoiceId: inv.id, step },
            });
            await recordPlatformAudit(tx, {
              actorType: 'system',
              tenantId: inv.tenant_id,
              action: `invoice.${step}`,
              entityType: 'invoice',
              entityId: inv.id,
            });
          }
          return suspendNow;
        },
        options,
      );
      if (suspend) {
        const { rows } = await client.query<{ status: string }>(
          'select status from platform.tenants where id = $1',
          [inv.tenant_id],
        );
        if (rows[0]?.status === 'active') {
          await transitionTenant(
            client,
            system,
            inv.tenant_id,
            'suspend',
            { reason: 'invoice overdue 14 days', category: 'overdue' },
            options,
          );
          run.suspended.push(inv.tenant_id);
        }
      }
    } catch (e) {
      run.failed.push({ tenantId: inv.tenant_id, error: String(e) });
    }
  }
  return run;
}
