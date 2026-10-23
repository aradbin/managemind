// The promotion engine (phase-4-plan §3.13): one pure function for every
// discount, with no database access. The cart, checkout, manual orders,
// edits and the admin's test cart all call it, so a cart is priced one way.
//
// - Each promotion's conditions must all match; one action each.
// - Item discounts apply first, then order discounts on what remains, then
//   delivery discounts (calculateTotals allocates and rounds them).
// - Combinable promotions apply together, in priority order; an exclusive one
//   applies alone. The shopper gets whichever is worth more: the best
//   exclusive promotion, or all the combinable ones together (Q10).
// - One code per cart, alongside any automatic promotions.
import { money, percentOf } from '@managemind/shared/money';
import {
  ACTION_TARGET,
  type AdjustmentInput,
  calculateTotals,
  type ItemSelection,
  type PromotionAction,
  type PromotionConditions,
  type Totals,
  type VatOptions,
} from '@managemind/shared/orders';
import type { Localized } from '../orders/variants';

export interface PricingLine {
  /** Unique in the calculation: the variant ID in a cart, the line ID on an order. */
  key: string;
  variantId: string;
  productId: string;
  categoryIds: readonly string[];
  /** The collections (among those promotions name) the product is in. */
  collectionIds: readonly string[];
  unitPrice: number;
  quantity: number;
  vatRateBp: number;
}

export interface PromotionRule {
  id: string;
  title: Localized;
  kind: 'automatic' | 'code';
  priority: number;
  exclusive: boolean;
  maxDiscount: number | null;
  conditions: PromotionConditions;
  action: PromotionAction;
  /** For a code promotion: the code applied and its row. */
  code?: string;
  codeId?: string;
}

export interface CustomerFacts {
  phone: string | null;
  tags: readonly string[];
  /** No earlier order from this phone that wasn't cancelled. */
  isFirstOrder: boolean;
}

export interface ManualDiscount {
  /** Poisha; or `percentBp` of what's left after promotions. */
  amount?: number | undefined;
  percentBp?: number | undefined;
  reason: string;
}

export interface PricingInput {
  lines: readonly PricingLine[];
  /** Active automatic promotions, plus the code's promotion when one is applied. */
  promotions: readonly PromotionRule[];
  customer: CustomerFacts;
  zoneId: string | null;
  paymentMethod: 'cod' | 'manual' | 'online' | null;
  deliveryFee: number;
  vat?: VatOptions;
  manualDiscount?: ManualDiscount | null;
}

export type NotAppliedReason =
  | 'min_subtotal'
  | 'min_quantity'
  | 'items'
  | 'zone'
  | 'first_order'
  | 'customer'
  | 'payment_method'
  | 'no_discount'
  | 'better_offer';

export interface AppliedPromotion {
  promotionId: string;
  title: Localized;
  target: 'items' | 'order' | 'delivery';
  amount: number;
  code?: string;
  codeId?: string;
  /** Per line key; empty for delivery discounts. */
  allocations: Record<string, number>;
}

export interface PricingResult {
  totals: Totals;
  applied: AppliedPromotion[];
  /** Promotions that were considered and why each didn't apply (the test cart shows these). */
  notApplied: { promotionId: string; code?: string; reason: NotAppliedReason }[];
  manual: { amount: number; allocations: Record<string, number>; reason: string } | null;
  /** The nearest automatic free-delivery offer the cart doesn't reach yet. */
  freeDelivery: { threshold: number; remaining: number } | null;
}

export function matchesSelection(line: PricingLine, s: ItemSelection): boolean {
  return Boolean(
    s.productIds?.includes(line.productId) ||
      s.variantIds?.includes(line.variantId) ||
      s.categoryIds?.some((id) => line.categoryIds.includes(id)) ||
      s.collectionIds?.some((id) => line.collectionIds.includes(id)),
  );
}

const lineSubtotal = (l: PricingLine) => l.unitPrice * l.quantity;

/** Why a promotion's conditions don't match, or null when they all do. */
export function checkConditions(
  p: PromotionRule,
  input: Pick<PricingInput, 'lines' | 'customer' | 'zoneId' | 'paymentMethod'>,
): NotAppliedReason | null {
  const c = p.conditions;
  const scope = c.items
    ? input.lines.filter((l) => matchesSelection(l, c.items as ItemSelection))
    : input.lines;
  if (c.items && scope.length === 0) return 'items';
  if (c.minQuantity && scope.reduce((a, l) => a + l.quantity, 0) < c.minQuantity)
    return 'min_quantity';
  if (c.minSubtotal && scope.reduce((a, l) => a + lineSubtotal(l), 0) < c.minSubtotal)
    return 'min_subtotal';
  if (c.zoneIds && (!input.zoneId || !c.zoneIds.includes(input.zoneId))) return 'zone';
  if (c.firstOrder && !input.customer.isFirstOrder) return 'first_order';
  if (
    c.customerPhones &&
    (!input.customer.phone || !c.customerPhones.includes(input.customer.phone))
  )
    return 'customer';
  if (c.customerTags && !c.customerTags.some((t) => input.customer.tags.includes(t)))
    return 'customer';
  if (c.paymentMethods && (!input.paymentMethod || !c.paymentMethods.includes(input.paymentMethod)))
    return 'payment_method';
  return null;
}

