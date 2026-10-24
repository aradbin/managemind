// More (ADR 0029): on phones, everything the five-tab bar leaves out. Who is
// signed in, the store switch, the pages beyond the tabs, help, and the
// account with light or dark and sign-out. Desktops reach the same through
// the sidebar and the header's menus, but the page works there too.
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, ExternalLink, LogOut, UserRound } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useSignOut } from '../../components/account-menu';
import { useHelpLinks } from '../../components/help-menu';
import { type NavItem, useNav } from '../../components/nav';
import { usePermission } from '../../components/permission-gate';
import { StoreSwitcher } from '../../components/store-switcher';
import { ThemeSwitch } from '../../components/theme-choice';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { useLocale } from '../../i18n';
import { meQuery } from '../../lib/api';
import { storeSettingsQuery } from '../../lib/catalog';

export const Route = createFileRoute('/_shell/more')({ component: MorePage });

const row = 'flex min-h-14 w-full items-center gap-3.5 px-3.5 text-left hover:bg-muted';
const tile = 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted';
const chevron = <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />;

function MorePage() {
  const { t } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  const nav = useNav();
  const store = me.stores.find((s) => s.tenantId === me.activeStore);
  const canViewStore = usePermission('settings.read');
  const settings = useQuery({ ...storeSettingsQuery, enabled: canViewStore });
  const { links: help } = useHelpLinks(true);
  const signOut = useSignOut();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('nav.more')}</h1>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
        <Link to="/account" className={`${row} min-h-[4.5rem]`}>
          <span
            aria-hidden
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
          >
            <UserRound className="size-6" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <span className="truncate font-semibold">{me.user.name}</span>
              {store && (
                <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                  {t(`role.${store.role}`)}
                </span>
              )}
            </span>
            <span className="truncate text-sm text-muted-foreground">{me.user.email}</span>
          </span>
          {chevron}
        </Link>
        {me.stores.length > 0 && <StoreSwitcher me={me} look="row" />}
        {settings.data && (
          <a href={settings.data.storeUrl} target="_blank" rel="noopener" className={row}>
            <span aria-hidden className={tile}>
              <ExternalLink className="size-4" />
            </span>
            <span className="flex-1">{t('store.view')}</span>
            <span className="text-xs text-muted-foreground">{t('more.newTab')}</span>
          </a>
        )}
      </div>

      <Group label={t('nav.sell')} items={nav.more.sell} />
      <Group label={t('nav.store')} items={nav.more.store} />
      <Group label={t('nav.platform')} items={nav.more.platform} />

      {help.length > 0 && (
        <Section label={t('more.help')}>
          {help.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className={row}
            >
              <span className="flex-1">{t(l.label)}</span>
              <ExternalLink aria-hidden className="size-4 text-muted-foreground" />
            </a>
          ))}
        </Section>
      )}

      <Section label={t('nav.account')}>
        <Link to="/account" className={row}>
          <span aria-hidden className={tile}>
            <UserRound className="size-4" />
          </span>
          <span className="flex-1">{t('account.title')}</span>
          {chevron}
        </Link>
        <ThemeSwitch />
        <button
          type="button"
          className={`${row} font-medium text-danger`}
          onClick={() => setConfirming(true)}
        >
          <span aria-hidden className={`${tile} bg-danger-soft`}>
            <LogOut className="size-4" />
          </span>
          <span className="flex-1">{t('action.signOut')}</span>
        </button>
      </Section>

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('more.signOutTitle', { platform: 'managemind' })}
        description={t('more.signOutBody')}
      >
        <div className="flex flex-col gap-2 md:flex-row-reverse">
          <Button variant="danger" className="min-h-12" onClick={signOut}>
            {t('action.signOut')}
          </Button>
          <Button variant="secondary" className="min-h-12" onClick={() => setConfirming(false)}>
            {t('action.cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2
        id={id}
        className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
        {children}
      </div>
    </section>
  );
}

function Group({ label, items }: { label: string; items: NavItem[] }) {
  const { t } = useLocale();
  if (items.length === 0) return null;
  return (
    <Section label={label}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.to} to={item.to} className={row}>
            <span aria-hidden className={tile}>
              <Icon className="size-4" />
            </span>
            <span className="flex-1">{t(item.label)}</span>
            {chevron}
          </Link>
        );
      })}
    </Section>
  );
}
