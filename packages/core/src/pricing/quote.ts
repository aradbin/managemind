// A quote: any set of lines priced the one way (phase-4-plan §3.1, §3.4):
// current prices and stock, the delivery zone and fee, the store's VAT, and
// the promotion engine. The cart shows it, checkout re-runs it inside the
// order's transaction, and manual orders, edits and the test cart preview it.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { collectionRules } from '@managemind/shared/catalog';
import {
  type CheckoutSettings,
  type CodSettings,
  PROMOTION_LIMITS,
  type PromotionAction,
  type PromotionConditions,
  type Totals,
} from '@managemind/shared/orders';
import { type TaxSettings, tenantSettings } from '@managemind/shared/settings';
import type { HolidaySettings, StorefrontSettings } from '@managemind/shared/storefront';
import { eq, type SQL, sql } from 'drizzle-orm';
import { rulesSql } from '../catalog/collections';
import type { Locale } from '../catalog/common';
import type { StoreImage } from '../catalog/published';
import { type Localized, loadVariants, type OrderableVariant, vatRateOf } from '../orders/variants';
import {
  type DeliveryZone,
  deliveryFee,
  getZone,
  lowestDeliveryFee,
  zoneForArea,
} from '../orders/zones';
import type { TenantTx } from '../tenant';
import {
  type AppliedPromotion,
  type CustomerFacts,
  type ManualDiscount,
  type NotAppliedReason,
  type PricingLine,
  type PromotionRule,
  priceCart,
} from './engine';

/** What orders need from the store's settings. */
export interface OrderSettings {
  name: string;
  defaultLocale: Locale;
  tax: TaxSettings;
  checkout: CheckoutSettings;
  cod: CodSettings;
  holiday: HolidaySettings | null;
  storefront: StorefrontSettings;
  settings: ReturnType<typeof tenantSettings.parse>;
}

export async function orderSettings(tx: TenantTx): Promise<OrderSettings> {
  const t = schema.tenants;
  const [row] = await tx.db
    .select({ name: t.name, defaultLocale: t.defaultLocale, settings: t.settings })
    .from(t)
    .where(eq(t.id, tx.tenantId));
  if (!row) throw new AppError('store_not_found');
  const settings = tenantSettings.parse(row.settings);
  return {
    name: row.name,
    defaultLocale: row.defaultLocale,
    tax: settings.tax,
    checkout: settings.checkout,
    cod: settings.cod,
    holiday: settings.storefront.holiday,
    storefront: settings.storefront,
    settings,
  };
}

// ---- Promotions ---------------------------------------------------------------------

export type CodeStatus =
  | 'applied'
  | 'not_found'
  | 'inactive'
  | 'used_up'
  | Exclude<NotAppliedReason, 'no_discount'>
  | 'no_discount';

type PromotionRow = {
  id: string;
  title: Localized;
  kind: 'automatic' | 'code';
  priority: number;
  exclusive: boolean;
  maxDiscount: string | number | null;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  conditions: PromotionConditions;
  action: PromotionAction;
  live: boolean;
};

const PROMOTION_COLUMNS = sql`p.id, p.title, p.kind, p.priority, p.exclusive, p.max_discount as "maxDiscount",
  p.usage_limit as "usageLimit", p.usage_count as "usageCount", p.per_customer_limit as "perCustomerLimit",
  p.conditions, p.action,
  (p.status = 'active' and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now())) as live`;

const toRule = (r: PromotionRow, code?: { code: string; id: string }): PromotionRule => ({
  id: r.id,
  title: r.title,
  kind: r.kind,
  priority: r.priority,
  exclusive: r.exclusive,
  maxDiscount: r.maxDiscount === null ? null : Number(r.maxDiscount),
  conditions: r.conditions,
  action: r.action,
  ...(code ? { code: code.code, codeId: code.id } : {}),
});

/** Uses this phone has left of a promotion with a per-customer limit. */
async function usedUp(tx: TenantTx, r: PromotionRow, phone: string | null): Promise<boolean> {
  if (r.usageLimit !== null && r.usageCount >= r.usageLimit) return true;
  if (r.perCustomerLimit === null || !phone) return false;
  const { rows } = await tx.db.execute<{ count: number }>(sql`
    select count from store.promotion_customer_usage where promotion_id = ${r.id} and phone = ${phone}`);
  return (rows[0]?.count ?? 0) >= r.perCustomerLimit;
}

