// Menu (ADR 0029, 0033 and 0034, the canvas's phone Menu): everything the
// five-tab bar leaves out. Who is signed in and the store switch, every area
// the tab bar doesn't hold (an area opens into its pages, as in the desktop
// sidebar), View store, the preferences (dark mode, language, help) and sign
// out. Desktops reach the same through the sidebar and the header, but the
// page works there too.
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useRouterState } from '@tanstack/react-router';
import { ChevronRight, CircleHelp, ExternalLink, Languages, LogOut, Moon, Sun } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useSignOut } from '../../components/account-menu';
import { useHelpLinks } from '../../components/help-menu';
import {
  Badge,
  locate,
  type NavGroup,
  type NavItem,
  useNav,
  useToConfirm,
} from '../../components/nav';
import { usePermission } from '../../components/permission-gate';
import { initials, StoreSwitcher } from '../../components/store-switcher';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Segmented } from '../../components/ui/segmented';
import { Switch } from '../../components/ui/switch';
import { useLocale } from '../../i18n';
import { meQuery } from '../../lib/api';
import { storeSettingsQuery } from '../../lib/catalog';
import { setThemeChoice, useThemeChoice } from '../../lib/theme';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/_shell/more')({ component: MorePage });

const row =
  'flex min-h-13 w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-accent';
const tile =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-4';
const chevron = (
  <ChevronRight
    aria-hidden
    className="size-4 shrink-0 text-muted-foreground transition-transform duration-200"
  />
);
const sub = 'truncate text-[13px] leading-[18px] text-muted-foreground';

/** The tab bar holds Home and Customers; the Menu lists the rest. */
const IN_TABS = new Set(['home', 'customers']);

