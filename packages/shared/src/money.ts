// Money in integer minor units (poisha for BDT). No floats in money math:
// every operation stays on safe integers, and percentages use BigInt for the
// intermediate product. Rounding happens once per call, half away from zero.

export type CurrencyCode = 'BDT';

export const CURRENCIES = {
  BDT: { minorUnits: 2 },
} as const satisfies Record<CurrencyCode, { minorUnits: number }>;

export interface Money {
  /** Amount in minor units (poisha). Always a safe integer. */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Money amount must be a safe integer in minor units, got ${amount}`);
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(`Currency mismatch: ${a.currency} and ${b.currency}`);
  }
}

export function money(amount: number, currency: CurrencyCode = 'BDT'): Money {
  assertAmount(amount);
  return { amount, currency };
}

export const zero = (currency: CurrencyCode = 'BDT'): Money => money(0, currency);

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function multiply(m: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity)) {
    throw new RangeError(`Quantity must be an integer, got ${quantity}`);
  }
  return money(m.amount * quantity, m.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode = 'BDT'): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export const compare = (a: Money, b: Money): -1 | 0 | 1 => {
  assertSameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
};

/** Integer division of BigInts, rounding half away from zero. */
function divRound(n: bigint, d: bigint): bigint {
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an + ad / 2n) / ad;
  return negative ? -q : q;
}

/** A share of `m` in basis points (1 bp = 0.01%), e.g. 1500 = 15%. */
export function percentOf(m: Money, basisPoints: number): Money {
  if (!Number.isSafeInteger(basisPoints)) {
    throw new RangeError(`Basis points must be an integer, got ${basisPoints}`);
  }
  return money(Number(divRound(BigInt(m.amount) * BigInt(basisPoints), 10_000n)), m.currency);
}

/**
 * Splits `m` in proportion to integer `weights` (largest remainder method).
 * The parts always add up to `m` exactly; leftover minor units go to the
 * parts with the largest remainders, earlier parts first on ties.
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new RangeError('allocate needs at least one weight');
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new RangeError(`Weights must be non-negative integers, got ${w}`);
    }
  }
  const total = weights.reduce((a, w) => a + BigInt(w), 0n);
  if (total === 0n) throw new RangeError('allocate needs at least one positive weight');

  const sign = m.amount < 0 ? -1n : 1n;
  const amount = BigInt(Math.abs(m.amount));
  const shares = weights.map((w) => (amount * BigInt(w)) / total);
  const remainders = weights.map((w, i) => ({ i, r: (amount * BigInt(w)) % total }));
  let left = amount - shares.reduce((a, s) => a + s, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    shares[i] = (shares[i] ?? 0n) + 1n;
    left -= 1n;
  }
  return shares.map((s) => money(Number(s * sign), m.currency));
}

export type Locale = 'bn' | 'en';
export type Numerals = 'bengali' | 'latin';

export interface FormatOptions {
  /** Defaults to Bengali digits for `bn` and Latin digits for `en`. */
  numerals?: Numerals;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Formats for display, e.g. "৳1,234.50" (en) or "১,২৩৪.৫০৳" (bn). */
export function format(m: Money, locale: Locale, options: FormatOptions = {}): string {
  const numerals = options.numerals ?? (locale === 'bn' ? 'bengali' : 'latin');
  const key = `${locale}:${numerals}:${m.currency}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      style: 'currency',
      currency: m.currency,
      currencyDisplay: 'narrowSymbol',
      numberingSystem: numerals === 'bengali' ? 'beng' : 'latn',
    });
    formatters.set(key, f);
  }
  // Build the decimal as a string so no float is ever involved.
  const digits = CURRENCIES[m.currency].minorUnits;
  const abs = Math.abs(m.amount)
    .toString()
    .padStart(digits + 1, '0');
  const decimal = `${m.amount < 0 ? '-' : ''}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
  return f.format(decimal as `${number}`);
}