export interface LoadedPromotions {
  rules: PromotionRule[];
  /** The code's state before the engine runs; the engine may still turn it down. */
  code: { code: string; status: CodeStatus; promotionId: string | null } | null;
}

/** The live automatic promotions, plus the code's promotion when it can apply. */
export async function loadPromotions(
  tx: TenantTx,
  code: string | null,
  phone: string | null,
): Promise<LoadedPromotions> {
  const { rows } = await tx.db.execute<PromotionRow>(sql`
    select ${PROMOTION_COLUMNS} from store.promotions p
     where p.kind = 'automatic' and p.status = 'active'
       and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now())
     order by p.priority desc, p.id limit ${PROMOTION_LIMITS.activeAutomatic}`);
  const rules: PromotionRule[] = [];
  for (const r of rows) if (!(await usedUp(tx, r, phone))) rules.push(toRule(r));
  if (!code) return { rules, code: null };

  const { rows: found } = await tx.db.execute<
    PromotionRow & { codeId: string; codeText: string; codeLimit: number | null; codeCount: number }
  >(sql`
    select ${PROMOTION_COLUMNS}, c.id as "codeId", c.code as "codeText",
           c.usage_limit as "codeLimit", c.usage_count as "codeCount"
      from store.promotion_codes c join store.promotions p on p.id = c.promotion_id
     where upper(c.code) = upper(${code})`);
  const hit = found[0];
  if (!hit) return { rules, code: { code, status: 'not_found', promotionId: null } };
  const promotionId = hit.id;
  if (!hit.live) return { rules, code: { code: hit.codeText, status: 'inactive', promotionId } };
  if ((hit.codeLimit !== null && hit.codeCount >= hit.codeLimit) || (await usedUp(tx, hit, phone)))
    return { rules, code: { code: hit.codeText, status: 'used_up', promotionId } };
  rules.push(toRule(hit, { code: hit.codeText, id: hit.codeId }));
  return { rules, code: { code: hit.codeText, status: 'applied', promotionId } };
}

/** An order's own promotions, whatever their state now, for re-checking after an edit. */
async function promotionsById(
  tx: TenantTx,
  list: { id: string; code: string | null; codeId: string | null }[],
): Promise<PromotionRule[]> {
  if (!list.length) return [];
  const { rows } = await tx.db.execute<PromotionRow>(sql`
    select ${PROMOTION_COLUMNS} from store.promotions p
     where p.id = any(${sql.param(list.map((x) => x.id))}::uuid[])`);
  return rows.map((r) => {
    const own = list.find((x) => x.id === r.id);
    return toRule(r, own?.code && own.codeId ? { code: own.code, id: own.codeId } : undefined);
  });
}

/** For each product, the collections it is in among those the promotions name. */
async function collectionsOf(
  tx: TenantTx,
  productIds: string[],
  rules: readonly PromotionRule[],
): Promise<Map<string, string[]>> {
  const named = new Set<string>();
  const add = (s?: { collectionIds?: string[] | undefined }) => {
    for (const id of s?.collectionIds ?? []) named.add(id);
  };
  for (const r of rules) {
    add(r.conditions.items);
    const a = r.action;
    if (a.type === 'percent_off_items' || a.type === 'amount_off_items') add(a.target);
    if (a.type === 'buy_x_get_y') {
      add(a.buy.items);
      add(a.get.items);
    }
  }
  const out = new Map<string, string[]>();
  if (!named.size || !productIds.length) return out;
  const { rows: collections } = await tx.db.execute<{
    id: string;
    kind: string;
    rules: unknown;
  }>(sql`
    select id, kind, rules from store.collections where id = any(${sql.param([...named])}::uuid[])`);
  for (const c of collections) {
    const match: SQL =
      c.kind === 'manual'
        ? sql`exists (select 1 from store.collection_products cp where cp.product_id = p.id and cp.collection_id = ${c.id})`
        : rulesSql(collectionRules.parse(c.rules));
    const { rows } = await tx.db.execute<{ id: string }>(sql`
      select p.id from store.products p where p.id = any(${sql.param(productIds)}::uuid[]) and ${match}`);
    for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), c.id]);
  }
  return out;
}

