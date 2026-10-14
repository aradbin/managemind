// Typed messages in Bangla and English with safe {placeholder} substitution,
// plurals through Intl.PluralRules, and number and date formatting in
// Asia/Dhaka. Output is plain text: renderers (Astro, React) escape it.
import type { Locale, Numerals } from '../money';
import { bn } from './bn';
import { en } from './en';

export type { Locale, Numerals } from '../money';
export const LOCALES = ['bn', 'en'] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = 'bn';
export const TIME_ZONE = 'Asia/Dhaka';

export type MessageKey = keyof typeof en;
type Plural = { readonly one: string; readonly other: string };
type Message = string | Plural;
export type Messages = {
  readonly [K in MessageKey]: (typeof en)[K] extends Plural ? Plural : string;
};

export type Params = Record<string, string | number>;
export type { Message };

const intlLocale = (locale: Locale, numerals?: Numerals) =>
  `${locale === 'bn' ? 'bn-BD' : 'en-BD'}-u-nu-${(numerals ?? (locale === 'bn' ? 'bengali' : 'latin')) === 'bengali' ? 'beng' : 'latn'}`;

const pluralRules = new Map<Locale, Intl.PluralRules>();

/**
 * A t() over any pair of catalogs, so each app keeps its own messages (the
 * admin's never reach storefront bundles). Missing Bangla falls back to
 * English, then to the key.
 */
export function createTranslator<K extends string>(catalogs: {
  en: Readonly<Record<K, Message>>;
  bn: Readonly<Partial<Record<K, Message>>>;
}) {
  return (locale: Locale, key: K, params: Params = {}, numerals?: Numerals): string => {
    const message = catalogs[locale][key] ?? catalogs.en[key] ?? key;
    let text: string;
    if (typeof message === 'string') {
      text = message;
    } else {
      let rules = pluralRules.get(locale);
      if (!rules) {
        rules = new Intl.PluralRules(locale === 'bn' ? 'bn-BD' : 'en-BD');
        pluralRules.set(locale, rules);
      }
      text = rules.select(Number(params.count ?? 0)) === 'one' ? message.one : message.other;
    }
    return text.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      if (value === undefined) return match;
      return typeof value === 'number' ? formatNumber(locale, value, numerals) : value;
    });
  };
}

/** Translates a shared message (storefront and common strings). */
export const t: (locale: Locale, key: MessageKey, params?: Params, numerals?: Numerals) => string =
  createTranslator<MessageKey>({ en, bn });

export function formatNumber(locale: Locale, value: number, numerals?: Numerals): string {
  return new Intl.NumberFormat(intlLocale(locale, numerals)).format(value);
}

export function formatDateTime(
  locale: Locale,
  value: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  numerals?: Numerals,
): string {
  return new Intl.DateTimeFormat(intlLocale(locale, numerals), {
    ...options,
    timeZone: TIME_ZONE,
  }).format(value);
}

/** Placeholder names used by a message, e.g. ["host"]; for the parity test. */
export function placeholders(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : [message.one, message.other];
  return [
    ...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''))),
  ].sort();
}

export const messages = { bn, en } as const;