const pct = (amount: number, bp: number) => percentOf(money(amount), bp).amount;

interface Room {
  lines: Map<string, number>;
  delivery: number;
}

/** Units of a line, one entry per unit, for buy X get Y. */
function units(lines: readonly PricingLine[], room: Room) {
  return lines.flatMap((l) => {
    // A unit's price after earlier item discounts, spread evenly.
    const per = Math.floor((room.lines.get(l.key) ?? 0) / l.quantity);
    return Array.from({ length: l.quantity }, (_, i) => ({
      key: `${l.key}#${i}`,
      line: l.key,
      price: per,
      l,
    }));
  });
}

function buyXGetY(
  action: Extract<PromotionAction, { type: 'buy_x_get_y' }>,
  lines: readonly PricingLine[],
  room: Room,
): Record<string, number> {
  const all = units(lines, room);
  const inBuy = (u: (typeof all)[number]) => matchesSelection(u.l, action.buy.items);
  const inGet = (u: (typeof all)[number]) =>
    matchesSelection(u.l, action.get.items ?? action.buy.items);
  // The cheapest qualifying units are discounted; the dearest ones count as bought.
  const getPool = all.filter(inGet).sort((a, b) => a.price - b.price || (a.key < b.key ? -1 : 1));
  const free = new Set<string>();
  let uses = 0;
  const max = action.maxUses ?? Number.POSITIVE_INFINITY;
  while (uses < max) {
    const chosen = getPool.filter((u) => !free.has(u.key)).slice(0, action.get.quantity);
    if (chosen.length < action.get.quantity) break;
    const taken = new Set([...free, ...chosen.map((u) => u.key)]);
    const buyable = all.filter((u) => inBuy(u) && !taken.has(u.key)).length;
    // Each use needs its own N bought units, apart from every discounted unit.
    if (buyable < action.buy.quantity * (uses + 1)) break;
    for (const u of chosen) free.add(u.key);
    uses += 1;
  }
  const perLine: Record<string, number> = {};
  for (const u of all) {
    if (free.has(u.key))
      perLine[u.line] = (perLine[u.line] ?? 0) + pct(u.price, action.get.percentBp);
  }
  return perLine;
}

/** A promotion's raw adjustment against what's left, before rounding and allocation. */
function rawAdjustment(
  p: PromotionRule,
  lines: readonly PricingLine[],
  room: Room,
): AdjustmentInput | null {
  const a = p.action;
  const target = ACTION_TARGET[a.type];
  const remaining = [...room.lines.values()].reduce((x, y) => x + y, 0);
  let adj: AdjustmentInput;
  switch (a.type) {
    case 'percent_off_order':
      adj = { key: p.id, target, amount: pct(remaining, a.percentBp) };
      break;
    case 'amount_off_order':
      adj = { key: p.id, target, amount: a.amount };
      break;
    case 'percent_off_items': {
      const perLine: Record<string, number> = {};
      for (const l of lines)
        if (matchesSelection(l, a.target))
          perLine[l.key] = pct(room.lines.get(l.key) ?? 0, a.percentBp);
      adj = { key: p.id, target, perLine };
      break;
    }
    case 'amount_off_items': {
      const perLine: Record<string, number> = {};
      for (const l of lines)
        if (matchesSelection(l, a.target)) perLine[l.key] = a.amount * l.quantity;
      adj = { key: p.id, target, perLine };
      break;
    }
    case 'buy_x_get_y':
      adj = { key: p.id, target, perLine: buyXGetY(a, lines, room) };
      break;
    case 'delivery_percent_off':
      adj = { key: p.id, target, amount: pct(room.delivery, a.percentBp) };
      break;
    case 'delivery_amount_off':
      adj = { key: p.id, target, amount: a.amount };
      break;
  }
  // The promotion's cap, spread over its lines in proportion.
  const cap = p.maxDiscount;
  if (cap !== null) {
    if (adj.perLine) {
      const total = Object.values(adj.perLine).reduce((x, y) => x + y, 0);
      if (total > cap) {
        const scaled: Record<string, number> = {};
        let left = cap;
        const entries = Object.entries(adj.perLine);
        entries.forEach(([k, v], i) => {
          const share = i === entries.length - 1 ? left : Math.floor((v * cap) / total);
          scaled[k] = share;
          left -= share;
        });
        adj = { ...adj, perLine: scaled };
      }
    } else if ((adj.amount ?? 0) > cap) {
      adj = { ...adj, amount: cap };
    }
  }
  const worth = adj.perLine
    ? Object.values(adj.perLine).reduce((x, y) => x + y, 0)
    : (adj.amount ?? 0);
  return worth > 0 ? adj : null;
}

const ORDER = { items: 0, order: 1, delivery: 2 } as const;

