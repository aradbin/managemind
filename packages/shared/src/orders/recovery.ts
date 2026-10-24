// Sales recovery (phase-6-plan §3): cancel codes, the confirmation queue's
// outcomes, incomplete orders' statuses, the delivery success score and the
// call script. The score's rules live here so the admin and the API read a
// phone the same way.
import { renderTemplate, templateVariables } from '../notifications';

/** Why an order was cancelled (§3.5); older orders have none and count as `other`. */
export const CANCEL_CODES = [
  'shopper_request',
  'no_answer',
  'wrong_number',
  'fake',
  'duplicate',
  'out_of_stock',
  'payment_expired',
  'other',
] as const;
export type CancelCode = (typeof CANCEL_CODES)[number];

/** Cancel codes that mean the shopper never took the order: they lower the score (§3.3). */
export const NOT_RECEIVED_CODES: readonly CancelCode[] = ['fake', 'wrong_number', 'no_answer'];

/** Codes staff pick when the shopper says no on a call (§3.5). */
export const CALL_CANCEL_CODES = ['shopper_request', 'fake', 'other'] as const;

export const CONFIRMATION_OUTCOMES = [
  'confirmed',
  'no_answer',
  'call_back',
  'wrong_number',
  'cancelled',
] as const;
export type ConfirmationOutcome = (typeof CONFIRMATION_OUTCOMES)[number];

/** How an order was confirmed: a call, the shopper's SMS link, staff's button, or the system. */
export const CONFIRMED_VIA = ['call', 'link', 'staff', 'auto'] as const;
export type ConfirmedVia = (typeof CONFIRMED_VIA)[number];

export const LINK_ANSWERS = ['confirm', 'cancel'] as const;
export type LinkAnswer = (typeof LINK_ANSWERS)[number];

export const INCOMPLETE_ORDER_STATUSES = [
  'open',
  'contacted',
  'converted',
  'recovered',
  'dismissed',
] as const;
export type IncompleteOrderStatus = (typeof INCOMPLETE_ORDER_STATUSES)[number];

/** Limits that are not settings (§3.2, §3.5, §3.7). */
export const RECOVERY_LIMITS = {
  /** Lines copied into an incomplete order, as a cart's. */
  incompleteLines: 50,
  /** Days at most an incomplete order is kept, whatever the store sets. */
  keepDaysMax: 30,
  /** How long opening an order's call panel claims it. */
  claimMinutes: 5,
  /** Hours a confirmation link works. */
  linkHours: 48,
  /** Times staff can send the link again. */
  linkResends: 2,
  /** The link code: base-62 characters, about 59 bits. */
  linkCodeLength: 10,
  /** A trusted phone: this score or more over at least this many deliveries. */
  trustedScore: 90,
  trustedDelivered: 3,
} as const;

export const LINK_CODE = /^[0-9A-Za-z]{10}$/;

// ---- The delivery success score (§3.3) ---------------------------------------------

/** One phone's orders in one store, counted by what became of them. */
export interface PhoneHistory {
  /** Delivered to the shopper; a later return still counts. */
  delivered: number;
  /** A shipment came back undelivered (return to origin). */
  returned: number;
  /** Cancelled with a code that means the shopper never took it. */
  fake: number;
  wrongNumber: number;
  noAnswer: number;
  /** Cancelled for any other reason: shown, not counted. */
  cancelled: number;
  /** Still open: shown, not counted. */
  open: number;
}

export const emptyPhoneHistory = (): PhoneHistory => ({
  delivered: 0,
  returned: 0,
  fake: 0,
  wrongNumber: 0,
  noAnswer: 0,
  cancelled: 0,
  open: 0,
});

export const notReceived = (h: PhoneHistory) => h.returned + h.fake + h.wrongNumber + h.noAnswer;

/** 0–100, or null for a phone with no decided order: new, not risky. */
export function deliveryScore(h: PhoneHistory): number | null {
  const decided = h.delivered + notReceived(h);
  return decided === 0 ? null : Math.round((100 * h.delivered) / decided);
}

export const RISK_REASONS = ['flagged', 'failed_deliveries', 'low_score'] as const;
export type RiskReason = (typeof RISK_REASONS)[number];

export interface PhoneRisk {
  history: PhoneHistory;
  score: number | null;
  /** Delivered plus not received. */
  decided: number;
  risky: boolean;
  /** Only `confirmation.autoConfirm` reads it. */
  trusted: boolean;
  reasons: RiskReason[];
}

export interface FraudRules {
  flagAfterFailed: number;
  minScore: number | null;
  minDecided: number;
}

/**
 * Risky is any of: flagged by staff, failed deliveries at the store's limit
 * (both Phase 5A), or a score under the store's threshold with enough
 * decided orders. Trusted is a high score over several deliveries, and not risky.
 */
export function assessPhone(
  history: PhoneHistory,
  customer: { flagged: boolean; failedDeliveries: number } | null,
  rules: FraudRules,
): PhoneRisk {
  const score = deliveryScore(history);
  const decided = history.delivered + notReceived(history);
  const reasons: RiskReason[] = [];
  if (customer?.flagged) reasons.push('flagged');
  if (customer && customer.failedDeliveries >= rules.flagAfterFailed) {
    reasons.push('failed_deliveries');
  }
  if (rules.minScore !== null && score !== null && decided >= rules.minDecided) {
    if (score < rules.minScore) reasons.push('low_score');
  }
  const risky = reasons.length > 0;
  const trusted =
    !risky &&
    score !== null &&
    score >= RECOVERY_LIMITS.trustedScore &&
    history.delivered >= RECOVERY_LIMITS.trustedDelivered;
  return { history, score, decided, risky, trusted, reasons };
}

// ---- The call script (§3.6) --------------------------------------------------------

export const SCRIPT_VARIABLES = [
  'name',
  'order_number',
  'items',
  'total',
  'cod_amount',
  'area',
  'delivery_estimate',
  'store_name',
] as const;

/** The default until the pilot stores give theirs (Q3); each store can replace it. */
export const DEFAULT_CALL_SCRIPT: Readonly<Record<'bn' | 'en', string>> = {
  bn: 'হ্যালো, আমি কি {name} এর সাথে কথা বলছি? আমি {store_name} থেকে বলছি, আপনার অর্ডার {order_number} নিয়ে: {items}। ডেলিভারির সময় {cod_amount} দিতে হবে, ঠিকানা {area}। অর্ডারটা কি পাঠিয়ে দেব? … ধন্যবাদ, {delivery_estimate} এর মধ্যে পৌঁছে যাবে।',
  en: "Hello, is this {name}? I'm calling from {store_name} about your order {order_number}: {items}, {cod_amount} to pay on delivery to {area}. Shall we send it? … Thank you, it will reach you in {delivery_estimate}.",
};

/** Placeholders a script uses that don't exist; saving refuses a script with any. */
export const unknownScriptVariables = (text: string) =>
  templateVariables(text).filter((v) => !(SCRIPT_VARIABLES as readonly string[]).includes(v));

/** The store's script in the order's language, or the default, filled in as plain text. */
export function renderCallScript(
  script: { bn?: string; en?: string },
  locale: 'bn' | 'en',
  values: Readonly<Partial<Record<(typeof SCRIPT_VARIABLES)[number], string>>>,
): string {
  return renderTemplate(script[locale] || DEFAULT_CALL_SCRIPT[locale], values, 'plain');
}
