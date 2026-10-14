// The admin's translator and the current language, kept in React context and
// remembered on this device. The document's lang follows it (WCAG 3.1.1).
import { createTranslator, type Locale, type Params } from '@managemind/shared/i18n';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { bn } from './bn';
import { en } from './en';

export type AdminKey = keyof typeof en;
export const translate = createTranslator<AdminKey>({ en, bn });
export const messages = { en, bn };

const STORAGE_KEY = 'mm.locale';

function initialLocale(): Locale {
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
        setLocaleState(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Not remembered; still switched for this visit.
        }
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
