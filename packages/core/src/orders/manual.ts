// Manual orders (phase-4-plan §3.12): Facebook, phone and walk-in orders,
// entered by staff and placed with the same placeOrder as the storefront.
// The preview prices them exactly as placing will, and says whether the
// phone is blocked, and its delivery success score (phase-6-plan §3.8), so
// the screen can warn first.
import {
  formatOrderNumber,
  type ManualOrderInput,
  manualOrderInput,
  manualQuoteInput,
} from '@managemind/shared/orders';
import { type Actor, authorize } from '../access';
import { parseInput } from '../catalog/common';
import { isBlocked } from '../customers/blocklist';
import { findDuplicate, type PhoneRisk, phoneRisk } from '../fraud/index';
import { customerFacts, orderSettings, type Quote, quote } from '../pricing/quote';
import type { TenantTx } from '../tenant';
import { completeWalkIn } from './lifecycle';
import { type PlacedOrder, placeOrder } from './place';

const zoneOf = (v: Pick<ManualOrderInput, 'zoneId' | 'address'>) =>
  v.zoneId === 'none'
    ? ('none' as const)
    : v.zoneId
      ? { id: v.zoneId }
      : v.address
        ? undefined
        : ('none' as const);

export async function previewManualOrder(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<{
  quote: Quote;
  blocked: boolean;
  firstOrder: boolean;
  risk: PhoneRisk | null;
  /** A recent order with the same items from this phone (phase-6-plan §3.4): warned before saving. */
  duplicate: { id: string; displayNumber: string; placedAt: string } | null;
}> {
  authorize(actor, 'orders.write');
  const v = parseInput(manualQuoteInput, input);
  const phone = v.contact?.phone ?? null;
  const settings = await orderSettings(tx);
  const q = await quote(tx, {
    lines: v.lines,
    areaId: v.address?.areaId ?? null,
    zone: zoneOf(v),
    deliveryFeeOverride: v.deliveryFee?.amount,
    code: v.code ?? null,
    phone,
    paymentMethod: v.payment ? 'manual' : 'cod',
    manualDiscount: v.manualDiscount ?? null,
    maxQuantityPerLine: null,
    settings,
  });
  const facts = await customerFacts(tx, phone);
  const duplicate =
    phone === null
      ? null
      : await findDuplicate(
          tx,
          phone,
          v.lines.map((l) => l.variantId),
          settings.settings,
        );
  return {
    quote: q,
    blocked: phone !== null && (await isBlocked(tx, phone)),
    firstOrder: facts.isFirstOrder,
    risk: phone === null ? null : await phoneRisk(tx, phone, settings.settings),
    duplicate: duplicate && {
      id: duplicate.id,
      displayNumber: formatOrderNumber(settings.checkout.orderNumberPrefix, duplicate.number),
      placedAt: duplicate.placedAt,
    },
  };
}

export async function createManualOrder(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<PlacedOrder> {
  authorize(actor, 'orders.write');
  const v = parseInput(manualOrderInput, input);
  const settings = await orderSettings(tx);
  const placed = await placeOrder(
    tx,
    actor,
    {
      channel: 'admin',
      // An order made from an incomplete checkout is the website's (phase-6-plan §3.2).
      source: v.incompleteOrderId ? 'website' : v.source,
      incompleteOrderId: v.incompleteOrderId ?? null,
      lines: v.lines,
      contact: v.contact,
      address: v.address,
      zone: zoneOf(v),
      deliveryFeeOverride: v.deliveryFee,
      code: v.code ?? null,
      manualDiscount: v.manualDiscount ?? null,
      payment: v.payment
        ? { kind: 'manual', ...v.payment, reference: v.payment.reference ?? null }
        : { kind: 'cod' },
      note: v.note,
      tags: v.tags,
      locale: v.locale ?? settings.defaultLocale,
      confirm: v.confirm || v.completeNow,
      allowBlocked: v.allowBlocked,
    },
    settings,
  );
  if (v.completeNow) {
    const done = await completeWalkIn(tx, actor, placed.id);
    return { ...placed, status: done.status === 'completed' ? 'confirmed' : placed.status };
  }
  return placed;
}
