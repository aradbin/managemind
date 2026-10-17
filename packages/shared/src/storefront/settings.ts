// Storefront settings (phase-3-plan §3.6–§3.10): search-engine indexing,
// tracking IDs, the consent banner's text, chat buttons and holiday mode.
// Stored as `storefront` in the store's settings JSON.
import { z } from 'zod';
import { cleanText } from '../catalog/text';
import { normalizePhone } from '../phone';

const localized = (max: number) =>
  z
    .object({
      bn: z.string().transform(cleanText).pipe(z.string().max(max)).optional(),
      en: z.string().transform(cleanText).pipe(z.string().max(max)).optional(),
    })
    .strict()
    .transform((v) => ({ ...(v.bn ? { bn: v.bn } : {}), ...(v.en ? { en: v.en } : {}) }));

/** A Meta Pixel ID: 15 or 16 digits. */
export const META_PIXEL_ID = /^\d{15,16}$/;
/** A GA4 measurement ID: G- and 4 to 12 letters or digits. */
export const GA4_ID = /^G-[A-Z0-9]{4,12}$/;

/** WhatsApp numbers: a Bangladeshi mobile number, stored in E.164. */
const whatsapp = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'must be a Bangladeshi mobile number' });
      return z.NEVER;
    }
    return phone;
  });

export const CHAT_PLACEMENTS = ['all', 'product', 'none'] as const;

export const holidaySettings = z
  .object({
    /** UTC instants; the admin enters Asia/Dhaka times. */
    startsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString()),
    endsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString()),
    message: localized(200),
  })
  .strict()
  .refine((h) => h.endsAt > h.startsAt, { message: 'must end after it starts', path: ['endsAt'] })
  .refine((h) => Date.parse(h.endsAt) - Date.parse(h.startsAt) <= 60 * 86_400_000, {
    message: 'at most 60 days',
    path: ['endsAt'],
  });
export type HolidaySettings = z.infer<typeof holidaySettings>;

export const storefrontSettings = z
  .object({
    /** Off until the owner turns it on: every page is noindex (Q7). */
    indexing: z.boolean().default(false),
    tracking: z
      .object({
        metaPixelId: z.string().trim().regex(META_PIXEL_ID, '15 or 16 digits').optional(),
        ga4Id: z.string().trim().toUpperCase().regex(GA4_ID, 'looks like G-XXXXXXXXXX').optional(),
      })
      .strict()
      .default({}),
    /** The banner's text; empty uses the default wording (§3.10, Q11). */
    consent: z
      .object({ text: localized(300).default({}) })
      .strict()
      .default({ text: {} }),
    chat: z
      .object({
        whatsapp: whatsapp.optional(),
        /** The page's username, as in m.me/<username>. */
        messenger: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9.]{5,50}$/, 'a page username: letters, digits and dots')
          .optional(),
        greeting: localized(200).default({}),
        show: z.enum(CHAT_PLACEMENTS).default('all'),
      })
      .strict()
      .default({ greeting: {}, show: 'all' }),
    holiday: holidaySettings.nullable().default(null),
  })
  .strict();
export type StorefrontSettings = z.infer<typeof storefrontSettings>;

export const defaultStorefrontSettings = (): StorefrontSettings => storefrontSettings.parse({});

/** The default consent wording (§3.10), approved by the owner (Q11). */
export const DEFAULT_CONSENT_TEXT = {
  bn: 'আমরা আপনার অভিজ্ঞতা উন্নত করতে এবং বিজ্ঞাপন মাপতে কুকি ব্যবহার করি। আপনি কি সম্মত?',
  en: 'We use cookies to improve your visit and measure our ads. Do you agree?',
} as const;

/** Whether the holiday window is open at `now`. */
export function holidayActive(holiday: HolidaySettings | null, now: Date = new Date()): boolean {
  if (!holiday) return false;
  const t = now.getTime();
  return t >= Date.parse(holiday.startsAt) && t < Date.parse(holiday.endsAt);
}

/** Dhaka is UTC+6 all year (no daylight saving). */
const DHAKA_OFFSET_MS = 6 * 3_600_000;

/** "2026-04-01T09:00" in Asia/Dhaka -> the UTC instant, as ISO. */
export function dhakaToUtc(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new TypeError(`Not a local date and time: ${local}`);
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - DHAKA_OFFSET_MS).toISOString();
}

/** A UTC instant -> "2026-04-01T09:00" in Asia/Dhaka, for a datetime-local input. */
export function utcToDhaka(iso: string): string {
  return new Date(Date.parse(iso) + DHAKA_OFFSET_MS).toISOString().slice(0, 16);
}

/** A WhatsApp chat link with a prefilled message: https://wa.me/8801…?text=… */
export function whatsappLink(e164: string, text?: string): string {
  const url = `https://wa.me/${e164.replace(/\D/g, '')}`;
  return text ? `${url}?text=${encodeURIComponent(text)}` : url;
}

/** A Messenger chat link: https://m.me/<username> */
export function messengerLink(username: string, text?: string): string {
  const url = `https://m.me/${encodeURIComponent(username)}`;
  return text ? `${url}?text=${encodeURIComponent(text)}` : url;
}
