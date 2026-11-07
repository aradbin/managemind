import { Languages } from 'lucide-react';
import { useLocale } from '../i18n';
import { Button } from './ui/button';

/**
 * Switches between Bangla and English: the header's icon button, named in
 * the other language (ADR 0033). Screens before the admin list both
 * languages in their footer instead (ADR 0034).
 */
export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  const other = locale === 'bn' ? 'en' : 'bn';
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
