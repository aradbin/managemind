import { Check, Languages } from 'lucide-react';
import { LANGUAGES, useLocale } from '../i18n';
import { Button } from './ui/button';
import { Menu, menuContent, menuItem } from './ui/menu';

/**
 * The header's language button (ADR 0033): it opens a menu of the languages,
 * each named in itself, with a check by the one in use. Screens before the
 * admin list both languages in their footer instead (ADR 0034).
 */
export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="secondary"
          size="icon"
          aria-label={t('more.language')}
          title={t('more.language')}
        >
          <Languages aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className={menuContent}>
          <Menu.RadioGroup
            value={locale}
            onValueChange={(v) => {
              const next = LANGUAGES.find((l) => l.value === v);
              if (next) setLocale(next.value);
            }}
          >
            {LANGUAGES.map((l) => (
              <Menu.RadioItem key={l.value} value={l.value} lang={l.value} className={menuItem}>
                <span className="flex-1">{l.label}</span>
                <Menu.ItemIndicator>
                  <Check aria-hidden className="!text-foreground" />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
