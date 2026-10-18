// Carts (phase-4-plan §3.4): created on the first "add to cart", found by
// an opaque token whose SHA-256 is all the database keeps, and recalculated
// from current prices, stock, promotions and the delivery zone on every read
// and change. Nothing is reserved here: stock is reserved when the order is
// placed (§3.5).
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  CART_LIMITS,
  cartAreaInput,
  cartCodeInput,
  cartLineInput,
  cartQuantityInput,
} from '@managemind/shared/orders';
import { and, eq, sql } from 'drizzle-orm';
import { type Locale, parseInput } from '../catalog/common';
import { type OrderSettings, orderSettings, type Quote, quote } from '../pricing/quote';
import type { TenantTx } from '../tenant';

export interface CartRow {
  id: string;
  status: 'active' | 'converted';
  orderId: string | null;
  shopperUserId: string | null;
  locale: Locale;
  areaId: number | null;
  code: string | null;
}

export interface CartView {
  id: string;
  /** Units in the cart: the header's count (the mm_cart_n cookie). */
  itemCount: number;
  locale: Locale;
  areaId: number | null;
  quote: Quote;
  /** Checkout refuses while any line has a problem. */
  ready: boolean;
  maxQuantityPerLine: number;
}

/** 32 random bytes, base64url: the cookie's value. */
export function newCartToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function hashCartToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const CART_COLUMNS = {
  id: schema.carts.id,
  status: schema.carts.status,
  orderId: schema.carts.orderId,
  shopperUserId: schema.carts.shopperUserId,
  locale: schema.carts.locale,
  areaId: schema.carts.areaId,
  code: schema.carts.code,
};

/** The active cart behind a token, or null (unknown, malformed, or already an order). */
export async function cartByToken(
  tx: TenantTx,
  token: string | null | undefined,
  options: { forUpdate?: boolean; includeConverted?: boolean } = {},
): Promise<CartRow | null> {
  if (!token || !TOKEN.test(token)) return null;
  const query = tx.db
    .select(CART_COLUMNS)
    .from(schema.carts)
    .where(eq(schema.carts.tokenHash, await hashCartToken(token)));
  const [row] = await (options.forUpdate ? query.for('update') : query);
  if (!row || (row.status !== 'active' && !options.includeConverted)) return null;
  return row as CartRow;
}

export async function cartLines(
  tx: TenantTx,
  cartId: string,
): Promise<{ variantId: string; quantity: number }[]> {
  const cl = schema.cartLines;
  return tx.db
    .select({ variantId: cl.variantId, quantity: cl.quantity })
    .from(cl)
    .where(eq(cl.cartId, cartId))
    .orderBy(cl.addedAt, cl.variantId);
}

/** The cart priced now. A line that became unavailable still shows, marked. */
export async function cartView(
  tx: TenantTx,
  cart: CartRow,
  options: { phone?: string | null; settings?: OrderSettings } = {},
): Promise<CartView> {
  const settings = options.settings ?? (await orderSettings(tx));
  const lines = await cartLines(tx, cart.id);
  const q = await quote(tx, {
    lines,
    areaId: cart.areaId,
    code: cart.code,
    phone: options.phone ?? null,
    paymentMethod: 'cod',
    maxQuantityPerLine: settings.checkout.maxQuantityPerLine,
    settings,
  });
  return {
    id: cart.id,
    itemCount: lines.reduce((a, l) => a + l.quantity, 0),
    locale: cart.locale,
    areaId: cart.areaId,
    quote: q,
    ready: q.lines.length > 0 && q.lines.every((l) => l.problem === null),
    maxQuantityPerLine: settings.checkout.maxQuantityPerLine,
  };
}

export async function getCart(tx: TenantTx, token: string | null): Promise<CartView | null> {
  const cart = await cartByToken(tx, token);
  return cart ? cartView(tx, cart) : null;
}

const touch = (tx: TenantTx, cartId: string) =>
  tx.db.update(schema.carts).set({ updatedAt: sql`now()` }).where(eq(schema.carts.id, cartId));