/** The customer facts promotions check, by the normalized phone. */
export async function customerFacts(tx: TenantTx, phone: string | null): Promise<CustomerFacts> {
  if (!phone) return { phone: null, tags: [], isFirstOrder: true };
  const { rows } = await tx.db.execute<{ tags: string[]; orders: number }>(sql`
    select c.tags, (select count(*)::int from store.orders o
                     where o.customer_id = c.id and o.status <> 'cancelled') as orders
      from store.customers c where c.phone = ${phone} and c.deleted_at is null`);
  const c = rows[0];
  return { phone, tags: c?.tags ?? [], isFirstOrder: !c || c.orders === 0 };
}

// ---- The quote ----------------------------------------------------------------------

export type LineProblem = 'unavailable' | 'insufficient_stock' | 'over_limit';

export interface QuoteLine {
  key: string;
  variantId: string;
  productId: string;
  title: Localized;
  slugs: Localized;
  optionLabels: Localized[];
  sku: string | null;
  image: StoreImage | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  /** What can still be ordered of this variant; null when unlimited. */
  maxQuantity: number | null;
  problem: LineProblem | null;
}

export interface Quote {
  lines: QuoteLine[];
  zone: Pick<DeliveryZone, 'id' | 'name' | 'estimate'> | null;
  /** "From ৳70" before an area is chosen. */
  deliveryFrom: number | null;
  weightGrams: number;
  totals: Totals;
  promotions: AppliedPromotion[];
  code: { code: string; status: CodeStatus } | null;
  freeDelivery: { threshold: number; remaining: number } | null;
  manualDiscount: { amount: number; reason: string } | null;
  /** Lines the engine priced (unavailable ones are left out), for placeOrder. */
  priced: { line: PricingLine; variant: OrderableVariant }[];
  allocations: Record<string, Record<string, number>>;
  notApplied: { promotionId: string; code?: string; reason: NotAppliedReason }[];
}

export interface QuoteInput {
  lines: readonly { variantId: string; quantity: number; key?: string }[];
  /** The delivery area; null before one is chosen. */
  areaId: number | null;
  /** Staff's choice of zone, or 'none' for no delivery (walk-ins, §3.12). */
  zone?: { id: string } | 'none' | undefined;
  /** Staff's override of the fee, with a reason (§3.9). */
  deliveryFeeOverride?: number | undefined;
  code: string | null;
  phone: string | null;
  paymentMethod: 'cod' | 'manual' | null;
  manualDiscount?: ManualDiscount | null | undefined;
  /** The store's per-line limit; staff entering orders aren't held to it. */
  maxQuantityPerLine: number | null;
  settings: OrderSettings;
  /**
   * Editing an order (§3.9): only the promotions applied at placement are
   * re-checked (live or not), and existing lines keep the price they were
   * ordered at.
   */
  edit?:
    | {
        promotions: { id: string; code: string | null; codeId: string | null }[];
        unitPrices: Record<string, number>;
      }
    | undefined;
  /** The admin's test cart (§3.13): promotions to try as if live, such as one being built. */
  extraRules?: readonly PromotionRule[] | undefined;
}

