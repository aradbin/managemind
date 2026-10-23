// SSLCommerz v4 (phase-5a-plan §3.3, §3.5): sessions, order validation,
// the transaction query, refunds and refund status. Each store uses its own
// merchant account, in sandbox or live mode. Amounts travel as taka with two
// decimals and are parsed back to poisha exactly, never through a float.
import { parseAmount } from '@managemind/shared/money';

export interface SslcommerzCredentials {
  storeId: string;
  storePassword: string;
  mode: 'sandbox' | 'live';
}

const HOSTS = {
  sandbox: 'https://sandbox.sslcommerz.com',
  live: 'https://securepay.sslcommerz.com',
} as const;

/** 125050 → "1250.50": the gateway's decimal, built as a string. */
export function toTaka(poisha: number): string {
  if (!Number.isSafeInteger(poisha) || poisha < 0) throw new RangeError('not an amount');
  const text = poisha.toString().padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/** "1250.50" → 125050, or null for anything that isn't a plain amount. */
export const fromTaka = (value: unknown): number | null =>
  typeof value === 'string' || typeof value === 'number' ? parseAmount(String(value)) : null;

export class SslcommerzError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SslcommerzError';
  }
}

async function call(
  f: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch (e) {
    throw new SslcommerzError(`SSLCommerz unreachable: ${String(e)}`, true);
  }
  if (!res.ok) throw new SslcommerzError(`SSLCommerz answered ${res.status}`, res.status >= 500);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new SslcommerzError('SSLCommerz answered without JSON', true);
  }
}

const auth = (c: SslcommerzCredentials) => ({ store_id: c.storeId, store_passwd: c.storePassword });

export interface SessionRequest {
  /** Our payment's ID. */
  tranId: string;
  amount: number;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
  /** value_a: the tenant, checked again at validation. */
  tenantId: string;
  productName: string;
  customer: { name: string; phone: string; email: string | null; address: string; city: string };
}