/** A quantity a shopper may set: live, in stock (unless untracked or backordered), within the limit. */
async function checkQuantity(
  tx: TenantTx,
  settings: OrderSettings,
  variantId: string,
  quantity: number,
): Promise<void> {
  const { rows } = await tx.db.execute<{ live: boolean; free: boolean; available: number }>(sql`
    select p.status = 'active' and v.archived_at is null as live,
           not v.track_inventory or v.allow_backorder as free,
           coalesce((select sum(l.on_hand - l.reserved) from store.inventory_levels l
                      where l.variant_id = v.id), 0)::int as available
      from store.variants v join store.products p on p.id = v.product_id where v.id = ${variantId}`);
  const v = rows[0];
  if (!v?.live) throw new AppError('not_found', { detail: 'This item is no longer available' });
  const max = settings.checkout.maxQuantityPerLine;
  if (quantity > max) {
    throw new AppError('limit_exceeded', {
      detail: `At most ${max} of one item`,
      extensions: { maxQuantity: max },
    });
  }
  if (!v.free && quantity > v.available) {
    throw new AppError('insufficient_stock', {
      extensions: { lines: [{ variantId, available: Math.max(0, v.available) }] },
    });
  }
}

export interface CartChange {
  /** Set when this change created the cart: the cookie to store. */
  token: string | null;
  cart: CartView;
}

/** Adds units of a variant, creating the cart on the first add. */
export async function addToCart(
  tx: TenantTx,
  token: string | null,
  input: unknown,
  locale: Locale,
): Promise<CartChange> {
  const { variantId, quantity } = parseInput(cartLineInput, input);
  const settings = await orderSettings(tx);
  let cart = await cartByToken(tx, token, { forUpdate: true });
  let created: string | null = null;
  if (!cart) {
    created = newCartToken();
    const [row] = await tx.db
      .insert(schema.carts)
      .values({ tokenHash: await hashCartToken(created), locale })
      .returning(CART_COLUMNS);
    cart = row as CartRow;
  }
  const lines = await cartLines(tx, cart.id);
  const existing = lines.find((l) => l.variantId === variantId);
  if (!existing && lines.length >= CART_LIMITS.lines) {
    throw new AppError('limit_exceeded', {
      detail: `At most ${CART_LIMITS.lines} items in a cart`,
    });
  }
  const next = (existing?.quantity ?? 0) + quantity;
  await checkQuantity(tx, settings, variantId, next);
  await tx.db
    .insert(schema.cartLines)
    .values({ cartId: cart.id, variantId, quantity: next })
    .onConflictDoUpdate({
      target: [schema.cartLines.tenantId, schema.cartLines.cartId, schema.cartLines.variantId],
      set: { quantity: next },
    });
  if (cart.locale !== locale) {
    await tx.db.update(schema.carts).set({ locale }).where(eq(schema.carts.id, cart.id));
    cart = { ...cart, locale };
  } else await touch(tx, cart.id);
  return { token: created, cart: await cartView(tx, cart, { settings }) };
}

async function requireCart(tx: TenantTx, token: string | null): Promise<CartRow> {
  const cart = await cartByToken(tx, token, { forUpdate: true });
  if (!cart) throw new AppError('not_found', { detail: 'No cart' });
  return cart;
}

/** Sets a line's quantity; 0 removes it. Lowering a quantity is always allowed. */
export async function setCartQuantity(
  tx: TenantTx,
  token: string | null,
  variantId: string,
  input: unknown,
): Promise<CartView> {
  const { quantity } = parseInput(cartQuantityInput, input);
  const cart = await requireCart(tx, token);
  const settings = await orderSettings(tx);
  const cl = schema.cartLines;
  const match = and(eq(cl.cartId, cart.id), eq(cl.variantId, variantId));
  const [line] = await tx.db.select({ quantity: cl.quantity }).from(cl).where(match);
  if (!line) throw new AppError('not_found');
  if (quantity === 0) await tx.db.delete(cl).where(match);
  else {
    if (quantity > line.quantity) await checkQuantity(tx, settings, variantId, quantity);
    await tx.db.update(cl).set({ quantity }).where(match);
  }
  await touch(tx, cart.id);
  return cartView(tx, cart, { settings });
}

export async function removeFromCart(
  tx: TenantTx,
  token: string | null,
  variantId: string,
): Promise<CartView> {
  const cart = await requireCart(tx, token);
  const cl = schema.cartLines;
  await tx.db.delete(cl).where(and(eq(cl.cartId, cart.id), eq(cl.variantId, variantId)));
  await touch(tx, cart.id);
  return cartView(tx, cart);
}

/**
 * Applies a code (one per cart). An unknown code is refused; a known one is
 * kept even when the cart doesn't qualify yet, and the cart says why.
 */
