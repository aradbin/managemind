// Light, dark or the device's setting (lib/theme.ts), the device's by
// default: a menu behind the header's theme button, one row of three icons in
// the account menu, and the same row on the phone's Menu page.
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useId } from 'react';
import { useLocale } from '../i18n';
import {
  parseThemeChoice,
  setThemeChoice,
  THEME_CHOICES,
  type ThemeChoice,
  useResolvedTheme,
  useThemeChoice,
} from '../lib/theme';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { menuContent, menuItem } from './ui/menu';

const ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<ThemeChoice, unknown>;

/** One segment of the three-icon control: grey, white once chosen. */
const segment =
  'relative inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0';
const segmentOn = 'bg-background text-foreground shadow-sm dark:bg-input';
const track = 'inline-flex shrink-0 items-center gap-0.5 rounded-[10px] bg-muted p-[3px]';

/** The header's theme button: it shows the theme in use and opens the three choices. */
export function ThemeMenu() {
  const { t } = useLocale();
  const choice = useThemeChoice();
  const resolved = useResolvedTheme();
  const Icon = choice === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="secondary"
          size="icon"
          aria-label={t('appearance.title')}
          title={t('appearance.title')}
        >
          <Icon aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className={menuContent}>
          <Menu.RadioGroup
            value={choice}
            onValueChange={(v) => setThemeChoice(parseThemeChoice(v))}
          >
            {THEME_CHOICES.map((c) => {
              const ItemIcon = ICONS[c];
              return (
                <Menu.RadioItem key={c} value={c} className={menuItem}>
                  <ItemIcon aria-hidden />
                  <span className="flex-1">{t(`appearance.${c}`)}</span>
                  <Menu.ItemIndicator>
                    <Check aria-hidden className="!text-foreground" />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              );
            })}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * The account menu's Appearance row: its name, then the three choices as
 * icons on one line. They stay menu items, so the arrow keys reach them, and
 * picking one keeps the menu open to show it.
 */
export function ThemeMenuRow() {
  const { t } = useLocale();
  const choice = useThemeChoice();
  return (
    <div className="flex items-center gap-3 py-1 ps-2 pe-1">
      <span className="flex-1 text-sm">{t('appearance.title')}</span>
      <Menu.RadioGroup
        aria-label={t('appearance.title')}
        value={choice}
        onValueChange={(v) => setThemeChoice(parseThemeChoice(v))}
        className={track}
      >
        {THEME_CHOICES.map((c) => {
          const Icon = ICONS[c];
          return (
            <Menu.RadioItem
              key={c}
              value={c}
              aria-label={t(`appearance.${c}`)}
              title={t(`appearance.${c}`)}
              onSelect={(e) => e.preventDefault()}
              className={cn(
                segment,
                'data-[highlighted]:ring-2 data-[highlighted]:ring-ring/50',
                choice === c && segmentOn,
              )}
            >
              <Icon aria-hidden />
            </Menu.RadioItem>
          );
        })}
      </Menu.RadioGroup>
    </div>
  );
}

/** The same three icons as radios, for the end of a row on the Menu page. */
export function ThemeSwitch({ labelledBy }: { labelledBy?: string }) {
  const { t } = useLocale();
  const choice = useThemeChoice();
  const name = useId();
  return (
    <div
      role="radiogroup"
      {...(labelledBy
        ? { 'aria-labelledby': labelledBy }
        : { 'aria-label': t('appearance.title') })}
      className={cn(track, 'p-1')}
    >
      {THEME_CHOICES.map((c) => {
        const Icon = ICONS[c];
        return (
          <label
            key={c}
            title={t(`appearance.${c}`)}
            className={cn(
              segment,
              'size-[30px] has-focus-visible:ring-2 has-focus-visible:ring-ring',
              choice === c && segmentOn,
            )}
          >
            <input
              type="radio"
              name={name}
              value={c}
              checked={choice === c}
              aria-label={t(`appearance.${c}`)}
              onChange={() => setThemeChoice(c)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <Icon aria-hidden />
          </label>
        );
      })}
    </div>
  );
}
