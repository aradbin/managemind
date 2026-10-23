// The admin's translator and the current language, kept in React context and
// remembered on this device. The document's lang follows it (WCAG 3.1.1).
// Only the current language's messages are downloaded (phase-4-plan PR 0b):
// main.tsx loads them before the first render, and switching language loads
// the other first. Feature screens bring their own catalogs with their pages.
import { createTranslator, type Locale, type Message, type Params } from '@managemind/shared/i18n';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { en } from './en';
import type { messagesEn } from './messages-en';
import type { onlineStoreEn } from './online-store-en';
import type { ordersEn } from './orders-en';
import type { promotionsEn } from './promotions-en';
import type { returnsEn } from './returns-en';

/** Every key, including those of catalogs loaded with their pages. */
export type AdminKey =
  | keyof typeof en
  | keyof typeof messagesEn
  | keyof typeof onlineStoreEn
  | keyof typeof ordersEn
  | keyof typeof promotionsEn
  | keyof typeof returnsEn;
const catalogs = {
  en: {} as Record<AdminKey, Message>,
  bn: {} as Partial<Record<AdminKey, Message>>,
};
export const translate = createTranslator<AdminKey>(catalogs);
export const messages = catalogs;

/**
 * Adds a catalog loaded with its pages (the online store's messages), so the
 * first download stays small. Pages that use these keys import the module
 * that calls this, so their keys are there before they render.
 */
export function addMessages(more: {
  en: Partial<Record<AdminKey, Message>>;
  bn: Partial<Record<AdminKey, Message>>;
}): void {
  Object.assign(catalogs.en, more.en);
  Object.assign(catalogs.bn, more.bn);
}

const loaded = new Set<Locale>();

/** Downloads a language's base messages once (each is its own chunk). */
export async function loadLocale(locale: Locale): Promise<void> {
  if (loaded.has(locale)) return;
  const base = locale === 'bn' ? (await import('./bn')).bn : (await import('./en')).en;
  Object.assign(catalogs[locale], base);
  loaded.add(locale);
}

const STORAGE_KEY = 'mm.locale';

export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'bn' || saved === 'en') return saved;
  } catch {
    // Storage can be unavailable (private mode); fall back to Bangla.
  }
  return 'bn';
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: AdminKey, params?: Params) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: (next) => {
        void loadLocale(next).then(() => {
          setLocaleState(next);
          try {
            localStorage.setItem(STORAGE_KEY, next);
          } catch {
            // Not remembered; still switched for this visit.
          }
        });
      },
      t: (key, params) => translate(locale, key, params),
    }),
    [locale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale needs a LocaleProvider');
  return value;
}
