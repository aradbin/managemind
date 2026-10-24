// The signed-in shell (phase-1-plan §7.3, redesigned in ADR 0029): a grouped
// sidebar from the md breakpoint, a five-tab bar on phones with the rest on
// the More page, search from the top bar or Ctrl+K, and the banners every page
// needs. It loads /me once; without a session it sends the user to sign in.
import { formatDateTime } from '@managemind/shared/i18n';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { ExternalLink, LayoutGrid, Search } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useId, useState } from 'react';
import { AccountMenu } from '../components/account-menu';
import { HelpMenu } from '../components/help-menu';
import { LanguageSwitch } from '../components/language-switch';
import { Badge, type NavItem, SidebarLink, useNav, useToConfirm } from '../components/nav';
import { usePermission } from '../components/permission-gate';
import { SearchDialog } from '../components/search-dialog';
import { StoreSwitcher } from '../components/store-switcher';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import { ApiError, api, meQuery, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { chooseStore, refreshAccess } from '../lib/store';

// Only owners are asked to accept the platform terms (phase-5b-plan §3.4).
const TermsPrompt = lazy(() => import('../components/terms-prompt'));

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

function Shell() {
  const { t, locale } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  const store = me.stores.find((s) => s.tenantId === me.activeStore);
  const nav = useNav();
  const toConfirm = useToConfirm();
  const [searching, setSearching] = useState(false);

  // Ctrl+K (⌘K on Apple devices) opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col md:gap-5 md:overflow-y-auto md:border-r md:border-border md:bg-background md:p-3">
        <p className="flex items-center gap-2.5 px-2 pt-1 font-semibold">
          <span
            aria-hidden
            className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground"
          >
            m
          </span>
          {t('app.name', { platform: 'managemind' })}
        </p>
        {me.stores.length > 0 && <StoreSwitcher me={me} look="sidebar" />}
        <nav aria-label={t('nav.main')} className="flex flex-col gap-5">
          <ul className="flex flex-col gap-0.5">
            {nav.sell.map((item) => (
              <li key={item.to}>
                <SidebarLink item={item} badge={item.to === '/orders' ? toConfirm : undefined} />
              </li>
            ))}
          </ul>
          {nav.store.length > 0 && (
            <NavGroup label={t('nav.store')}>
              {nav.store.map((item) => (
                <li key={item.to}>
                  <SidebarLink item={item} />
                </li>
              ))}
            </NavGroup>
          )}
          {nav.platform.length > 0 && (
            <NavGroup label={t('nav.platform')}>
              {nav.platform.map((item) => (
                <li key={item.to}>
                  <SidebarLink item={item} />
                </li>
              ))}
            </NavGroup>
          )}
        </nav>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-1 border-b border-border bg-background px-2 md:gap-2 md:px-6">
          <div className="min-w-0 flex-1 md:hidden">
            <StoreSwitcher me={me} />
          </div>
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="hidden h-10 w-full max-w-md items-center gap-2.5 rounded-lg border border-input bg-canvas px-3 text-sm text-muted-foreground hover:border-muted-foreground md:flex"
          >
            <Search aria-hidden className="size-4" />
            <span className="flex-1 truncate text-left">{t('search.placeholder')}</span>
            <kbd className="rounded border border-input bg-background px-1.5 py-0.5 font-sans text-[11px] font-medium">
              {shortcut()}
            </kbd>
          </button>
          <div className="flex shrink-0 items-center md:ml-auto">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={t('search.open')}
              onClick={() => setSearching(true)}
            >
              <Search aria-hidden className="size-5" />
            </Button>
            <div className="hidden md:flex">
              <ViewStore />
            </div>
            <LanguageSwitch />
            <div className="hidden md:flex">
              <HelpMenu />
              <AccountMenu me={me} />
            </div>
          </div>
        </header>
        <SearchDialog open={searching} onOpenChange={setSearching} />
        {store?.status === 'suspended' && (
          <p role="status" className="bg-warning px-4 py-2 text-sm text-warning-foreground md:px-6">
            {t('banner.suspended', { store: store.name })}
          </p>
        )}
        {me.user.platformRole && !me.user.twoFactorEnabled && (
          <p
            role="status"
            className="flex flex-wrap items-center gap-x-3 bg-warning px-4 py-2 text-sm text-warning-foreground md:px-6"
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
            className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted px-4 py-2 text-sm md:px-6"
          >
            {t('banner.support', {
              store: store.name,
              platform: 'managemind',
              time: formatDateTime(locale, new Date(store.supportUntil), { timeStyle: 'short' }),
            })}
            <EndSupport grantId={me.supportGrantId} />
          </div>
        )}
        {store?.role === 'owner' && !me.supportGrantId && (
          <Suspense fallback={null}>
            <TermsPrompt />
          </Suspense>
        )}
        <main className="flex-1 px-4 py-5 md:px-6 md:py-7">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background px-1 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] md:hidden"
      >
        {nav.tabs.map((item) => (
          <Tab key={item.to} item={item} badge={item.to === '/orders' ? toConfirm : 0} />
        ))}
        <Tab item={{ to: '/more', label: 'nav.more', icon: LayoutGrid }} badge={0} />
      </nav>
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="px-3 text-xs font-medium text-muted-foreground">
        {label}
      </h2>
      <ul aria-labelledby={id} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </div>
  );
}

/** A tab in the phone's bar: the icon in a pill when it's the current page. */
function Tab({
  item,
  badge,
}: {
  item: Omit<NavItem, 'to'> & { to: NavItem['to'] | '/more' };
  badge: number;
}) {
  const { t } = useLocale();
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      className="group flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground"
      activeProps={{ 'aria-current': 'page', className: 'font-semibold text-primary' }}
    >
      <span className="relative flex h-7 w-13 items-center justify-center rounded-full group-aria-[current=page]:bg-primary-soft">
        <Icon aria-hidden className="size-5" />
        {badge > 0 && (
          <Badge
            count={badge}
            className="absolute -top-1.5 right-0.5 h-4 min-w-4 bg-danger px-1 text-[10px] text-danger-foreground"
          />
        )}
      </span>
      <span className="max-w-full truncate px-0.5">{t(item.label)}</span>
    </Link>
  );
}

function shortcut(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? '⌘K'
    : 'Ctrl K';
}

/** Opens the store on its primary address in a new tab (phase-3-plan §7); on phones it is on the More page. */
function ViewStore() {
  const { t } = useLocale();
  const allowed = usePermission('settings.read');
  const store = useQuery({ ...storeSettingsQuery, enabled: allowed });
  if (!store.data) return null;
  return (
    <a
      href={store.data.storeUrl}
      target="_blank"
      rel="noopener"
      className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-muted"
    >
      <ExternalLink aria-hidden className="size-4" />
      {t('store.view')}
    </a>
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
