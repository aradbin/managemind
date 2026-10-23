// Our charges to clients (phase-5b-plan §3.5–§3.8), after Stripe Billing:
// a subscription with a plan and a billing day; invoices that are drafts,
// then issued with a number that never changes, then paid or void; usage
// summed from daily rows at invoice time; and a schedule of reminders with
// suspension at the end. Money is integer poisha in BDT, as everywhere.
import { z } from 'zod';
import { defineMachine } from '../state-machine';
import { type Entitlements, entitlementOverride, entitlements, UNLIMITED } from './entitlements';

export * from './entitlements';

/** `demo` and `test` stores never get invoices and can be reset (§3.1). */
export const TENANT_KINDS = ['client', 'demo', 'test'] as const;
export type TenantKind = (typeof TENANT_KINDS)[number];

/** Why a store is suspended; paying an overdue invoice lifts only `overdue`. */
export const SUSPENSION_REASONS = ['overdue', 'abuse', 'client_request', 'other'] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

/** Days from closing to the earliest purge (Q11), unless the store is demo or test. */
export const PURGE_GRACE_DAYS = 30;

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Usage rolled up per store and day (§3.6). */
export const USAGE_METRICS = [
  'orders',
  'order_total',
  'emails',
  'sms',
  'storage_bytes',
  'products',
  'staff',
  'custom_domains',
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];
/** Summed over a month; the rest are counts at the end of a day, so a month reads its last day. */
export const FLOW_METRICS = [
  'orders',
  'order_total',
  'emails',
  'sms',
] as const satisfies UsageMetric[];

/** Overage is billed per unit beyond a soft limit; only orders for now (Q5). */
export const OVERAGE_METRICS = ['orders', 'emails'] as const;
export type OverageMetric = (typeof OVERAGE_METRICS)[number];

const poisha = z.int().min(0).max(100_000_000_00);
const localized = z.object({
  bn: z.string().trim().min(1).max(100),
  en: z.string().trim().min(1).max(100),
});

export const planInput = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{1,30}$/),
    name: localized,
    monthlyPrice: poisha,
    setupFee: poisha,
    /** Poisha per unit beyond the plan's soft limit. */
    overagePrices: z.partialRecord(z.enum(OVERAGE_METRICS), poisha).default({}),
    entitlements,
    offered: z.boolean().default(true),
  })
  .strict();
export type PlanInput = z.infer<typeof planInput>;

/**
 * The placeholder plans (Q5) until the owner sends the real ones. Plans are
 * data a super admin edits; these only seed an empty table.
 */
export const PLACEHOLDER_PLANS: PlanInput[] = [
  {
    code: 'starter',
    name: { bn: 'স্টার্টার', en: 'Starter' },
    monthlyPrice: 1_500_00,
    setupFee: 5_000_00,
    overagePrices: { orders: 5_00 },
    entitlements: {
      limits: {
        products: 300,
        staff: 3,
        ordersPerMonth: 500,
        emailsPerMonth: 2_000,
        storageMb: 1_000,
        customDomains: 1,
      },
      features: {
        sslcommerz: false,
        sms: false,
        shopperAccounts: true,
        promotionCoupons: true,
        promotionAutomatic: true,
        promotionBuyXGetY: false,
        promotionFreeDelivery: true,
        reports: true,
        customEmailKey: false,
      },
    },
    offered: true,
  },
  {
    code: 'growth',
    name: { bn: 'গ্রোথ', en: 'Growth' },
    monthlyPrice: 4_000_00,
    setupFee: 10_000_00,
    overagePrices: { orders: 3_00 },
    entitlements: {
      limits: {
        products: 2_000,
        staff: 10,
        ordersPerMonth: 3_000,
        emailsPerMonth: 10_000,
        storageMb: 5_000,
        customDomains: 3,
      },
      features: {
        sslcommerz: true,
        sms: true,
        shopperAccounts: true,
        promotionCoupons: true,
        promotionAutomatic: true,
        promotionBuyXGetY: true,
        promotionFreeDelivery: true,
        reports: true,
        customEmailKey: true,
      },
    },
    offered: true,
  },
  {
    code: 'pilot',
    name: { bn: 'পাইলট', en: 'Pilot' },
    monthlyPrice: 0,
    setupFee: 0,
    overagePrices: {},
    entitlements: UNLIMITED,
    offered: false,
  },
];

