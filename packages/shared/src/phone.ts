// Bangladeshi phone numbers. Stored in E.164 (+8801712345678) and shown in
// local format; every input (checkout, import, admin, manual orders) goes
// through normalizePhone before it is saved or matched (PLAN.md, core
// principles). Only mobile numbers: shoppers and staff are reached by SMS.

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Mobile numbers: 1 followed by an operator digit (3–9) and 8 more digits. */
const NATIONAL = /^1[3-9]\d{8}$/;

/**
 * Returns the E.164 form, or null if `input` is not a Bangladeshi mobile
 * number. Accepts Bangla digits, spaces, dashes, dots and brackets, and the
 * forms 01XXXXXXXXX, 1XXXXXXXXX, 8801XXXXXXXXX, +8801XXXXXXXXX and 008801XXXXXXXXX.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
  const plus = digits.trim().startsWith('+');
  digits = digits.replace(/[\s\-.()]/g, '');
  if (plus) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;

  let national: string;
  if (digits.startsWith('00880')) national = digits.slice(5);
  else if (digits.startsWith('880')) national = digits.slice(3);
  else if (plus)
    return null; // another country's code
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;
  return NATIONAL.test(national) ? `+880${national}` : null;
}

/** "+8801712345678" -> "01712-345678", in Bangla digits when asked. */
export function formatPhone(e164: string, numerals: 'latin' | 'bengali' = 'latin'): string {
  const match = /^\+880(1\d{3})(\d{6})$/.exec(e164);
  if (!match) return e164;
  const local = `0${match[1]}-${match[2]}`;
  return numerals === 'bengali'
    ? local.replace(/\d/g, (d) => BANGLA_DIGITS[Number(d)] ?? d)
    : local;
}
