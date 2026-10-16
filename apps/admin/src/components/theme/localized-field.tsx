// A theme text in both languages: the store's language first, the other
// optional (the storefront falls back to the store's language).
import { useId } from 'react';
import type { AdminKey } from '../../i18n';
import { useLocale } from '../../i18n';
import { LANGUAGE_NAMES, type Lang, otherLang } from '../catalog/language-tabs';
import { Input } from '../ui/input';

export type Localized = { bn?: string; en?: string };

interface Props {
  /** A message with {language}, e.g. "Heading ({language})". */
  label: AdminKey;
  value: Localized;
  onChange: (value: Localized) => void;
  defaultLang: Lang;
  maxLength: number;
  multiline?: boolean;
  disabled?: boolean;
}

export function LocalizedField({
  label,
  value,
  onChange,
  defaultLang,
  maxLength,
  multiline,
  disabled,
}: Props) {
  const { t } = useLocale();
  const id = useId();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[defaultLang, otherLang(defaultLang)].map((lang: Lang) => {
        const inputId = `${id}-${lang}`;
        const set = (text: string) => {
          const next = { ...value };
          if (text) next[lang] = text;
          else delete next[lang];
          onChange(next);
        };
        return (
          <div key={lang} className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              {t(label, { language: LANGUAGE_NAMES[lang] })}
              {lang !== defaultLang && (
                <span className="font-normal text-muted-foreground"> ({t('form.optional')})</span>
              )}
            </label>
            {multiline ? (
              <textarea
                id={inputId}
                lang={lang}
                rows={3}
                maxLength={maxLength}
                disabled={disabled}
                value={value[lang] ?? ''}
                onChange={(e) => set(e.target.value)}
                className="w-full rounded-md border border-border bg-background p-3 text-base disabled:opacity-50"
              />
            ) : (
              <Input
                id={inputId}
                lang={lang}
                maxLength={maxLength}
                disabled={disabled}
                value={value[lang] ?? ''}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
