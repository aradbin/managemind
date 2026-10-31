// Chat shortcuts (phase-9-plan §3.1.2, §3.1.3): what a pasted chat tells the
// manual order screen, and the text staff send back into the chat. Nothing
// here calls Meta; the admin opens wa.me or copies the text.

import { AppError } from '@managemind/shared';
import { type ChatMessageKind, chatOrderText, parseChatText } from '@managemind/shared/channels';
import { formatOrderNumber } from '@managemind/shared/orders';
import { whatsappLink } from '@managemind/shared/storefront';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, authorize } from '../access';
import { parseInput } from '../catalog/common';
import { type PhoneRisk, phoneRisks } from '../fraud/index';
import { formatTaka } from '../notifications/plan';
import { canOrder, type Localized, loadVariants } from '../orders/variants';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';

export const parseChatInput = z.object({ text: z.string().max(5000) }).strict();

export interface ChatLine {
  /** Null when the link named a product with several variants: staff pick one. */
  variantId: string | null;
  productId: string;
  quantity: number;
  title: Localized;
  optionLabels: Localized[];
  /** Null when stock isn't counted. */
  available: number | null;
  orderable: boolean;
}

export interface ParsedChatResult {
  /** The first Bangladeshi mobile in the chat, with its customer and risk. */
  phone: string | null;
  phones: string[];
  customer: { id: string; name: string } | null;
  risk: PhoneRisk | null;
  lines: ChatLine[];
  /** Product links that matched nothing in this store. */
  unknownProducts: string[];
  /** Orders the chat mentions by number. */
  orders: { id: string; displayNumber: string; status: string }[];
}

