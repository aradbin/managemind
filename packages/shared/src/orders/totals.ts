// The money rules every order total follows (phase-4-plan §3.1). Pure
// functions on integer poisha, used by the cart, placeOrder, edits, manual
// orders and the admin's previews alike, so a total is computed one way.
//
// - A line is unit price × quantity.
// - Item discounts go to the lines they target; order discounts go to every
//   line in proportion to what it costs after item discounts (largest
//   remainder, so shares add up exactly); delivery discounts go to the fee.
// - Each promotion's discount is a whole taka, rounded in the shopper's favour.
// - VAT is per line, on the line after discounts, rounded once per line.
//   Prices including VAT leave the total alone; prices excluding VAT add it,
//   and the total is then rounded to a whole taka once (the rounding amount).
// - Nothing goes below zero.
import { allocate, money } from '../money';

/** One taka in poisha. */
export const TAKA = 100;

export interface TotalsLine {
  /** Stable within the calculation: the variant ID in a cart, the line ID on an order. */
  key: string;
  unitPrice: number;
  quantity: number;
  /** The line's VAT rate in basis points (0 when VAT is off or the line is exempt). */
  vatRateBp: number;
}

export type AdjustmentTarget = 'items' | 'order' | 'delivery';

export interface AdjustmentInput {
  /** Stable within the calculation (the promotion ID, or "manual"). */
  key: string;
  target: AdjustmentTarget;
  /**
   * `items`: what each targeted line would get, before whole-taka rounding
   * (the promotion engine's raw amounts). `order` and `delivery`: the amount.
   */
  amount?: number;
  perLine?: Record<string, number>;
  /** Off for manual discounts, which staff type exactly. */
  roundToTaka?: boolean;
}

export interface VatOptions {
  enabled: boolean;
  pricesIncludeVat: boolean;
}

export interface LineTotals {
  key: string;
  quantity: number;
  unitPrice: number;
  /** unit price × quantity */
  subtotal: number;
  discount: number;
  vatRateBp: number;
  vat: number;
  /** subtotal − discount, plus VAT when prices exclude it. */
  total: number;
}

export interface AppliedAdjustment {
  key: string;
  target: AdjustmentTarget;
  amount: number;
  /** Per line, for item and order discounts: they add up to `amount`. */
  allocations: Record<string, number>;
}

export interface Totals {
  lines: LineTotals[];
  adjustments: AppliedAdjustment[];
  subtotal: number;
  /** Item and order discounts (not delivery). */
  discountTotal: number;
  deliveryFee: number;
  deliveryDiscount: number;
  vatTotal: number;
  /** VAT included in the prices: shown as "of which VAT", never added. */
  vatIncluded: boolean;
  rounding: number;
  total: number;
}

const safe = (n: number, what: string) => {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(`${what} must be a non-negative integer`);
  return n;
};

/** A discount rounded up to a whole taka, never more than `max`. */
export function roundDiscount(amount: number, max: number): number {
  if (amount <= 0 || max <= 0) return 0;
  return Math.min(Math.ceil(amount / TAKA) * TAKA, max);
}

/** Half away from zero, to a multiple of `unit`. */
function roundTo(n: number, unit: number): number {
  const sign = n < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(n) + unit / 2) / unit) * unit;
}

/** VAT on an amount at a rate, rounded half away from zero (BigInt, no floats). */
function vatOn(amount: number, rateBp: number, included: boolean): number {
  if (rateBp === 0 || amount === 0) return 0;
  const d = included ? 10_000n + BigInt(rateBp) : 10_000n;
  const n = BigInt(amount) * BigInt(rateBp);
  return Number((n + d / 2n) / d);
}

/**
 * Splits `amount` over lines by weight, capping each at what the line has
 * left; a capped share moves to the other lines. Returns the shares (they
 * add up to `amount` unless every line ran out).
 */
function spread(amount: number, keys: string[], weights: number[], room: Map<string, number>) {
  const out: Record<string, number> = {};
  let left = amount;
  let active = keys.map((k, i) => ({ k, w: weights[i] ?? 0 })).filter((x) => x.w > 0);
  while (left > 0 && active.length) {
    const shares = allocate(
      money(left),
      active.map((x) => x.w),
    );
    let capped = false;
    const next: typeof active = [];
    active.forEach((x, i) => {
      const share = shares[i]?.amount ?? 0;
      const r = room.get(x.k) ?? 0;
      const take = Math.min(share, r);
      if (take < share) capped = true;
      out[x.k] = (out[x.k] ?? 0) + take;
      room.set(x.k, r - take);
      left -= take;
      if (r - take > 0) next.push(x);
    });
    if (!capped) break;
    active = next;
  }
  return out;
}