/** Starts a session; returns the gateway page to send the shopper to. */
export async function createSession(
  c: SslcommerzCredentials,
  r: SessionRequest,
  f: typeof fetch = fetch,
): Promise<{ url: string; sessionKey: string }> {
  const form = new URLSearchParams({
    ...auth(c),
    total_amount: toTaka(r.amount),
    currency: 'BDT',
    tran_id: r.tranId,
    success_url: r.successUrl,
    fail_url: r.failUrl,
    cancel_url: r.cancelUrl,
    ipn_url: r.ipnUrl,
    value_a: r.tenantId,
    product_name: r.productName.slice(0, 250),
    product_category: 'general',
    product_profile: 'physical-goods',
    shipping_method: 'Courier',
    num_of_item: '1',
    cus_name: r.customer.name.slice(0, 50),
    // SSLCommerz requires an email; shoppers often have none.
    cus_email: r.customer.email ?? 'noreply@sslcommerz.com',
    cus_add1: r.customer.address.slice(0, 50) || r.customer.city,
    cus_city: r.customer.city.slice(0, 50),
    cus_postcode: '1000',
    cus_country: 'Bangladesh',
    cus_phone: r.customer.phone,
    ship_name: r.customer.name.slice(0, 50),
    ship_add1: r.customer.address.slice(0, 50) || r.customer.city,
    ship_city: r.customer.city.slice(0, 50),
    ship_postcode: '1000',
    ship_country: 'Bangladesh',
  });
  const body = await call(f, `${HOSTS[c.mode]}/gwprocess/v4/api.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (body.status !== 'SUCCESS' || typeof body.GatewayPageURL !== 'string') {
    throw new SslcommerzError(String(body.failedreason ?? 'session refused'), false);
  }
  return { url: body.GatewayPageURL, sessionKey: String(body.sessionkey ?? '') };
}

export interface Validation {
  status: string;
  tranId: string;
  valId: string;
  amount: number | null;
  currency: string;
  valueA: string | null;
  bankTranId: string | null;
  riskLevel: number | null;
  cardType: string | null;
  cardIssuer: string | null;
}

function toValidation(body: Record<string, unknown>, valId: string): Validation {
  const text = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : null);
  // The amount actually charged in BDT: currency_amount is the shopper's, amount the store's.
  return {
    status: String(body.status ?? ''),
    tranId: text('tran_id') ?? '',
    valId: text('val_id') ?? valId,
    amount: fromTaka(body.currency_amount ?? body.amount),
    currency: String(body.currency_type ?? body.currency ?? ''),
    valueA: text('value_a'),
    bankTranId: text('bank_tran_id'),
    riskLevel: body.risk_level === undefined ? null : Number(body.risk_level),
    cardType: text('card_type'),
    cardIssuer: text('card_issuer'),
  };
}

/** Order validation by val_id: the only answer a payment settles on (§3.5). */
export async function validate(
  c: SslcommerzCredentials,
  valId: string,
  f: typeof fetch = fetch,
): Promise<Validation> {
  const q = new URLSearchParams({ val_id: valId, ...auth(c), format: 'json' });
  const body = await call(f, `${HOSTS[c.mode]}/validator/api/validationserverAPI.php?${q}`);
  return toValidation(body, valId);
}

/** The transaction query by tran_id, for the delayed check (§3.3): the settled element, if any. */
export async function queryTransaction(
  c: SslcommerzCredentials,
  tranId: string,
  f: typeof fetch = fetch,
): Promise<Validation | null> {
  const q = new URLSearchParams({ tran_id: tranId, ...auth(c), format: 'json' });
  const body = await call(
    f,
    `${HOSTS[c.mode]}/validator/api/merchantTransIDvalidationAPI.php?${q}`,
  );
  const elements = Array.isArray(body.element) ? (body.element as Record<string, unknown>[]) : [];
  const paid = elements.find((e) => e.status === 'VALID' || e.status === 'VALIDATED');
  return paid ? toValidation(paid, String(paid.val_id ?? '')) : null;
}

export type RefundAnswer =
  | { status: 'success' | 'processing'; refundRefId: string }
  | { status: 'failed'; error: string; invalidSource: boolean };

/**
 * Starts a refund (§3.5). From an IP SSLCommerz hasn't registered, live mode
 * refuses with INVALID_SOURCE: the caller falls back to the merchant panel.
 */
export async function refund(
  c: SslcommerzCredentials,
  r: { bankTranId: string; refundTransId: string; amount: number; remarks: string },
  f: typeof fetch = fetch,
): Promise<RefundAnswer> {
  const q = new URLSearchParams({
    bank_tran_id: r.bankTranId,
    refund_trans_id: r.refundTransId,
    refund_amount: toTaka(r.amount),
    refund_remarks: r.remarks.slice(0, 255),
    ...auth(c),
    format: 'json',
  });
  const body = await call(
    f,
    `${HOSTS[c.mode]}/validator/api/merchantTransIDvalidationAPI.php?${q}`,
  );
  const status = String(body.status ?? '').toLowerCase();
  if ((status === 'success' || status === 'processing') && body.refund_ref_id) {
    return { status, refundRefId: String(body.refund_ref_id) };
  }
  const error = String(body.errorReason ?? body.error ?? 'refund refused');
  return { status: 'failed', error, invalidSource: /INVALID_SOURCE|INVALID SOURCE/i.test(error) };
}

/** A refund's state: refunded, processing or cancelled. */
export async function refundStatus(
  c: SslcommerzCredentials,
  refundRefId: string,
  f: typeof fetch = fetch,
): Promise<'refunded' | 'processing' | 'cancelled' | 'unknown'> {
  const q = new URLSearchParams({ refund_ref_id: refundRefId, ...auth(c), format: 'json' });
  const body = await call(
    f,
    `${HOSTS[c.mode]}/validator/api/merchantTransIDvalidationAPI.php?${q}`,
  );
  const status = String(body.status ?? '').toLowerCase();
  return status === 'refunded' || status === 'processing' || status === 'cancelled'
    ? status
    : 'unknown';
}
