// The signed-in shell (phase-1-plan §7.3): a bottom navigation bar on phones,
// a sidebar from the md breakpoint, and the banners every page needs. It
// loads /me once; without a session it sends the user to sign in.
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { Home, type LucideIcon, Settings, Shield, User } from 'lucide-react';
import { LanguageSwitch } from '../components/language-switch';
import { type AdminKey, useLocale } from '../i18n';
import { ApiError, meQuery } from '../lib/api';
import { chooseStore } from '../lib/store';

export const Route = createFileRoute('/_shell')({
  beforeLoad: async ({ context, location }) => {
    try {
      const me = await context.queryClient.ensureQueryData(meQuery);
      await chooseStore(context.queryClient, me);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        throw redirect({
          to: '/sign-in',
          search: location.href === '/' ? {} : { redirect: location.href },
        });
      }
      throw e;
    }
  },
  component: Shell,
});

interface NavItem {
  to: '/' | '/settings' | '/account';
  label: AdminKey;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: '/', label: 'nav.home', icon: Home },
  { to: '/settings', label: 'nav.settings', icon: Settings },
  { to: '/account', label: 'nav.account', icon: User },
];

function Shell() {
  const { t } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  const store = me.stores.find((s) => s.tenantId === me.activeStore);
  const links = (className: string) =>
    NAV.map(({ to, label, icon: Icon }) => (
      <Link
        key={to}
        to={to}
        className={className}
        activeOptions={{ exact: to === '/' }}
        activeProps={{ 'aria-current': 'page', className: 'text-primary font-semibold' }}
      >
        <Icon aria-hidden className="size-5" />
        <span>{t(label)}</span>
      </Link>
    ));

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-border md:flex md:flex-col md:gap-1 md:p-3">
        <p className="px-3 py-4 font-semibold">{t('app.name', { platform: 'managemind' })}</p>
        <nav aria-label={t('nav.main')} className="flex flex-col gap-1">
          {links('flex min-h-11 items-center gap-3 rounded-md px-3 hover:bg-muted')}
          {me.user.platformRole && (
            <span className="flex min-h-11 items-center gap-3 px-3 text-muted-foreground">
              <Shield aria-hidden className="size-5" />
              {t('nav.platform')}
            </span>
          )}
        </nav>
      </aside>

      <div className="flex min-h-dvh flex-col pb-16 md:pb-0">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <p className="truncate font-medium">{store?.name ?? me.user.name}</p>
          <LanguageSwitch />
        </header>
        {store?.status === 'suspended' && (
          <p role="status" className="bg-warning px-4 py-2 text-sm text-warning-foreground">
            {t('banner.suspended', { store: store.name })}
          </p>
        )}
        {me.user.platformRole && !me.user.twoFactorEnabled && (
          <p
            role="status"
            className="flex flex-wrap items-center gap-x-3 bg-warning px-4 py-2 text-sm text-warning-foreground"
          >
            {t('banner.twoFactorRequired')}
            <Link to="/account" hash="two-factor" className="font-semibold underline">
              {t('action.setUpNow')}
            </Link>
          </p>
        )}
        {store && me.supportGrant && (
          <p role="status" className="bg-muted px-4 py-2 text-sm">
            {t('banner.support', { store: store.name, platform: 'managemind' })}
          </p>
        )}
        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 grid grid-cols-3 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {links('flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs')}
      </nav>
    </div>
  );
}
