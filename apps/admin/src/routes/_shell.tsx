// The signed-in shell (phase-1-plan §7.3): a bottom navigation bar on phones,
// a sidebar from the md breakpoint, and the banners every page needs. It
// loads /me once; without a session it sends the user to sign in.
import { formatDateTime } from '@managemind/shared/i18n';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { Home, type LucideIcon, Mail, Settings, Shield, User } from 'lucide-react';
import { useState } from 'react';
import { AccountMenu } from '../components/account-menu';
import { LanguageSwitch } from '../components/language-switch';
import { StoreSwitcher } from '../components/store-switcher';
import { useToast } from '../components/toast';
import { type AdminKey, useLocale } from '../i18n';
import { ApiError, api, healthQuery, meQuery, unwrap } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { chooseStore, refreshAccess } from '../lib/store';

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
  to: '/' | '/settings' | '/account' | '/platform' | '/dev/mailbox';
  label: AdminKey;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: '/', label: 'nav.home', icon: Home },
  { to: '/settings', label: 'nav.settings', icon: Settings },
  { to: '/account', label: 'nav.account', icon: User },
];
const PLATFORM: NavItem = { to: '/platform', label: 'nav.platform', icon: Shield };
const MAILBOX: NavItem = { to: '/dev/mailbox', label: 'dev.mailbox', icon: Mail };

function Shell() {
  const { t, locale } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: health } = useQuery(healthQuery);
  const store = me.stores.find((s) => s.tenantId === me.activeStore);
  const nav = me.user.platformRole ? [...NAV, PLATFORM] : NAV;
  const links = (items: NavItem[], className: string) =>
    items.map(({ to, label, icon: Icon }) => (
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
          {links(
            health && health.environment !== 'production' ? [...nav, MAILBOX] : nav,
            'flex min-h-11 items-center gap-3 rounded-md px-3 hover:bg-muted',
          )}
        </nav>
      </aside>

      <div className="flex min-h-dvh flex-col pb-16 md:pb-0">
        <header className="flex items-center justify-between gap-2 border-b border-border px-2 py-2 md:px-4">
          <StoreSwitcher me={me} />
          <div className="flex shrink-0 items-center">
            <LanguageSwitch />
            <AccountMenu me={me} />
          </div>
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
        {store?.supportUntil && me.supportGrantId && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted px-4 py-2 text-sm"
          >
            {t('banner.support', {
              store: store.name,
              platform: 'managemind',
              time: formatDateTime(locale, new Date(store.supportUntil), { timeStyle: 'short' }),
            })}
            <EndSupport grantId={me.supportGrantId} />
          </div>
        )}
        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label={t('nav.main')}
        className={`fixed inset-x-0 bottom-0 grid ${nav.length > 3 ? 'grid-cols-4' : 'grid-cols-3'} border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden`}
      >
        {links(nav, 'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs')}
      </nav>
    </div>
  );
}

/** Ends support access early: back to the platform area, store access gone. */
function EndSupport({ grantId }: { grantId: string }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  async function end() {
    setBusy(true);
    try {
      unwrap(
        await api.DELETE('/v1/platform/support-access/{id}', { params: { path: { id: grantId } } }),
      );
      await refreshAccess(queryClient);
      toast(t('support.ended'));
      await navigate({ to: '/platform', replace: true });
    } catch (e) {
      toast(errorMessage(e, t));
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={end}
      className="min-h-11 font-semibold underline"
    >
      {t('support.end')}
    </button>
  );
}