export interface TotalsInput {
  lines: readonly TotalsLine[];
  /** In order of application; the engine sends item, then order, then delivery. */
  adjustments?: readonly AdjustmentInput[];
  deliveryFee?: number;
  vat?: VatOptions;
}

export function calculateTotals(input: TotalsInput): Totals {
  const vat = input.vat ?? { enabled: false, pricesIncludeVat: true };
  const deliveryFee = safe(input.deliveryFee ?? 0, 'deliveryFee');
  const keys = input.lines.map((l) => l.key);
  if (new Set(keys).size !== keys.length) throw new RangeError('line keys must be unique');
  const subtotals = new Map(
    input.lines.map((l) => [l.key, safe(l.unitPrice, 'unitPrice') * safe(l.quantity, 'quantity')]),
  );
  /** What each line still costs after the discounts applied so far. */
  const room = new Map(subtotals);
  let deliveryLeft = deliveryFee;
  const applied: AppliedAdjustment[] = [];

  const order = { items: 0, order: 1, delivery: 2 } as const;
  const adjustments = [...(input.adjustments ?? [])].sort(
    (a, b) => order[a.target] - order[b.target],
  );
  for (const adj of adjustments) {
    const round = adj.roundToTaka ?? true;
    if (adj.target === 'delivery') {
      const raw = safe(adj.amount ?? 0, 'amount');
      const amount = round ? roundDiscount(raw, deliveryLeft) : Math.min(raw, deliveryLeft);
      deliveryLeft -= amount;
      if (amount > 0) applied.push({ key: adj.key, target: 'delivery', amount, allocations: {} });
      continue;
    }
    let lineKeys: string[];
    let weights: number[];
    let raw: number;
    if (adj.target === 'items') {
      const per = Object.entries(adj.perLine ?? {}).filter(([k, v]) => room.has(k) && v > 0);
      lineKeys = per.map(([k]) => k);
      // Never more than the line has left.
      weights = per.map(([k, v]) => Math.min(safe(v, 'perLine'), room.get(k) ?? 0));
      raw = weights.reduce((a, w) => a + w, 0);
    } else {
      lineKeys = keys;
      weights = keys.map((k) => room.get(k) ?? 0);
      raw = safe(adj.amount ?? 0, 'amount');
    }
    const available = lineKeys.reduce((a, k) => a + (room.get(k) ?? 0), 0);
    const amount = round ? roundDiscount(raw, available) : Math.min(raw, available);
    if (amount <= 0 || weights.every((w) => w === 0)) continue;
    const allocations = spread(amount, lineKeys, weights, room);
    const total = Object.values(allocations).reduce((a, v) => a + v, 0);
    if (total > 0) applied.push({ key: adj.key, target: adj.target, amount: total, allocations });
  }

  const lines: LineTotals[] = input.lines.map((l) => {
    const subtotal = subtotals.get(l.key) ?? 0;
    const discount = subtotal - (room.get(l.key) ?? 0);
    const rate = vat.enabled ? l.vatRateBp : 0;
    const lineVat = vatOn(subtotal - discount, rate, vat.pricesIncludeVat);
    const total = subtotal - discount + (vat.pricesIncludeVat ? 0 : lineVat);
    return {
      key: l.key,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      subtotal,
      discount,
      vatRateBp: rate,
      vat: lineVat,
      total,
    };
  });

  const subtotal = lines.reduce((a, l) => a + l.subtotal, 0);
  const discountTotal = lines.reduce((a, l) => a + l.discount, 0);
  const vatTotal = lines.reduce((a, l) => a + l.vat, 0);
  const deliveryDiscount = deliveryFee - deliveryLeft;
  const beforeRounding = lines.reduce((a, l) => a + l.total, 0) + deliveryLeft;
  // Added VAT can leave poisha; the total is rounded to a whole taka once.
  const rounding =
    vat.enabled && !vat.pricesIncludeVat ? roundTo(beforeRounding, TAKA) - beforeRounding : 0;
  return {
    lines,
    adjustments: applied,
    subtotal,
    discountTotal,
    deliveryFee,
    deliveryDiscount,
    vatTotal,
    vatIncluded: vat.pricesIncludeVat,
    rounding,
    total: Math.max(0, beforeRounding + rounding),
  };
}