export const subscriptionInput = z
  .object({
    planId: z.uuid(),
    /** A negotiated monthly price instead of the plan's. */
    priceOverride: poisha.nullable().default(null),
    /** A negotiated setup fee instead of the plan's; billed on the first invoice. */
    setupFeeOverride: poisha.nullable().default(null),
    entitlementOverride: entitlementOverride.nullable().default(null),
    /** 1–28, so every month has it. */
    billingDay: z.int().min(1).max(28),
    trialEndsOn: z.iso.date().nullable().default(null),
  })
  .strict();

// Invoices (§3.7).

export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoiceMachine = defineMachine<InvoiceStatus, 'issue' | 'pay' | 'void'>({
  name: 'invoice',
  initial: 'draft',
  states: INVOICE_STATUSES,
  transitions: {
    draft: { issue: { to: 'issued' }, void: { to: 'void' } },
    issued: { pay: { to: 'paid' }, void: { to: 'void' } },
  },
});

export const INVOICE_LINE_KINDS = ['setup', 'plan', 'overage', 'adjustment', 'vat'] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

export const BILLING_PAYMENT_METHODS = ['bank', 'bkash', 'nagad', 'cash', 'sslcommerz'] as const;
export type BillingPaymentMethod = (typeof BILLING_PAYMENT_METHODS)[number];

/** Drafts are issued automatically this many days after they're made (Q9). */
export const DRAFT_REVIEW_DAYS = 2;
/** An issued invoice is due this many days later. */
export const PAYMENT_TERMS_DAYS = 7;

export interface InvoiceLine {
  kind: InvoiceLineKind;
  description: { bn: string; en: string };
  quantity: number;
  unitPrice: number;
  amount: number;
  metric?: OverageMetric;
}

export interface DraftInput {
  plan: { name: { bn: string; en: string }; monthlyPrice: number; setupFee: number };
  priceOverride: number | null;
  /** The setup fee goes on the store's first invoice only. */
  firstInvoice: boolean;
  setupFeeOverride: number | null;
  /** The coming month, as Dhaka dates: [start, end] inclusive. */
  period: { start: string; end: string };
  /** On the trial: no plan charge for a period that starts before the trial ends. */
  trialEndsOn: string | null;
  /** Last month's use beyond the plan, per metric. */
  overage: { metric: OverageMetric; used: number; included: number | null; unitPrice: number }[];
  /** Basis points (1500 = 15%); null when our company isn't VAT-registered (Q8). */
  vatRateBp: number | null;
}

const OVERAGE_NAMES: Record<OverageMetric, { bn: string; en: string }> = {
  orders: { bn: 'অতিরিক্ত অর্ডার', en: 'Orders beyond the plan' },
  emails: { bn: 'অতিরিক্ত ইমেইল', en: 'Emails beyond the plan' },
};

/** The lines of a drafted invoice and its totals. Lines with nothing to charge are left out. */
export function draftInvoiceLines(input: DraftInput): {
  lines: InvoiceLine[];
  subtotal: number;
  vat: number;
  total: number;
} {
  const lines: InvoiceLine[] = [];
  const setup = input.setupFeeOverride ?? input.plan.setupFee;
  if (input.firstInvoice && setup > 0) {
    lines.push({
      kind: 'setup',
      description: { bn: 'সেটআপ ফি', en: 'Setup fee' },
      quantity: 1,
      unitPrice: setup,
      amount: setup,
    });
  }
  const onTrial = input.trialEndsOn !== null && input.period.start <= input.trialEndsOn;
  const monthly = input.priceOverride ?? input.plan.monthlyPrice;
  if (!onTrial && monthly > 0) {
    lines.push({
      kind: 'plan',
      description: {
        bn: `${input.plan.name.bn}: ${input.period.start} – ${input.period.end}`,
        en: `${input.plan.name.en}: ${input.period.start} – ${input.period.end}`,
      },
      quantity: 1,
      unitPrice: monthly,
      amount: monthly,
    });
  }
  for (const o of input.overage) {
    if (o.included === null || o.unitPrice <= 0) continue;
    const extra = o.used - o.included;
    if (extra <= 0) continue;
    lines.push({
      kind: 'overage',
      description: OVERAGE_NAMES[o.metric],
      quantity: extra,
      unitPrice: o.unitPrice,
      amount: extra * o.unitPrice,
      metric: o.metric,
    });
  }
  return withTotals(lines, input.vatRateBp);
}