export async function quote(tx: TenantTx, input: QuoteInput): Promise<Quote> {
  const variants = await loadVariants(
    tx,
    input.lines.map((l) => l.variantId),
  );
  const loaded = input.edit
    ? { rules: await promotionsById(tx, input.edit.promotions), code: null }
    : await loadPromotions(tx, input.code, input.phone);
  if (input.extraRules?.length) {
    const extra = new Set(input.extraRules.map((r) => r.id));
    loaded.rules = [...loaded.rules.filter((r) => !extra.has(r.id)), ...input.extraRules];
  }
  const facts = await customerFacts(tx, input.phone);

  // The zone: the staff's choice, else the area's.
  let zone: DeliveryZone | null = null;
  if (input.zone && input.zone !== 'none') zone = await getZone(tx, input.zone.id);
  else if (!input.zone && input.areaId !== null) zone = await zoneForArea(tx, input.areaId);

  const lines: QuoteLine[] = [];
  const priced: Quote['priced'] = [];
  const productIds = [...new Set([...variants.values()].map((v) => v.productId))];
  const collections = await collectionsOf(tx, productIds, loaded.rules);
  for (const l of input.lines) {
    const v = variants.get(l.variantId);
    const key = l.key ?? l.variantId;
    if (!v) {
      lines.push({
        key,
        variantId: l.variantId,
        productId: '',
        title: {},
        slugs: {},
        optionLabels: [],
        sku: null,
        image: null,
        unitPrice: 0,
        compareAtPrice: null,
        quantity: l.quantity,
        subtotal: 0,
        discount: 0,
        vat: 0,
        total: 0,
        maxQuantity: 0,
        problem: 'unavailable',
      });
      continue;
    }
    const stockCap = !v.trackInventory || v.allowBackorder ? null : Math.max(0, v.available);
    const limits = [stockCap, input.maxQuantityPerLine].filter((x): x is number => x !== null);
    const maxQuantity = limits.length ? Math.min(...limits) : null;
    const problem: LineProblem | null = !v.live
      ? 'unavailable'
      : stockCap !== null && l.quantity > stockCap
        ? 'insufficient_stock'
        : input.maxQuantityPerLine !== null && l.quantity > input.maxQuantityPerLine
          ? 'over_limit'
          : null;
    const unitPrice = input.edit?.unitPrices[v.id] ?? v.price;
    const line: QuoteLine = {
      key,
      variantId: v.id,
      productId: v.productId,
      title: v.title,
      slugs: v.slugs,
      optionLabels: v.optionLabels,
      sku: v.sku,
      image: v.image,
      unitPrice,
      compareAtPrice: v.compareAtPrice,
      quantity: l.quantity,
      subtotal: 0,
      discount: 0,
      vat: 0,
      total: 0,
      maxQuantity: v.live ? maxQuantity : 0,
      problem,
    };
    lines.push(line);
    if (v.live) {
      priced.push({
        variant: { ...v, price: unitPrice },
        line: {
          key,
          variantId: v.id,
          productId: v.productId,
          categoryIds: v.categoryIds,
          collectionIds: collections.get(v.productId) ?? [],
          unitPrice,
          quantity: l.quantity,
          vatRateBp: vatRateOf(input.settings.tax, v.vatCategory),
        },
      });
    }
  }

  const weightGrams = priced.reduce((a, p) => a + p.variant.weightGrams * p.line.quantity, 0);
  const fee =
    input.deliveryFeeOverride !== undefined
      ? input.deliveryFeeOverride
      : zone && priced.length
        ? deliveryFee(zone, weightGrams)
        : 0;
  const result = priceCart({
    lines: priced.map((p) => p.line),
    promotions: loaded.rules,
    customer: facts,
    zoneId: zone?.id ?? null,
    paymentMethod: input.paymentMethod,
    deliveryFee: fee,
    vat: {
      enabled: input.settings.tax.vatEnabled,
      pricesIncludeVat: input.settings.tax.pricesIncludeVat,
    },
    manualDiscount: input.manualDiscount ?? null,
  });
  const byKey = new Map(result.totals.lines.map((t) => [t.key, t]));
  for (const line of lines) {
    const t = byKey.get(line.key);
    if (t)
      Object.assign(line, {
        subtotal: t.subtotal,
        discount: t.discount,
        vat: t.vat,
        total: t.total,
      });
  }

  let code: Quote['code'] = null;
  if (loaded.code) {
    const turnedDown = result.notApplied.find((n) => n.promotionId === loaded.code?.promotionId);
    code = { code: loaded.code.code, status: turnedDown ? turnedDown.reason : loaded.code.status };
  }
  const allocations: Quote['allocations'] = {};
  for (const a of result.applied) allocations[a.promotionId] = a.allocations;
  if (result.manual) allocations.manual = result.manual.allocations;

  return {
    lines,
    zone: zone ? { id: zone.id, name: zone.name, estimate: zone.estimate } : null,
    deliveryFrom: zone || input.zone === 'none' ? null : await lowestDeliveryFee(tx),
    weightGrams,
    totals: result.totals,
    promotions: result.applied,
    code,
    freeDelivery: result.freeDelivery,
    manualDiscount: result.manual
      ? { amount: result.manual.amount, reason: result.manual.reason }
      : null,
    priced,
    allocations,
    notApplied: result.notApplied,
  };
}
