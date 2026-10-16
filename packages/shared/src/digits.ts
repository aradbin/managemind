// Bangla digits (০–৯) appear in every kind of typed input: prices, phone
// numbers, quantities and spreadsheet cells. Parsers convert them first.

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

/** "১২৩" -> "123"; other characters are left alone. */
export const toLatinDigits = (input: string): string =>
  input.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));

/** "123" -> "১২৩"; other characters are left alone. */
export const toBanglaDigits = (input: string): string =>
  input.replace(/\d/g, (d) => BANGLA_DIGITS[Number(d)] ?? d);

/**
 * A whole number typed by a person ("১২", " 1,200 "), or null. Thousands
 * separators are accepted; a sign is accepted only when `signed` is set.
 */
export function parseInteger(input: string, { signed = false } = {}): number | null {
  const text = toLatinDigits(input)
    .trim()
    .replace(/(?<=\d),(?=\d)/g, '');
  if (!(signed ? /^[-+]?\d+$/ : /^\+?\d+$/).test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}