/** Totals for a set of lines (VAT lines are recomputed): the sum, then VAT on it, rounded half up. */
export function withTotals(
  lines: readonly InvoiceLine[],
  vatRateBp: number | null,
): { lines: InvoiceLine[]; subtotal: number; vat: number; total: number } {
  const kept = lines.filter((l) => l.kind !== 'vat');
  const subtotal = kept.reduce((s, l) => s + l.amount, 0);
  const rate = vatRateBp ?? 0;
  const vat = subtotal > 0 ? Math.round((subtotal * rate) / 10_000) : 0;
  const out = [...kept];
  if (vat > 0) {
    const pct = `${rate / 100}%`;
    out.push({
      kind: 'vat',
      description: { bn: `ভ্যাট ${pct}`, en: `VAT ${pct}` },
      quantity: 1,
      unitPrice: vat,
      amount: vat,
    });
  }
  return { lines: out, subtotal, vat, total: subtotal + vat };
}

/** `INV-2026-0001`: the year it was issued, then the platform sequence, which never resets. */
export function invoiceNumber(issuedOn: string, sequence: number): string {
  return `INV-${issuedOn.slice(0, 4)}-${String(sequence).padStart(4, '0')}`;
}

/** Issued and past its due date (derived, like delivery status). */
export const isOverdue = (status: InvoiceStatus, dueOn: string | null, today: string) =>
  status === 'issued' && dueOn !== null && today > dueOn;

// Dates: billing runs on Asia/Dhaka days (phase-5a-report, lessons).

const DAY_MS = 86_400_000;
const DHAKA_OFFSET_MS = 6 * 3_600_000;

/** The Dhaka date of an instant, as YYYY-MM-DD. */
export const dhakaDate = (at: Date): string =>
  new Date(at.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** The billing period starting on `start`: to the day before the same day next month. */
export function billingPeriod(start: string): { start: string; end: string } {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m, d));
  return { start, end: addDays(next.toISOString().slice(0, 10), -1) };
}

/** The previous period, whose usage the invoice starting on `start` bills as overage. */
export function previousPeriod(start: string): { start: string; end: string } {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const prev = new Date(Date.UTC(y, m - 2, d)).toISOString().slice(0, 10);
  return { start: prev, end: addDays(start, -1) };
}

// Reminders, grace and suspension (§3.8, Q9).

export const DUNNING_STEPS = [
  { step: 'due_soon', day: -3 },
  { step: 'due_today', day: 0 },
  { step: 'past_due', day: 3 },
  { step: 'final_notice', day: 10 },
  { step: 'suspend', day: 14 },
] as const;
export type DunningStep = (typeof DUNNING_STEPS)[number]['step'];

/**
 * The steps an issued invoice has reached on `today`. The job sends each one
 * once (platform.reminders is unique per invoice and step), so a missed day
 * catches up and a rerun sends nothing twice. A hold skips them all until it
 * ends.
 */
export function dunningDue(
  dueOn: string,
  today: string,
  holdUntil: string | null = null,
): DunningStep[] {
  if (holdUntil !== null && today <= holdUntil) return [];
  const day = daysBetween(dueOn, today);
  return DUNNING_STEPS.filter((s) => day >= s.day).map((s) => s.step);
}

export type { Entitlements };
