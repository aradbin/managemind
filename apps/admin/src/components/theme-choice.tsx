// Light, dark or the device's setting (lib/theme.ts): three radio items in
// the header's account menu on desktops, and a three-way switch on More.
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useId } from 'react';
import { useLocale } from '../i18n';
import {
  parseThemeChoice,
  setThemeChoice,
  THEME_CHOICES,
  type ThemeChoice,
  useThemeChoice,
} from '../lib/theme';

const ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<ThemeChoice, unknown>;

/** The account menu's group; picking one keeps the menu open to show it. */
export function ThemeMenuItems({ item }: { item: string }) {
  const { t } = useLocale();
  const choice = useThemeChoice();
  return (
    <>
      <Menu.Label className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('appearance.title')}
      </Menu.Label>
      <Menu.RadioGroup value={choice} onValueChange={(v) => setThemeChoice(parseThemeChoice(v))}>
        {THEME_CHOICES.map((c) => {
          const Icon = ICONS[c];
          return (
            <Menu.RadioItem
              key={c}
              value={c}
              className={`${item} gap-3`}
              onSelect={(e) => e.preventDefault()}
            >
              <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">{t(`appearance.${c}`)}</span>
              <Menu.ItemIndicator>
                <Check aria-hidden className="size-4 text-primary" />
              </Menu.ItemIndicator>
            </Menu.RadioItem>
          );
        })}
      </Menu.RadioGroup>
    </>
  );
}

/** A segmented switch of three radios, for a row of the More page. */
export function ThemeSwitch() {
  const { t } = useLocale();
  const choice = useThemeChoice();
  const name = useId();
  return (
    <fieldset className="px-3.5 py-3">
      <legend className="float-left mb-2.5 w-full font-medium">{t('appearance.title')}</legend>
      <div className="clear-both grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {THEME_CHOICES.map((c) => {
          const Icon = ICONS[c];
          return (
            <label
              key={c}
              className="relative flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <input
                type="radio"
                name={name}
                value={c}
                checked={choice === c}
                onChange={() => setThemeChoice(c)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="truncate">{t(`appearance.${c}`)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