export async function setCartCode(
  tx: TenantTx,
  token: string | null,
  input: unknown,
): Promise<CartView> {
  const { code } = parseInput(cartCodeInput, input);
  const cart = await requireCart(tx, token);
  const { rows } = await tx.db.execute<{ code: string }>(
    sql`select code from store.promotion_codes where upper(code) = upper(${code})`,
  );
  const found = rows[0];
  if (!found) {
    throw new AppError('promotion_unavailable', {
      detail: 'This code does not exist',
      extensions: { reason: 'not_found' },
    });
  }
  await tx.db.update(schema.carts).set({ code: found.code }).where(eq(schema.carts.id, cart.id));
  return cartView(tx, { ...cart, code: found.code });
}

export async function clearCartCode(tx: TenantTx, token: string | null): Promise<CartView> {
  const cart = await requireCart(tx, token);
  await tx.db.update(schema.carts).set({ code: null }).where(eq(schema.carts.id, cart.id));
  return cartView(tx, { ...cart, code: null });
}

/** The delivery area, so totals follow it; null clears it. */
export async function setCartArea(
  tx: TenantTx,
  token: string | null,
  input: unknown,
): Promise<CartView> {
  const { areaId } = parseInput(cartAreaInput, input);
  const cart = await requireCart(tx, token);
  if (areaId !== null) {
    const { rows } = await tx.db.execute<{ id: number }>(
      sql`select id from ref.areas where id = ${areaId} and active`,
    );
    if (!rows[0])
      throw new AppError('validation_failed', {
        fields: [{ path: 'areaId', code: 'unknown', message: 'choose an area from the list' }],
      });
  }
  await tx.db.update(schema.carts).set({ areaId }).where(eq(schema.carts.id, cart.id));
  return cartView(tx, { ...cart, areaId });
}

/**
 * Signing in merges the guest cart into the shopper's own (§3.4): quantities
 * add up, capped at the limit. Returns the cart the shopper now has.
 */
export async function mergeCarts(
  tx: TenantTx,
  guestToken: string | null,
  shopperUserId: string,
): Promise<CartRow | null> {
  const guest = await cartByToken(tx, guestToken, { forUpdate: true });
  const c = schema.carts;
  const [own] = await tx.db
    .select(CART_COLUMNS)
    .from(c)
    .where(and(eq(c.shopperUserId, shopperUserId), eq(c.status, 'active')))
    .orderBy(sql`${c.updatedAt} desc`)
    .limit(1)
    .for('update');
  if (!guest) return (own as CartRow | undefined) ?? null;
  if (!own || own.id === guest.id) {
    await tx.db.update(c).set({ shopperUserId }).where(eq(c.id, guest.id));
    return { ...guest, shopperUserId };
  }
  const { checkout } = await orderSettings(tx);
  await tx.db.execute(sql`
    insert into store.cart_lines (cart_id, variant_id, quantity)
    select ${own.id}, variant_id, least(quantity, ${checkout.maxQuantityPerLine})
      from store.cart_lines where cart_id = ${guest.id}
    on conflict (tenant_id, cart_id, variant_id) do update
      set quantity = least(store.cart_lines.quantity + excluded.quantity, ${checkout.maxQuantityPerLine})`);
  await tx.db.delete(c).where(eq(c.id, guest.id));
  await touch(tx, own.id);
  return own as CartRow;
}

/**
 * Signing in (§3.4, §3.11): the guest cart merged into the shopper's, and
 * the token the cart cookie should now hold. A shopper's own cart from
 * another visit gets a new token: only its hash is kept, so the old one
 * can't be handed back.
 */
export async function signInCart(
  tx: TenantTx,
  guestToken: string | null,
  shopperUserId: string,
): Promise<{ token: string; itemCount: number } | null> {
  const guest = await cartByToken(tx, guestToken);
  const cart = await mergeCarts(tx, guestToken, shopperUserId);
  if (!cart) return null;
  let token = guestToken as string;
  if (!guest || guest.id !== cart.id) {
    token = newCartToken();
    await tx.db
      .update(schema.carts)
      .set({ tokenHash: await hashCartToken(token) })
      .where(eq(schema.carts.id, cart.id));
  }
  const lines = await cartLines(tx, cart.id);
  return { token, itemCount: lines.reduce((a, l) => a + l.quantity, 0) };
}
