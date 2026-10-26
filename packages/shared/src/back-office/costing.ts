// The back office's arithmetic (phase-8-plan §3.2, §3.3, §3.6, §3.7, ADR
// 0031): the moving weighted average, other costs landed by value, PO
// totals, supplier ageing and recurring dates. Pure, in integer poisha, so
// the services, the admin's previews and the tests compute the same numbers.

/** Rounds half away from zero, for amounts that are never negative here. */
const round = (x: number) => Math.round(x);

/**
 * A variant's cost after a receipt of `quantity` units at `landedUnitCost`
 * onto `onHand` units at `cost` (§3.3): the weighted average, rounded to the
 * poisha. Nothing (or less than nothing) on hand, or no cost yet, takes the
 * receipt's cost.
 */
export function weightedAverageCost(
  onHand: number,
  cost: number | null,
  quantity: number,
  landedUnitCost: number,
): number {
  if (quantity <= 0) return cost ?? landedUnitCost;
  if (cost === null || onHand <= 0) return landedUnitCost;
  return round((onHand * cost + quantity * landedUnitCost) / (onHand + quantity));
}

/**
 * Splits `total` over `weights` in proportion, in whole poisha, so the parts
 * sum to `total` exactly: the remainder of the rounding goes to the largest
 * weight (the first of equals). All-zero weights split it evenly instead.
 */
export function spreadByWeight(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, w) => a + w, 0);
  const basis = sum > 0 ? weights : weights.map(() => 1);
  const basisSum = sum > 0 ? sum : weights.length;
  const parts = basis.map((w) => Math.floor((total * w) / basisSum));
  const left = total - parts.reduce((a, p) => a + p, 0);
  let largest = 0;
  for (let i = 1; i < basis.length; i++) {
    if ((basis[i] as number) > (basis[largest] as number)) largest = i;
  }
  parts[largest] = (parts[largest] as number) + left;
  return parts;
}

export interface CostLine {
  quantity: number;
  unitCost: number;
}

/** Lines' value, the other costs and the total (§3.2). */
export function purchaseTotals(
  lines: readonly CostLine[],
  otherCosts: readonly { amount: number }[],
): { subtotal: number; otherCostTotal: number; total: number } {
  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitCost, 0);
  const otherCostTotal = otherCosts.reduce((a, c) => a + c.amount, 0);
  return { subtotal, otherCostTotal, total: subtotal + otherCostTotal };
}

/**
 * Each line's landed unit cost (§3.3): its own cost plus its share of the
 * receipt's other costs, spread by value, per unit and rounded to the poisha.
 */
export function landedUnitCosts(lines: readonly CostLine[], otherCostTotal: number): number[] {
  const values = lines.map((l) => l.quantity * l.unitCost);
  // Goods that cost nothing (a free sample batch) share by units instead.
  const weights = values.some((v) => v > 0) ? values : lines.map((l) => l.quantity);
  const shares = spreadByWeight(otherCostTotal, weights);
  return lines.map((l, i) =>
    l.quantity > 0 ? round((l.quantity * l.unitCost + (shares[i] as number)) / l.quantity) : 0,
  );
}

/**
 * A receipt's share of its PO's other costs (Q4): the other costs in
 * proportion to the PO's value received so far, less what earlier receipts
 * already carried. The receipt that completes the PO carries the rest, so
 * the shares always sum to the other costs.
 *
 * - `poValue`: the PO's lines at their ordered quantities and costs;
 * - `receivedBefore` / `receivedNow`: value received, at the PO's costs;
 * - `allocatedBefore`: what earlier receipts carried.
 */
export function purchaseOrderCostShare(input: {
  otherCostTotal: number;
  poValue: number;
  receivedBefore: number;
  receivedNow: number;
  allocatedBefore: number;
  completes: boolean;
}): number {
  const left = Math.max(0, input.otherCostTotal - input.allocatedBefore);
  if (input.completes) return left;
  if (input.poValue <= 0) return 0;
  const reached = Math.min(input.poValue, input.receivedBefore + input.receivedNow);
  const due = Math.floor((input.otherCostTotal * reached) / input.poValue) - input.allocatedBefore;
  return Math.min(left, Math.max(0, due));
}

// ---- Supplier ageing (§3.7) ------------------------------------------------------------

export const AGEING_BUCKETS = ['0_30', '31_60', '61_90', 'over_90'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export const ageingBucket = (days: number): AgeingBucket =>
  days <= 30 ? '0_30' : days <= 60 ? '31_60' : days <= 90 ? '61_90' : 'over_90';

/**
 * What the store owes a supplier, by age (§3.7): payments are applied to the
 * oldest debts first (the opening balance, which predates everything here,
 * then receipts by date), and what remains of each debt is bucketed by its
 * age on `today`. A balance at or below zero (an advance) owes nothing.
 */
export function supplierAgeing(input: {
  /** The opening balance's date: the supplier's first day here. */
  openedOn: string;
  openingBalance: number;
  receipts: readonly { on: string; amount: number }[];
  paid: number;
  today: string;
}): { balance: number; buckets: Record<AgeingBucket, number> } {
  const debts = [
    ...(input.openingBalance > 0 ? [{ on: input.openedOn, amount: input.openingBalance }] : []),
    ...input.receipts
      .filter((r) => r.amount > 0)
      .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0)),
  ];
  let credit = input.paid + Math.max(0, -input.openingBalance);
  const buckets = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<
    AgeingBucket,
    number
  >;
  for (const debt of debts) {
    const used = Math.min(credit, debt.amount);
    credit -= used;
    const left = debt.amount - used;
    if (left > 0) buckets[ageingBucket(daysBetween(debt.on, input.today))] += left;
  }
  const balance =
    input.openingBalance + input.receipts.reduce((a, r) => a + r.amount, 0) - input.paid;
  return { balance, buckets };
}

// ---- Recurring expenses (§3.6) ---------------------------------------------------------

export interface RecurringSchedule {
  cadence: 'monthly' | 'weekly';
  /** Monthly: 1–28, or 0 for the last day. Weekly: 1 (Monday) to 7 (Sunday). */
  day: number;
  startsOn: string;
  endsOn: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) =>
  iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS));

/** The schedule's day in the month of `date`. */
function monthlyDay(date: string, day: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m - 1, day === 0 ? last : day)));
}

/** The first day on or after `from` that the schedule posts on; null past its end. */
export function nextOccurrence(s: RecurringSchedule, from: string): string | null {
  const start = from > s.startsOn ? from : s.startsOn;
  let next: string;
  if (s.cadence === 'weekly') {
    const weekday = new Date(`${start}T00:00:00Z`).getUTCDay() || 7;
    next = addDays(start, (s.day - weekday + 7) % 7);
  } else {
    next = monthlyDay(start, s.day);
    if (next < start) {
      const [y, m] = start.split('-').map(Number) as [number, number];
      next = monthlyDay(iso(new Date(Date.UTC(y, m, 1))), s.day);
    }
  }
  return s.endsOn !== null && next > s.endsOn ? null : next;
}

/**
 * Every day from `from` to `to` (inclusive) the schedule posts on: what a
 * late or repeated daily batch posts (each once, by the unique index).
 */
export function occurrences(s: RecurringSchedule, from: string, to: string): string[] {
  const out: string[] = [];
  let next = nextOccurrence(s, from);
  while (next !== null && next <= to && out.length < 400) {
    out.push(next);
    next = nextOccurrence(s, addDays(next, 1));
  }
  return out;
}
