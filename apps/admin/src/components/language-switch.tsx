import { useLocale } from '../i18n';
import { Button } from './ui/button';

/** Switches between Bangla and English; the label is in the other language. */
export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  const other = locale === 'bn' ? 'en' : 'bn';
  return (
    <Button variant="ghost" lang={other} onClick={() => setLocale(other)}>
      {t('language.switch')}
    </Button>
  );
}
