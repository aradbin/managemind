// Prices and numbers on the storefront, in the store's digits (Phase 1's
// display.numerals; phase-3-plan §3.5). Whole taka show no decimals.
import { formatNumber, type Locale, type Numerals } from '@managemind/shared/i18n';
import { format } from '@managemind/shared/money';

export interface Display {
  locale: Locale;
  numerals: Numerals;
}

/** The store's digits, or the language's own when the store chose none. */
export const displayFor = (locale: Locale, numerals: Numerals | null): Display => ({
  locale,
  numerals: numerals ?? (locale === 'bn' ? 'bengali' : 'latin'),
});

/** "৳1,250" or "৳1,250.50" (en), "১,২৫০৳" (bn). */
export function price(amount: number, d: Display): string {
  const text = format({ amount, currency: 'BDT' }, d.locale, { numerals: d.numerals });
  return amount % 100 === 0 ? text.replace(/[.,]?[0০]{2}(?=\D*$)/u, '') : text;
}

/** A price range, or one price when they're equal. */
export function priceRange(min: number | null, max: number | null, d: Display): string {
  if (min === null) return '';
  return max !== null && max !== min ? `${price(min, d)} – ${price(max, d)}` : price(min, d);
}

export const number = (value: number, d: Display): string =>
  formatNumber(d.locale, value, d.numerals);

/** Poisha as a plain decimal for schema.org (BDT, no grouping): 125050 -> "1250.50". */
export const decimalPrice = (amount: number): string =>
  `${Math.trunc(amount / 100)}.${String(Math.abs(amount) % 100).padStart(2, '0')}`;