/** The pasted chat, matched against this store (§3.1.2). */
export async function parseChat(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<ParsedChatResult> {
  authorize(actor, 'orders.write');
  const { text } = parseInput(parseChatInput, input);
  const parsed = parseChatText(text);
  const { settings } = await orderSettings(tx);

  const slugs = [...new Set(parsed.products.map((p) => p.slug))];
  const { rows: products } = slugs.length
    ? await tx.db.execute<{ slug: string; product_id: string; variant_ids: string[] }>(sql`
        select distinct on (t.slug) t.slug, t.product_id,
               array(select v.id from store.variants v
                      where v.product_id = t.product_id and v.archived_at is null
                      order by v.position, v.id) as variant_ids
          from store.product_translations t
         where t.slug = any(${sql.param(slugs)}::text[])
         order by t.slug, t.product_id`)
    : { rows: [] };
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const wanted = parsed.products.flatMap((p) => {
    const product = bySlug.get(p.slug);
    const ids = product?.variant_ids ?? [];
    if (!product || !ids.length) return [];
    const variantId =
      p.variantId && ids.includes(p.variantId) ? p.variantId : ids.length === 1 ? ids[0] : null;
    // A product with several variants and no choice in the link: its first
    // variant gives the title, and staff pick the variant.
    return [
      {
        productId: product.product_id,
        variantId: variantId ?? null,
        titleFrom: variantId ?? (ids[0] as string),
        quantity: p.quantity,
      },
    ];
  });
  const variants = await loadVariants(tx, [...new Set(wanted.map((w) => w.titleFrom))]);
  const lines: ChatLine[] = wanted.flatMap((w) => {
    const v = variants.get(w.titleFrom);
    if (!v) return [];
    const counted = v.trackInventory && !v.allowBackorder;
    return [
      {
        variantId: w.variantId,
        productId: w.productId,
        quantity: w.quantity,
        title: v.title,
        optionLabels: w.variantId ? v.optionLabels : [],
        available: counted ? v.available : null,
        orderable: Boolean(w.variantId) && v.live && canOrder(v, w.quantity),
      },
    ];
  });

  const phone = parsed.phones[0] ?? null;
  let customer: ParsedChatResult['customer'] = null;
  let risk: PhoneRisk | null = null;
  if (phone) {
    const { rows } = await tx.db.execute<{ id: string; name: string }>(
      sql`select id, name from store.customers where phone = ${phone} and deleted_at is null limit 1`,
    );
    customer = rows[0] ?? null;
    risk = (await phoneRisks(tx, [phone], settings)).get(phone) ?? null;
  }
  const { rows: orders } = parsed.orderNumbers.length
    ? await tx.db.execute<{ id: string; number: string; status: string }>(sql`
        select id, number, status from store.orders
         where number = any(${sql.param(parsed.orderNumbers)}::bigint[]) order by number`)
    : { rows: [] };

  return {
    phone,
    phones: parsed.phones,
    customer,
    risk,
    lines,
    unknownProducts: slugs.filter((s) => !bySlug.has(s)),
    orders: orders.map((o) => ({
      id: o.id,
      displayNumber: formatOrderNumber(settings.checkout.orderNumberPrefix, Number(o.number)),
      status: o.status,
    })),
  };
}

export const chatMessageInput = z
  .object({ kind: z.enum(['summary', 'payment', 'tracking']) })
  .strict();

export interface ChatMessage {
  text: string;
  /** The shopper's phone, E.164. */
  phone: string;
  whatsappUrl: string;
  locale: 'bn' | 'en';
}

/**
 * The order's summary, payment link or tracking link as one chat message in
 * the order's language (§3.1.3). `payUrl` comes from the payment link the API
 * made first, for `payment`.
 */
export async function orderChatMessage(
  tx: TenantTx,
  actor: Actor,
  orderId: string,
  kind: ChatMessageKind,
  urls: { trackUrl: string; payUrl?: string },
): Promise<ChatMessage> {
  authorize(actor, 'orders.read');
  const { rows } = await tx.db.execute<{
    number: string;
    phone: string;
    contact: { name?: string };
    locale: 'bn' | 'en';
    total: string;
    paid_total: string;
    refunded_total: string;
    discount_total: string;
    delivery_fee: string;
    delivery_discount: string;
    store_name: string;
  }>(sql`
    select o.number, o.phone, o.contact, o.locale, o.total, o.paid_total, o.refunded_total,
           o.discount_total, o.delivery_fee, o.delivery_discount, t.name as store_name
      from store.orders o join platform.tenants t on t.id = o.tenant_id
     where o.id = ${orderId}`);
  const o = rows[0];
  if (!o) throw new AppError('not_found');
  const { rows: lines } = await tx.db.execute<{
    title: Localized;
    option_labels: Localized[];
    quantity: number;
    line_total: string;
  }>(sql`
    select title, option_labels, quantity, line_total from store.order_lines
     where order_id = ${orderId} order by position, id`);
  const { settings } = await orderSettings(tx);
  const locale = o.locale;
  const pick = (t: Localized) => t[locale] ?? t.en ?? t.bn ?? '';
  const text = chatOrderText(
    kind,
    {
      storeName: o.store_name,
      orderNumber: formatOrderNumber(settings.checkout.orderNumberPrefix, Number(o.number)),
      customerName: o.contact.name ?? '',
      lines: lines.map((l) => ({
        title: pick(l.title),
        options: l.option_labels.map(pick).filter(Boolean),
        quantity: l.quantity,
        total: Number(l.line_total),
      })),
      discount: Number(o.discount_total),
      deliveryFee: Math.max(0, Number(o.delivery_fee) - Number(o.delivery_discount)),
      total: Number(o.total),
      due: Math.max(0, Number(o.total) - Number(o.paid_total) + Number(o.refunded_total)),
      trackUrl: urls.trackUrl,
      ...(urls.payUrl ? { payUrl: urls.payUrl } : {}),
    },
    locale,
    (poisha) => formatTaka(poisha, locale),
  );
  return { text, phone: o.phone, whatsappUrl: whatsappLink(o.phone, text), locale };
}
