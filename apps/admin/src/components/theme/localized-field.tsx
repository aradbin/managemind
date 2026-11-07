// A theme text in both languages: the store's language first, the other
// optional (the storefront falls back to the store's language).
import { useId } from 'react';
import type { AdminKey } from '../../i18n';
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';
import { LANGUAGE_NAMES, type Lang, otherLang } from '../catalog/language-tabs';
import { fieldLabel } from '../field-styles';
import { Input, Textarea } from '../ui/input';

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
  /** One above the other, as in the theme editor's narrow column. */
  stacked?: boolean;
}

export function LocalizedField({
  label,
  value,
  onChange,
  defaultLang,
  maxLength,
  multiline,
  disabled,
  stacked,
}: Props) {
  const { t } = useLocale();
  const id = useId();
  return (
    <div className={cn('grid gap-3.5', !stacked && 'md:grid-cols-2 md:gap-x-4')}>
      {[defaultLang, otherLang(defaultLang)].map((lang: Lang) => {
        const inputId = `${id}-${lang}`;
        const set = (text: string) => {
          const next = { ...value };
          if (text) next[lang] = text;
          else delete next[lang];
          onChange(next);
        };
        return (
          <div key={lang} className="flex flex-col">
            <label htmlFor={inputId} className={fieldLabel}>
              {t(label, { language: LANGUAGE_NAMES[lang] })}
              {lang !== defaultLang && (
                <span className="font-normal text-muted-foreground"> ({t('form.optional')})</span>
              )}
            </label>
            {multiline ? (
              <Textarea
                id={inputId}
                lang={lang}
                maxLength={maxLength}
                disabled={disabled}
                value={value[lang] ?? ''}
                onChange={(e) => set(e.target.value)}
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
