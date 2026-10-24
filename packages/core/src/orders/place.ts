// placeOrder (phase-4-plan §3.5, §3.12): one command for the storefront's
// checkout and staff's manual orders, in one transaction. It revalidates and
// reprices everything, reserves stock (where the second shopper for the last
// unit stops), counts promotion uses with conditional updates, finds or
// creates the customer, takes the order number late (so the counter's lock
// is held for milliseconds), writes the order with its snapshots, payments
// and history, and marks the cart converted.
import { schema } from '@managemind/db';
import { AppError, uuidv7 } from '@managemind/shared';
import {
  CART_LIMITS,
  FIRST_ORDER_NUMBER,
  formatOrderNumber,
  type OrderSource,
  type PlaceInput,
  paymentStatusOf,
} from '@managemind/shared/orders';
import { holidayActive } from '@managemind/shared/storefront';
import { eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { cartByToken, cartLines } from '../cart/service';
import type { Locale } from '../catalog/common';
import { addressSnapshot, findOrCreateCustomer } from '../customers/service';
import { findDuplicate, otpRequired, phoneRisk } from '../fraud/index';
import { type IdempotentResponse, runIdempotent } from '../idempotency';
import { applyMovements } from '../inventory/service';
import { emit } from '../outbox';
import { reissueCreditRemainder } from '../payments/store-credit';
import type { ManualDiscount } from '../pricing/engine';
import { type OrderSettings, orderSettings, type Quote, quote } from '../pricing/quote';
import type { TenantTx } from '../tenant';
import { recordHistory } from './history';

export const MANUAL_PAYMENT_METHODS = [
  'bkash',
  'nagad',
  'rocket',
  'bank',
  'cash',
  'other',
] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export type OrderPayment =
  | { kind: 'cod' }
  /** Already received (Facebook orders paid in advance, walk-ins): the rest, if any, is COD. */
  | { kind: 'manual'; method: ManualPaymentMethod; amount: number; reference?: string | null }
  /** Everything through the store's gateway (phase-5a-plan §3.3). */
  | { kind: 'online' }
  /** The delivery charge through the gateway, the rest cash on delivery (§3.4). */
  | { kind: 'cod_with_advance' };

/** SSLCommerz takes at least ৳10 (phase-5a-plan §3.3). */
export const MIN_ONLINE_AMOUNT = 1000;

export interface PlaceOrderInput {
  channel: 'storefront' | 'admin';
  source: OrderSource;
  /** Storefront: the cart's token. */
  cartToken?: string | null;
  /** Admin: the lines entered by staff. */
  lines?: readonly { variantId: string; quantity: number }[];
  contact: { name: string; phone: string; email?: string | null | undefined };
  /** Null for a walk-in with no delivery. */
  address: PlaceInput | null;
  /** Admin: another zone than the area's, or 'none' for no delivery. */
  zone?: { id: string } | 'none' | undefined;
  deliveryFeeOverride?: { amount: number; reason: string } | undefined;
  /** Admin: a code staff typed; the storefront uses the cart's. */
  code?: string | null | undefined;
  manualDiscount?: ManualDiscount | null | undefined;
  payment: OrderPayment;
  note?: string | null | undefined;
  tags?: readonly string[] | undefined;
  /** Storefront: the total the shopper saw (§3.1). */
  expectedTotal?: number | undefined;
  locale: Locale;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  shopperUserId?: string | null | undefined;
  /** Admin: "Save and confirm". */
  confirm?: boolean | undefined;
  /** Admin: staff saw the blocklist warning and went ahead. */
  allowBlocked?: boolean | undefined;
  /** The store's gateway is set up and checked, so online payment can be offered (§3.4). */
  onlineReady?: boolean | undefined;
  /** The store has a working SMS gateway, so a phone code can be asked for (§3.14). */
  smsReady?: boolean | undefined;
  /** The shopper verified this phone with a code for this order. */
  otpVerified?: boolean | undefined;
  acceptTerms?: boolean | undefined;
}

export interface PlacedOrder {
  id: string;
  number: number;
  /** "#1001": the store's prefix and the number. */
  displayNumber: string;
  status: 'pending' | 'confirmed';
  total: number;
  /** What the courier collects at the door. */
  codAmount: number;
  /** The pending online payment to start a gateway session for, if any (§3.3). */
  onlinePayment: { id: string; amount: number } | null;
  phone: string;
  locale: Locale;
  placedAt: string;
}

const lineProblems = (q: Quote) =>
  q.lines
    .filter((l) => l.problem)
    .map((l) => ({ variantId: l.variantId, problem: l.problem, maxQuantity: l.maxQuantity }));

/** The lines short of stock, read under the level locks the reservation took. */
async function shortLines(tx: TenantTx, wanted: Map<string, number>) {
  const { rows } = await tx.db.execute<{ variant_id: string; available: number }>(sql`
    select variant_id, coalesce(sum(on_hand - reserved), 0)::int as available
      from store.inventory_levels where variant_id = any(${sql.param([...wanted.keys()])}::uuid[])
     group by variant_id`);
  const available = new Map(rows.map((r) => [r.variant_id, r.available]));
  return [...wanted]
    .filter(([id, q]) => (available.get(id) ?? 0) < q)
    .map(([variantId]) => ({ variantId, available: Math.max(0, available.get(variantId) ?? 0) }));
}

/** Counts each applied promotion's use; a limit already reached refuses the order. */
async function countPromotionUses(tx: TenantTx, q: Quote, phone: string): Promise<void> {
  for (const p of q.promotions) {
    const { rows } = await tx.db.execute<{ perCustomer: number | null }>(sql`
      update store.promotions set usage_count = usage_count + 1
       where id = ${p.promotionId} and (usage_limit is null or usage_count < usage_limit)
      returning per_customer_limit as "perCustomer"`);
    const unavailable = () =>
      new AppError('promotion_unavailable', {
        detail: 'An offer in your cart has run out',
        extensions: { promotionId: p.promotionId, ...(p.code ? { code: p.code } : {}) },
      });
    if (!rows[0]) throw unavailable();
    const limit = rows[0].perCustomer;
    if (limit !== null) {
      const { rows: used } = await tx.db.execute(sql`
        insert into store.promotion_customer_usage (promotion_id, phone, count)
        values (${p.promotionId}, ${phone}, 1)
        on conflict (tenant_id, promotion_id, phone) do update
          set count = store.promotion_customer_usage.count + 1
          where store.promotion_customer_usage.count < ${limit}
        returning count`);
      if (!used[0]) throw unavailable();
    }
    if (p.codeId) {
      const { rows: code } = await tx.db.execute(sql`
        update store.promotion_codes set usage_count = usage_count + 1
         where id = ${p.codeId} and (usage_limit is null or usage_count < usage_limit)
        returning id`);
      if (!code[0]) throw unavailable();
    }
  }
}

/** The next order number: one row per store, locked only until commit. */
async function nextOrderNumber(tx: TenantTx): Promise<number> {
  const { rows } = await tx.db.execute<{ value: string }>(sql`
    insert into store.counters (name, value) values ('order_number', ${FIRST_ORDER_NUMBER})
    on conflict (tenant_id, name) do update set value = store.counters.value + 1
    returning value`);
  return Number(rows[0]?.value);
}

export async function placeOrder(
  tx: TenantTx,
  actor: Actor,
  input: PlaceOrderInput,
  preloaded?: OrderSettings,
): Promise<PlacedOrder> {
  const storefront = input.channel === 'storefront';
  if (!storefront) authorize(actor, 'orders.write');
  const settings = preloaded ?? (await orderSettings(tx));
  const phone = input.contact.phone;

  // 1. The cart (storefront) or the entered lines (admin), and the store's rules.
  let cartId: string | null = null;
  let lines: { variantId: string; quantity: number }[];
  let code = input.code ?? null;
  if (storefront) {
    if (holidayActive(settings.holiday)) {
      throw new AppError('checkout_paused', {
        extensions: { message: settings.holiday?.message ?? {} },
      });
    }
    const cart = await cartByToken(tx, input.cartToken, {
      forUpdate: true,
      includeConverted: true,
    });
    if (!cart) throw new AppError('not_found', { detail: 'No cart' });
    if (cart.status === 'converted')
      throw new AppError('conflict', { detail: 'This cart is already an order' });
    cartId = cart.id;
    code = cart.code;
    lines = await cartLines(tx, cart.id);
    if (settings.checkout.email === 'required' && !input.contact.email) {
      throw new AppError('validation_failed', {
        fields: [{ path: 'contact.email', code: 'required', message: 'required' }],
      });
    }
    if (settings.checkout.termsCheckbox && !input.acceptTerms) {
      throw new AppError('validation_failed', {
        fields: [{ path: 'acceptTerms', code: 'required', message: 'accept the terms' }],
      });
    }
    if (!input.address)
      throw new AppError('validation_failed', {
        fields: [{ path: 'address', code: 'required', message: 'required' }],
      });
  } else {
    lines = [...(input.lines ?? [])];
    if (lines.length > CART_LIMITS.lines) throw new AppError('limit_exceeded');
    if (new Set(lines.map((l) => l.variantId)).size !== lines.length) {
      throw new AppError('validation_failed', {
        fields: [{ path: 'lines', code: 'duplicate', message: 'one line per variant' }],
      });
    }
  }
  if (!lines.length) throw new AppError('cart_invalid', { detail: 'Nothing to order' });

  // A blocked phone gets the same refusal as a rate limit, so it learns nothing (§3.15).
  const { rows: blocked } = await tx.db.execute(
    sql`select 1 from store.blocked_phones where phone = ${phone}`,
  );
  if (blocked.length && storefront) throw new AppError('rate_limited');
  if (blocked.length && !input.allowBlocked) {
    throw new AppError('conflict', {
      detail: 'This phone is on the blocklist',
      extensions: { reason: 'blocked_phone' },
    });
  }

  // The phone's risk, read once (phase-6-plan §3.3): the advance, the code
  // and the order's flag read it, and the order keeps the score it saw.
  const risk = await phoneRisk(tx, phone, settings.settings);

  // 2. Price it, exactly as the cart did (§3.1).
  const q = await quote(tx, {
    lines,
    areaId: input.address?.areaId ?? null,
    zone: input.zone,
    deliveryFeeOverride: input.deliveryFeeOverride?.amount,
    code,
    phone,
    paymentMethod:
      input.payment.kind === 'online'
        ? 'online'
        : input.payment.kind === 'manual'
          ? 'manual'
          : 'cod',
    manualDiscount: storefront ? null : input.manualDiscount,
    maxQuantityPerLine: storefront ? settings.checkout.maxQuantityPerLine : null,
    settings,
  });
  const problems = lineProblems(q).filter((p) => storefront || p.problem === 'unavailable');
  if (problems.length) throw new AppError('cart_invalid', { extensions: { lines: problems } });
  if (storefront && !q.zone) {
    throw new AppError('validation_failed', {
      fields: [
        {
          path: 'address.areaId',
          code: 'no_delivery',
          message: 'the store does not deliver there',
        },
      ],
    });
  }
  const total = q.totals.total;
  const kind = input.payment.kind;
  if ((kind === 'online' || kind === 'cod_with_advance') && !input.onlineReady) {
    throw new AppError('validation_failed', {
      fields: [
        { path: 'payment', code: 'unavailable', message: 'online payment is not available' },
      ],
    });
  }
  // The delivery charge after delivery discounts: the advance (§3.4).
  const deliveryCharge = Math.max(0, q.totals.deliveryFee - q.totals.deliveryDiscount);
  if (
    storefront &&
    kind === 'cod' &&
    input.onlineReady &&
    deliveryCharge >= MIN_ONLINE_AMOUNT &&
    (settings.cod.advance === 'always' || (settings.cod.advance === 'flagged' && risk.risky))
  ) {
    throw new AppError('cod_unavailable', {
      extensions: { reason: 'advance_required', advance: deliveryCharge },
    });
  }
  // A code by SMS before plain cash on delivery (§3.14), where the store has SMS.
  if (
    storefront &&
    kind === 'cod' &&
    input.smsReady &&
    !input.otpVerified &&
    (await otpRequired(tx, phone, settings.settings, risk))
  ) {
    throw new AppError('otp_required');
  }
  const advance = kind === 'manual' ? Math.min(input.payment.amount, total) : 0;
  // A charge below the gateway's minimum is no advance: plain COD (§3.4).
  const onlineAmount =
    kind === 'online'
      ? total
      : kind === 'cod_with_advance' && deliveryCharge >= MIN_ONLINE_AMOUNT
        ? deliveryCharge
        : 0;
  if (kind === 'online' && total < MIN_ONLINE_AMOUNT) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'payment', code: 'too_small', message: 'online payment starts at ৳10' }],
    });
  }
  const codAmount = total - advance - onlineAmount;
  if (storefront && codAmount > 0 && !settings.cod.enabled) throw new AppError('cod_unavailable');
  if (codAmount > 0 && settings.cod.maxOrderValue !== null && total > settings.cod.maxOrderValue) {
    if (storefront)
      throw new AppError('cod_unavailable', {
        extensions: { maxOrderValue: settings.cod.maxOrderValue },
      });
  }
  if (storefront && input.expectedTotal !== total) {
    throw new AppError('price_changed', {
      detail: 'Prices changed since you saw your total',
      extensions: { totals: q.totals, expectedTotal: input.expectedTotal ?? null },
    });
  }

  // 3. Reserve the stock: the last unit goes to the first transaction to lock it.
  const orderId = uuidv7();
  const lineIds = new Map(q.priced.map((p) => [p.line.key, uuidv7()]));
  try {
    await applyMovements(
      tx,
      actor,
      q.priced.map((p) => ({
        variantId: p.variant.id,
        type: 'reservation' as const,
        quantity: p.line.quantity,
        reason: 'order',
        referenceType: 'order',
        referenceId: orderId,
        idempotencyKey: `order:${orderId}:${lineIds.get(p.line.key)}:reserve`,
      })),
    );
  } catch (e) {
    if (e instanceof AppError && e.code === 'insufficient_stock') {
      const wanted = new Map(q.priced.map((p) => [p.variant.id, p.line.quantity]));
      throw new AppError('insufficient_stock', {
        extensions: { lines: await shortLines(tx, wanted) },
      });
    }
    throw e;
  }

  // 4. Promotion uses, the customer, then the number.
  await countPromotionUses(tx, q, phone);
  const customer = await findOrCreateCustomer(tx, input.contact);
  const number = await nextOrderNumber(tx);
  const status = input.confirm && !storefront ? 'confirmed' : 'pending';

  // A possible duplicate of a recent order from this phone (phase-6-plan §3.4): flagged, never refused.
  const duplicate = await findDuplicate(
    tx,
    phone,
    q.priced.map((p) => p.variant.id),
    settings.settings,
  );

  // 5. The order, its lines, adjustments, payments and history.
  const address = input.address ? addressSnapshot(input.address) : null;
  const zone = q.zone
    ? await tx.db
        .select({ name: schema.deliveryZones.name })
        .from(schema.deliveryZones)
        .where(eq(schema.deliveryZones.id, q.zone.id))
    : [];
  const paidTotal = advance;
  const [order] = await tx.db
    .insert(schema.orders)
    .values({
      id: orderId,
      number,
      status,
      paymentStatus: paymentStatusOf(paidTotal, total),
      source: input.source,
      customerId: customer.id,
      shopperUserId: input.shopperUserId ?? null,
      phone,
      contact: {
        name: input.contact.name,
        phone,
        ...(input.contact.email ? { email: input.contact.email } : {}),
      },
      address,
      zoneId: q.zone?.id ?? null,
      zoneName: zone[0]?.name ?? null,
      subtotal: q.totals.subtotal,
      discountTotal: q.totals.discountTotal,
      deliveryFee: q.totals.deliveryFee,
      deliveryDiscount: q.totals.deliveryDiscount,
      vatTotal: q.totals.vatTotal,
      vatIncluded: q.totals.vatIncluded,
      rounding: q.totals.rounding,
      total,
      paidTotal,
      locale: input.locale,
      customerNote: input.note ?? null,
      tags: [...(input.tags ?? [])],
      metadata: input.deliveryFeeOverride
        ? { deliveryFeeReason: input.deliveryFeeOverride.reason }
        : {},
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      createdBy: storefront ? null : actor.userId,
      phoneScore: risk.score,
      // A risky phone shows on the order, for staff (phase-5a-plan §3.11).
      flags: [
        ...(risk.risky ? ['flagged_phone'] : []),
        ...(duplicate ? ['possible_duplicate'] : []),
      ],
      duplicateOf: duplicate?.id ?? null,
      ...(status === 'confirmed' ? { confirmedAt: sql`now()` } : {}),
    })
    .returning({ placedAt: schema.orders.placedAt });
  if (!order) throw new AppError('internal');

  const totalsByKey = new Map(q.totals.lines.map((t) => [t.key, t]));
  await tx.db.insert(schema.orderLines).values(
    q.priced.map((p, position) => {
      const t = totalsByKey.get(p.line.key);
      const v = p.variant;
      return {
        id: lineIds.get(p.line.key) as string,
        orderId,
        variantId: v.id,
        productId: v.productId,
        title: v.title,
        optionLabels: v.optionLabels,
        sku: v.sku,
        image: v.image,
        unitPrice: v.price,
        compareAtPrice: v.compareAtPrice,
        costPrice: v.costPrice,
        weightGrams: v.weightGrams,
        vatCategory: v.vatCategory,
        vatRateBp: t?.vatRateBp ?? 0,
        quantity: p.line.quantity,
        lineSubtotal: t?.subtotal ?? 0,
        discountTotal: t?.discount ?? 0,
        vatAmount: t?.vat ?? 0,
        lineTotal: t?.total ?? 0,
        position,
      };
    }),
  );
  await writeAdjustments(tx, orderId, q, lineIds);

  if (advance > 0 && input.payment.kind === 'manual') {
    await tx.db.insert(schema.payments).values({
      orderId,
      provider: 'manual',
      method: input.payment.method,
      status: 'paid',
      amount: advance,
      reference: input.payment.reference ?? null,
      recordedBy: actor.userId,
      settledAt: sql`now()`,
    });
    await emit(tx, 'payment.recorded', {
      aggregateType: 'order',
      aggregateId: orderId,
      payload: { orderId, provider: 'manual', amount: advance },
    });
  }
  let onlinePayment: PlacedOrder['onlinePayment'] = null;
  if (onlineAmount > 0) {
    // Its ID is the gateway's tran_id (§3.2).
    const [row] = await tx.db
      .insert(schema.payments)
      .values({ orderId, provider: 'sslcommerz', method: 'online', amount: onlineAmount })
      .returning({ id: schema.payments.id });
    onlinePayment = { id: row?.id as string, amount: onlineAmount };
  }
  if (codAmount > 0) {
    await tx.db
      .insert(schema.payments)
      .values({ orderId, provider: 'cod', method: 'cod', amount: codAmount });
  }

  await recordHistory(tx, actor, {
    orderId,
    machine: 'order',
    from: null,
    to: 'pending',
    event: 'place',
    data: { source: input.source, total },
  });
  if (status === 'confirmed') {
    await recordHistory(tx, actor, {
      orderId,
      machine: 'order',
      from: 'pending',
      to: 'confirmed',
      event: 'confirm',
    });
  }
  await tx.db.execute(sql`
    update store.customers set order_count = order_count + 1,
           first_order_at = coalesce(first_order_at, now()), last_order_at = now()
     where id = ${customer.id}`);
  if (cartId) {
    await tx.db
      .update(schema.carts)
      .set({ status: 'converted', orderId })
      .where(eq(schema.carts.id, cartId));
  }
  await emit(tx, 'order.placed', {
    aggregateType: 'order',
    aggregateId: orderId,
    payload: { number, source: input.source, total },
  });
  if (status === 'confirmed') {
    await emit(tx, 'order.confirmed', {
      aggregateType: 'order',
      aggregateId: orderId,
      payload: { number },
    });
  }
  // A store credit code the order didn't use up comes back as a new one (phase-5a-plan §3.13).
  for (const p of q.promotions) {
    if (p.codeId) await reissueCreditRemainder(tx, orderId, p.promotionId, p.amount);
  }
  if (!storefront) {
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'order.created',
      entityType: 'order',
      entityId: orderId,
      after: { number, source: input.source, total, lines: lines.length },
    });
  }
  return {
    id: orderId,
    number,
    displayNumber: formatOrderNumber(settings.checkout.orderNumberPrefix, number),
    status,
    total,
    codAmount,
    onlinePayment,
    phone,
    locale: input.locale,
    placedAt: new Date(order.placedAt).toISOString(),
  };
}

