// Dates in the admin put the day first, British order, in Dhaka time (ADR
// 0033 design rule 11): "Thursday, 29 October", "1 Oct – 29 Oct, 2026".
// The shared formatter reads English as en-BD, which ICU writes month
// first; numbers keep en-BD's grouping, dates take en-GB's order.
import type { Locale, Numerals } from '@managemind/shared/i18n';

export function formatDateTime(
  locale: Locale,
  value: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  numerals?: Numerals,
): string {
  const digits =
    (numerals ?? (locale === 'bn' ? 'bengali' : 'latin')) === 'bengali' ? 'beng' : 'latn';
  return new Intl.DateTimeFormat(`${locale === 'bn' ? 'bn-BD' : 'en-GB'}-u-nu-${digits}`, {
    ...options,
    timeZone: 'Asia/Dhaka',
  }).format(value);
}