/** Applies a set of promotions in order, each against what the earlier ones left. */
function applySet(set: readonly PromotionRule[], input: PricingInput) {
  const room: Room = {
    lines: new Map(input.lines.map((l) => [l.key, lineSubtotal(l)])),
    delivery: input.deliveryFee,
  };
  const sorted = [...set].sort(
    (a, b) =>
      ORDER[ACTION_TARGET[a.action.type]] - ORDER[ACTION_TARGET[b.action.type]] ||
      b.priority - a.priority ||
      (a.id < b.id ? -1 : 1),
  );
  const adjustments: AdjustmentInput[] = [];
  const empty: PromotionRule[] = [];
  for (const p of sorted) {
    const adj = rawAdjustment(p, input.lines, room);
    if (!adj) {
      empty.push(p);
      continue;
    }
    adjustments.push(adj);
    // What this one leaves for the next, as calculateTotals will count it.
    const t = calculateTotals({
      lines: toTotalsLines(input.lines),
      adjustments,
      deliveryFee: input.deliveryFee,
    });
    room.delivery = t.deliveryFee - t.deliveryDiscount;
    for (const l of t.lines) room.lines.set(l.key, l.subtotal - l.discount);
  }
  const totals = calculateTotals({
    lines: toTotalsLines(input.lines),
    adjustments,
    deliveryFee: input.deliveryFee,
    ...(input.vat ? { vat: input.vat } : {}),
  });
  const worth = totals.discountTotal + totals.deliveryDiscount;
  return { adjustments, totals, worth, empty };
}

const toTotalsLines = (lines: readonly PricingLine[]) =>
  lines.map((l) => ({
    key: l.key,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    vatRateBp: l.vatRateBp,
  }));

export function priceCart(input: PricingInput): PricingResult {
  const notApplied: PricingResult['notApplied'] = [];
  const reject = (p: PromotionRule, reason: NotAppliedReason) =>
    notApplied.push({ promotionId: p.id, reason, ...(p.code ? { code: p.code } : {}) });
  const qualifying: PromotionRule[] = [];
  for (const p of input.promotions) {
    const reason = checkConditions(p, input);
    if (reason) reject(p, reason);
    else qualifying.push(p);
  }

  // Combinable together, or the best exclusive one alone (Q10).
  const candidates = [
    { set: qualifying.filter((p) => !p.exclusive) },
    ...qualifying.filter((p) => p.exclusive).map((p) => ({ set: [p] })),
  ].map((c) => ({ ...c, result: applySet(c.set, input) }));
  const best = candidates.reduce((a, b) => (b.result.worth > a.result.worth ? b : a));
  for (const p of qualifying) {
    if (best.result.empty.includes(p)) reject(p, 'no_discount');
    else if (!best.set.includes(p)) reject(p, 'better_offer');
  }
  const byId = new Map(input.promotions.map((p) => [p.id, p]));
  const applied: AppliedPromotion[] = best.result.totals.adjustments.map((a) => {
    const p = byId.get(a.key) as PromotionRule;
    return {
      promotionId: p.id,
      title: p.title,
      target: a.target,
      amount: a.amount,
      allocations: a.allocations,
      ...(p.code ? { code: p.code } : {}),
      ...(p.codeId ? { codeId: p.codeId } : {}),
    };
  });

  // Staff's manual discount comes last, on what promotions left, exactly as typed.
  let totals = best.result.totals;
  let manual: PricingResult['manual'] = null;
  const m = input.manualDiscount;
  if (m && (m.amount || m.percentBp)) {
    const left = totals.subtotal - totals.discountTotal;
    const amount = m.amount ?? pct(left, m.percentBp ?? 0);
    totals = calculateTotals({
      lines: toTotalsLines(input.lines),
      adjustments: [
        ...best.result.adjustments,
        { key: 'manual', target: 'order', amount, roundToTaka: false },
      ],
      deliveryFee: input.deliveryFee,
      ...(input.vat ? { vat: input.vat } : {}),
    });
    const applied = totals.adjustments.find((a) => a.key === 'manual');
    if (applied)
      manual = { amount: applied.amount, allocations: applied.allocations, reason: m.reason };
  }

  // The nearest automatic free-delivery offer the cart misses only on its minimum.
  let freeDelivery: PricingResult['freeDelivery'] = null;
  if (totals.deliveryFee - totals.deliveryDiscount > 0) {
    const subtotal = input.lines.reduce((a, l) => a + lineSubtotal(l), 0);
    for (const p of input.promotions) {
      if (p.kind !== 'automatic' || p.action.type !== 'delivery_percent_off') continue;
      if (p.action.percentBp !== 10_000 || !p.conditions.minSubtotal || p.conditions.items)
        continue;
      const { minSubtotal: _min, ...rest } = p.conditions;
      if (checkConditions({ ...p, conditions: rest }, input) !== null) continue;
      const remaining = p.conditions.minSubtotal - subtotal;
      if (remaining > 0 && (!freeDelivery || remaining < freeDelivery.remaining))
        freeDelivery = { threshold: p.conditions.minSubtotal, remaining };
    }
  }
  return { totals, applied, notApplied, manual, freeDelivery };
}