/** The order's adjustments and each line's share of them (§3.1). */
export async function writeAdjustments(
  tx: TenantTx,
  orderId: string,
  q: Quote,
  lineIds: Map<string, string>,
): Promise<void> {
  const rows: { id: string; allocations: Record<string, number> }[] = [];
  for (const p of q.promotions) {
    const id = uuidv7();
    rows.push({ id, allocations: p.allocations });
    await tx.db.insert(schema.orderAdjustments).values({
      id,
      orderId,
      kind: 'promotion',
      target: p.target,
      promotionId: p.promotionId,
      code: p.code ?? null,
      codeId: p.codeId ?? null,
      title: p.title,
      amount: p.amount,
    });
  }
  if (q.manualDiscount && q.manualDiscount.amount > 0) {
    const id = uuidv7();
    rows.push({ id, allocations: q.allocations.manual ?? {} });
    await tx.db.insert(schema.orderAdjustments).values({
      id,
      orderId,
      kind: 'manual',
      target: 'order',
      title: { bn: 'ছাড়', en: 'Discount' },
      amount: q.manualDiscount.amount,
      reason: q.manualDiscount.reason,
    });
  }
  const shares = rows.flatMap((r) =>
    Object.entries(r.allocations)
      .filter(([, amount]) => amount > 0)
      .map(([key, amount]) => ({
        orderLineId: lineIds.get(key) as string,
        adjustmentId: r.id,
        amount,
      })),
  );
  if (shares.length) await tx.db.insert(schema.orderLineAdjustments).values(shares);
}

/**
 * The storefront's checkout (POST /checkout/orders): placeOrder under the
 * client's Idempotency-Key (§3.5). A retry of a finished order returns the
 * same response; a different body under the same key is refused.
 */
export async function checkout(
  tx: TenantTx,
  actor: Actor,
  key: string,
  request: unknown,
  input: PlaceOrderInput,
): Promise<IdempotentResponse & { replayed: boolean }> {
  return runIdempotent(tx, { scope: 'place_order', key, request }, async () => ({
    status: 201,
    body: await placeOrder(tx, actor, input),
  }));
}
