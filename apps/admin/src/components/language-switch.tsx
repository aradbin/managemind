import { Languages } from 'lucide-react';
import { useLocale } from '../i18n';
import { Button } from './ui/button';

/**
 * Switches between Bangla and English; the label is in the other language.
 * In the header it is an icon button named by that label (ADR 0033).
 */
export function LanguageSwitch({ icon = false }: { icon?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  const other = locale === 'bn' ? 'en' : 'bn';
  if (icon) {
    return (
      <Button
        variant="secondary"
        size="icon"
        lang={other}
        aria-label={t('language.switch')}
        title={t('language.switch')}
        onClick={() => setLocale(other)}
      >
        <Languages aria-hidden />
      </Button>
    );
  }
  return (
    <Button variant="ghost" lang={other} onClick={() => setLocale(other)}>
      {t('language.switch')}
    </Button>
  );
}