function MorePage() {
  const { t, locale, setLocale } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  const nav = useNav();
  const canViewStore = usePermission('settings.read');
  const settings = useQuery({ ...storeSettingsQuery, enabled: canViewStore });
  const { links: help } = useHelpLinks(true);
  const signOut = useSignOut();
  const [confirming, setConfirming] = useState(false);
  const choice = useThemeChoice();
  const dark =
    choice === 'dark' ||
    (choice === 'system' &&
      typeof document !== 'undefined' &&
      document.documentElement.dataset.theme === 'dark');
  const helpLink = help[0];

  return (
    <div className="-m-4 flex min-h-full flex-col gap-6 bg-page px-4 pt-4 pb-6 md:m-0 md:mx-auto md:w-full md:max-w-xl md:bg-transparent md:p-0">
      <h1 className="hidden text-xl leading-7 font-semibold tracking-[-0.01em] md:block">
        {t('nav.menu')}
      </h1>

      <div className={group}>
        <Link to="/account" className={cn(row, 'min-h-16')}>
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-medium"
          >
            {initials(me.user.name)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{me.user.name}</span>
            <span className={sub}>{me.user.email}</span>
          </span>
          {chevron}
        </Link>
        {me.stores.length > 0 && <StoreSwitcher me={me} look="row" />}
      </div>

      {nav.groups.map((g) => (
        <Group
          key={g.key}
          group={g}
          extra={
            g.key === 'store' &&
            settings.data && (
              <a href={settings.data.storeUrl} target="_blank" rel="noopener" className={row}>
                <span aria-hidden className={tile}>
                  <ExternalLink />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{t('store.view')}</span>
                  <span className={sub}>{t('more.opensNewTab')}</span>
                </span>
              </a>
            )
          }
        />
      ))}

      <Section label={t('more.preferences')}>
        <div className={cn(row, 'hover:bg-transparent')}>
          <span aria-hidden className={tile}>
            {dark ? <Sun /> : <Moon />}
          </span>
          <label htmlFor="menu-dark" className="flex-1 cursor-pointer font-medium">
            {t('more.darkMode')}
          </label>
          <Switch
            id="menu-dark"
            checked={dark}
            onCheckedChange={(on) => setThemeChoice(on ? 'dark' : 'light')}
          />
        </div>
        <div className={cn(row, 'hover:bg-transparent')}>
          <span aria-hidden className={tile}>
            <Languages />
          </span>
          <span className="flex-1 font-medium">{t('more.language')}</span>
          <Segmented
            label={t('more.language')}
            value={locale}
            onChange={setLocale}
            options={[
              { value: 'bn', label: 'বাংলা' },
              { value: 'en', label: 'English' },
            ]}
            className="h-9 [&>button]:h-[30px] [&>button]:px-2.5 [&>button]:text-[13px]"
          />
        </div>
        {helpLink && (
          <a href={helpLink.href} target="_blank" rel="noopener noreferrer" className={row}>
            <span aria-hidden className={tile}>
              <CircleHelp />
            </span>
            <span className="flex-1 font-medium">{t('more.help')}</span>
            {chevron}
          </a>
        )}
      </Section>

      <Button
        variant="secondary"
        className="w-full text-danger hover:text-danger"
        onClick={() => setConfirming(true)}
      >
        <LogOut aria-hidden />
        {t('action.signOut')}
      </Button>

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('more.signOutTitle', { platform: 'managemind' })}
        description={t('more.signOutBody')}
        alert
      >
        <div className="flex flex-wrap-reverse justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={() => setConfirming(false)}>
            {t('action.cancel')}
          </Button>
          <Button variant="danger" size="lg" onClick={signOut}>
            {t('action.signOut')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

const group = 'overflow-hidden rounded-xl border border-border bg-background max-md:rounded-[12px]';

function Section({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h2
        id={id}
        className="px-1 pb-2 text-[13px] leading-[18px] font-medium text-muted-foreground"
      >
        {label}
      </h2>
      <div className={group}>{children}</div>
    </section>
  );
}

function Group({ group: g, extra }: { group: NavGroup; extra?: ReactNode }) {
  const { t } = useLocale();
  const nav = useNav();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const here = locate(nav.groups, path);
  const items = g.items.filter((item) => !IN_TABS.has(item.key));
  if (items.length === 0 && !extra) return null;
  return (
    <Section label={t(g.label)}>
      {items.map((item) =>
        item.children ? (
          <Area key={item.key} item={item} here={here} />
        ) : (
          <Link key={item.key} to={item.to} className={row}>
            <span aria-hidden className={tile}>
              <item.icon />
            </span>
            <span className="flex-1 font-medium">{t(item.label)}</span>
            {chevron}
          </Link>
        ),
      )}
      {extra}
    </Section>
  );
}

/** An area's row opens into its pages; the page you are on is marked. */
function Area({ item, here }: { item: NavItem; here: ReturnType<typeof locate> }) {
  const { t } = useLocale();
  const toConfirm = useToConfirm();
  const id = useId();
  const inside = here?.item.key === item.key;
  const [open, setOpen] = useState(inside);
  return (
    <div className={cn('border-b border-border last:border-b-0', open && 'pb-1.5')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className={cn(row, 'border-b-0')}
      >
        <span aria-hidden className={tile}>
          <item.icon />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{t(item.label)}</span>
          {item.summary && <span className={sub}>{t(item.summary)}</span>}
        </span>
        {item.toConfirm && !open && toConfirm > 0 && (
          <Badge
            count={toConfirm}
            className="h-5 min-w-5 rounded-full bg-danger-fill px-1.5 font-semibold text-white"
          />
        )}
        <ChevronRight
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-90',
          )}
        />
      </button>
      <ul id={id} hidden={!open}>
        {item.children?.map((leaf) => {
          const current = inside && here?.leaf?.to === leaf.to;
          return (
            <li key={leaf.to}>
              <Link
                to={leaf.to}
                aria-current={current ? 'page' : undefined}
                className="mx-2 flex min-h-11 items-center gap-2 rounded-lg pr-2 pl-12 hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium"
              >
                <span className="flex-1">{t(leaf.label)}</span>
                {leaf.toConfirm && toConfirm > 0 && (
                  <Badge
                    count={toConfirm}
                    className="h-5 min-w-5 rounded-full bg-danger-fill px-1.5 font-semibold text-white"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
