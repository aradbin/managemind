// Bangla and English tabs for translated fields (phase-2-plan §3.2, §7), drawn
// as a segmented control (ADR 0033, design rule 2). The store's default
// language comes first and is required; the other is optional and can be
// added or removed.
import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';

export type Lang = 'bn' | 'en';
export const LANGUAGE_NAMES: Record<Lang, string> = { bn: 'বাংলা', en: 'English' };

export const otherLang = (lang: Lang): Lang => (lang === 'bn' ? 'en' : 'bn');

interface LanguageTabsProps {
  defaultLang: Lang;
  active: Lang;
  onChange: (lang: Lang) => void;
  /** Languages with content: an absent optional one shows an "add" hint. */
  present: ReadonlySet<Lang>;
  children: (lang: Lang) => ReactNode;
  /** Marks a tab whose fields have errors. */
  invalid?: ReadonlySet<Lang> | undefined;
}

/** WAI-ARIA tabs with arrow-key navigation. */
export function LanguageTabs({
  defaultLang,
  active,
  onChange,
  present,
  children,
  invalid,
}: LanguageTabsProps) {
  const { t } = useLocale();
  const id = useId();
  const langs: Lang[] = [defaultLang, otherLang(defaultLang)];
  const refs = useRef<Record<Lang, HTMLButtonElement | null>>({ bn: null, en: null });
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = otherLang(active);
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={t('product.languages')}
        className="inline-flex h-9 self-start rounded-[10px] bg-muted p-[3px]"
      >
        {langs.map((lang) => (
          <button
            key={lang}
            ref={(el) => {
              refs.current[lang] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-${lang}-tab`}
            aria-selected={active === lang}
            aria-controls={`${id}-${lang}-panel`}
            tabIndex={active === lang ? 0 : -1}
            onClick={() => onChange(lang)}
            onKeyDown={onKeyDown}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm font-medium',
              active === lang
                ? 'bg-background text-foreground shadow-sm dark:border-input dark:bg-input'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span lang={lang}>{LANGUAGE_NAMES[lang]}</span>
            {lang === defaultLang ? (
              <span className="text-xs text-muted-foreground">
                ({t('product.defaultLanguage')})
              </span>
            ) : (
              !present.has(lang) && (
                <span className="text-xs text-muted-foreground">({t('form.optional')})</span>
              )
            )}
            {invalid?.has(lang) && (
              <>
                <span aria-hidden className="size-2 rounded-full bg-danger" />
                <span className="sr-only">{t('form.invalid')}</span>
              </>
            )}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-${active}-panel`}
        aria-labelledby={`${id}-${active}-tab`}
        lang={active}
      >
        {children(active)}
      </div>
    </div>
  );
}
