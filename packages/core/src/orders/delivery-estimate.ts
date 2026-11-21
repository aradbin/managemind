// The expected delivery date on tracking (design/storefront-redesign:
// "Expected delivery: [date]"). Zones keep their time as the store wrote it
// ("1–2 days", "২-৩ দিন", "24 hours"), so the days are read from that text;
// the dates count from when the parcel was booked, or else when the store
// confirmed. Dates are Bangladesh dates (UTC+6, no daylight saving).
import type { Localized } from './variants';

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';
const DHAKA_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The days a zone's estimate text gives, or null when it gives none. */
export function estimateDays(
  estimate: Localized | null | undefined,
): { min: number; max: number } | null {
  for (const text of [estimate?.en, estimate?.bn]) {
    if (!text) continue;
    const latin = text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
    const range = /(\d+)\s*(?:[-–—]|to|থেকে)\s*(\d+)/i.exec(latin);
    const one = /(\d+)/.exec(latin);
    const numbers = range ? [Number(range[1]), Number(range[2])] : one ? [Number(one[1])] : [];
    if (!numbers.length) continue;
    const unit = /hour|ঘণ্টা|ঘন্টা/i.test(latin) ? 1 / 24 : /week|সপ্তাহ/i.test(latin) ? 7 : 1;
    const days = numbers.map((n) => Math.ceil(n * unit));
    const min = Math.min(...days);
    const max = Math.max(...days);
    if (max > 60) continue;
    return { min, max };
  }
  return null;
}

/** A Bangladesh calendar date, YYYY-MM-DD. */
export function dhakaDate(at: Date): string {
  return new Date(at.getTime() + DHAKA_MS).toISOString().slice(0, 10);
}

/**
 * The expected delivery dates, or null: before the store confirms, once
 * delivered or cancelled, when the zone's text gives no days, and once the
 * last date has passed (a late parcel shows its courier updates, not a date
 * that is already wrong).
 */
export function expectedDelivery(
  input: {
    status: string;
    deliveryStatus: string;
    confirmedAt: string | null;
    bookedAt: string | null;
    estimate: Localized | null;
  },
  now = new Date(),
): { from: string; to: string } | null {
  if (input.status === 'cancelled' || input.status === 'pending') return null;
  if (input.deliveryStatus === 'delivered' || input.deliveryStatus === 'returned') return null;
  const start = input.bookedAt ?? input.confirmedAt;
  const days = estimateDays(input.estimate);
  if (!start || !days) return null;
  const base = new Date(`${dhakaDate(new Date(start))}T00:00:00Z`).getTime();
  const from = new Date(base + days.min * DAY_MS).toISOString().slice(0, 10);
  const to = new Date(base + days.max * DAY_MS).toISOString().slice(0, 10);
  if (to < dhakaDate(now)) return null;
  return { from, to };
}
