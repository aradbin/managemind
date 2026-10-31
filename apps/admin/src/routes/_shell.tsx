// The signed-in shell (phase-1-plan §7.3; ADR 0029, redrawn in ADR 0033): from
// the md breakpoint a sidebar whose areas open into their pages, beside a
// white inset panel whose header shows where you are and holds search, Create,
// View store, language, theme, help and the account. On phones, a five-tab bar
// whose Menu tab lists the rest. Search opens from the header or Ctrl+K. It
// loads /me once; without a session it sends the user to sign in.
import { formatDateTime } from '@managemind/shared/i18n';
import type { Permission } from '@managemind/shared/permissions';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import {
  ChevronRight,
  ExternalLink,
  type LucideIcon,
  Menu as MenuIcon,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Sun,
} from 'lucide-react';
import { Fragment, lazy, Suspense, useEffect, useId, useState } from 'react';
import { AccountMenu } from '../components/account-menu';
import { HelpMenu } from '../components/help-menu';
import { LanguageSwitch } from '../components/language-switch';
import {
  Badge,
  locate,
  type NavGroup,
  type NavItem,
  type NavTo,
  useNav,
  useToConfirm,
} from '../components/nav';
import { usePermission } from '../components/permission-gate';
import { SearchDialog } from '../components/search-dialog';
import { StoreSwitcher } from '../components/store-switcher';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { menuContent, menuItem, menuSeparator } from '../components/ui/menu';
import { type AdminKey, useLocale } from '../i18n';
import { ApiError, api, type Me, meQuery, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { chooseStore, refreshAccess } from '../lib/store';
import { setThemeChoice, useThemeChoice } from '../lib/theme';
import { cn } from '../lib/utils';

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

const SIDEBAR_KEY = 'mm.sidebar';

function Shell() {
  const { t, locale } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  const store = me.stores.find((s) => s.tenantId === me.activeStore);
  const nav = useNav();
  const toConfirm = useToConfirm();
  const [searching, setSearching] = useState(false);
  const [sidebar, setSidebar] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== 'hidden';
    } catch {
      return true;
    }
  });
  const toggleSidebar = () => {
    setSidebar((shown) => {
      try {
        if (shown) localStorage.setItem(SIDEBAR_KEY, 'hidden');
        else localStorage.removeItem(SIDEBAR_KEY);
      } catch {
        // Not remembered on this device.
      }
      return !shown;
    });
  };

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
      {sidebar && <Sidebar me={me} groups={nav.groups} toConfirm={toConfirm} />}

      <div
        className={cn(
          'flex min-h-dvh min-w-0 flex-1 flex-col bg-canvas pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:m-2 md:min-h-[calc(100dvh-1rem)] md:rounded-xl md:pb-0 md:shadow-sm',
          sidebar && 'md:ml-0',
        )}
      >
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-canvas/95 px-3 backdrop-blur md:h-12 md:rounded-t-xl md:px-4">
          <div className="hidden min-w-0 items-center md:flex">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 size-7 md:size-7"
              aria-label={t('nav.toggleSidebar')}
              aria-expanded={sidebar}
              title={t('nav.toggleSidebar')}
              onClick={toggleSidebar}
            >
              <PanelLeft aria-hidden />
            </Button>
            <span aria-hidden className="mx-2 h-4 w-px bg-border" />
            <HeaderBreadcrumb groups={nav.groups} />
          </div>
          <div className="min-w-0 flex-1 md:hidden">
            <StoreSwitcher me={me} />
          </div>
          <div className="flex shrink-0 items-center gap-2 md:ml-auto">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setSearching(true)}
              className="hidden h-8 w-64 items-center gap-2 rounded-lg border border-input bg-background pr-1.5 pl-2.5 text-sm text-muted-foreground shadow-xs hover:bg-muted lg:flex dark:bg-white/5"
            >
              <Search aria-hidden className="size-4" />
              <span className="flex-1 truncate text-left">{t('search.placeholder')}</span>
              <kbd className="inline-flex h-5 items-center rounded-md bg-muted px-1 font-sans text-xs font-medium">
                {shortcut()}
              </kbd>
            </button>
            <Button
              variant="secondary"
              size="icon"
              className="lg:hidden"
              aria-label={t('search.open')}
              aria-haspopup="dialog"
              title={t('search.open')}
              onClick={() => setSearching(true)}
            >
              <Search aria-hidden />
            </Button>
            <CreateMenu />
            <div className="hidden md:flex">
              <ViewStore />
            </div>
            <LanguageSwitch icon />
            <div className="hidden items-center gap-2 md:flex">
              <ThemeToggle />
              <HelpMenu />
              <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
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
        <main className="flex-1 px-3 py-4 md:px-6 md:py-6">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-canvas px-1 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] md:hidden"
      >
        {nav.tabs.map((item) => (
          <Tab key={item.to} item={item} badge={item.to === '/orders' ? toConfirm : 0} />
        ))}
        <Tab item={{ to: '/more', label: 'nav.menu', icon: MenuIcon }} badge={0} />
      </nav>
    </div>
  );
}

/** The desktop sidebar (ADR 0033): the store, then each group's pages. */
function Sidebar({ me, groups, toConfirm }: { me: Me; groups: NavGroup[]; toConfirm: number }) {
  const { t } = useLocale();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const here = locate(groups, path);
  return (
    <aside
      aria-label={t('nav.sidebar')}
      className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:gap-2 md:p-2"
    >
      <div className="pt-2">
        {me.stores.length > 0 ? (
          <StoreSwitcher me={me} look="sidebar" />
        ) : (
          <p className="flex min-h-12 items-center gap-2 p-2 text-sm font-semibold">
            <span
              aria-hidden
              className="inline-flex size-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground"
            >
              m
            </span>
            {t('app.name', { platform: 'managemind' })}
          </p>
        )}
      </div>
      <nav
        aria-label={t('nav.main')}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto [scrollbar-width:thin]"
      >
        {groups.map((group) => (
          <SidebarGroup
            key={group.key}
            group={group}
            labelled={group.key !== 'sell'}
            here={here}
            toConfirm={toConfirm}
          />
        ))}
      </nav>
    </aside>
  );
}

function SidebarGroup({
  group,
  labelled,
  here,
  toConfirm,
}: {
  group: NavGroup;
  labelled: boolean;
  here: ReturnType<typeof locate>;
  toConfirm: number;
}) {
  const { t } = useLocale();
  const id = useId();
  return (
    <div className="flex flex-col">
      {labelled && (
        <h2
          id={id}
          className="flex h-8 items-center px-2 text-xs font-medium text-muted-foreground"
        >
          {t(group.label)}
        </h2>
      )}
      <ul {...(labelled ? { 'aria-labelledby': id } : {})} className="flex flex-col gap-1">
        {group.items.map((item) => (
          <li key={item.key}>
            {item.children ? (
              <SidebarArea item={item} here={here} toConfirm={toConfirm} />
            ) : (
              <Link
                to={item.to}
                aria-current={here?.item.key === item.key ? 'page' : undefined}
                className={cn(navRow, here?.item.key === item.key && navActive)}
              >
                <item.icon aria-hidden className="size-4 shrink-0" />
                <span className="flex-1 truncate">{t(item.label)}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const navRow =
  'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-muted';
const navActive = 'bg-muted font-medium';

/** An area: opens into its pages, and is open while one of them is shown. */
function SidebarArea({
  item,
  here,
  toConfirm,
}: {
  item: NavItem;
  here: ReturnType<typeof locate>;
  toConfirm: number;
}) {
  const { t } = useLocale();
  const id = useId();
  // Open while one of its pages is shown (not on its overview, which links to them).
  const inside = here?.item.key === item.key && here.leaf !== undefined;
  const [chosen, setChosen] = useState<boolean>();
  // Opening another area's page opens that area; this one keeps the reader's choice.
  useEffect(() => {
    if (inside) setChosen(undefined);
  }, [inside]);
  const open = chosen ?? inside;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setChosen(!open)}
        className={navRow}
      >
        <item.icon aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 truncate">{t(item.label)}</span>
        {item.toConfirm && !open && toConfirm > 0 && <Badge count={toConfirm} />}
        <ChevronRight
          aria-hidden
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')}
        />
      </button>
      <ul
        id={id}
        hidden={!open}
        className="mx-3.5 flex flex-col gap-1 border-l border-border py-0.5 pl-2.5"
      >
        {item.children?.map((leaf) => {
          const current = inside && here?.leaf?.to === leaf.to;
          return (
            <li key={leaf.to}>
              <Link
                to={leaf.to}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex h-7 items-center gap-2 rounded-lg px-2 text-sm hover:bg-muted',
                  current && navActive,
                )}
              >
                <span className="flex-1 truncate">{t(leaf.label)}</span>
                {leaf.toConfirm && toConfirm > 0 && <Badge count={toConfirm} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** "Area › Page" in the header (ADR 0033), from where the sidebar is. */
function HeaderBreadcrumb({ groups }: { groups: NavGroup[] }) {
  const { t } = useLocale();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const here = locate(groups, path);
  if (!here) return null;
  const { item, leaf } = here;
  const page = leaf ?? item;
  // A record under a page (an order, a product) links back to its list.
  const deeper = path !== page.to && path !== item.overview;
  const crumbs: { label: string; to?: NavTo }[] = [
    ...(leaf ? [{ label: t(item.label), to: item.to }] : []),
    { label: t(page.label), ...(deeper ? { to: page.to } : {}) },
  ];
  return (
    <nav aria-label={t('nav.breadcrumb')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        {crumbs.map((c, i) => (
          <li key={c.label} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0" />}
            {c.to ? (
              <Link to={c.to} className="truncate hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate text-foreground">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The header's + menu: start the records people make most (ADR 0033). */
function CreateMenu() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { data: me } = useQuery(meQuery);
  const has = (p: Permission) => Boolean(me?.activeStore && me.permissions.includes(p));
  const groups = [
    [
      ...(has('orders.write')
        ? [{ to: '/orders/new' as const, label: 'create.order' as const }]
        : []),
      ...(has('promotions.write')
        ? [{ to: '/promotions/new' as const, label: 'create.promotion' as const }]
        : []),
    ],
    has('catalog.write')
      ? [{ to: '/products/new' as const, label: 'create.product' as const }]
      : [],
    has('purchasing.write')
      ? [{ to: '/inventory/purchase-orders/new' as const, label: 'create.purchaseOrder' as const }]
      : [],
  ].filter((g) => g.length > 0);
  if (groups.length === 0) return null;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="secondary"
          size="icon"
          aria-label={t('create.menu')}
          title={t('create.menu')}
        >
          <Plus aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className={menuContent}>
          {groups.map((g, i) => (
            <Fragment key={g[0]?.to}>
              {i > 0 && <Menu.Separator className={menuSeparator} />}
              {g.map((entry) => (
                <Menu.Item
                  key={entry.to}
                  className={menuItem}
                  onSelect={() => navigate({ to: entry.to })}
                >
                  {t(entry.label)}
                </Menu.Item>
              ))}
            </Fragment>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Light or dark in one press; the account menu also offers the device's setting. */
function ThemeToggle() {
  const { t } = useLocale();
  const choice = useThemeChoice();
  const dark =
    choice === 'dark' ||
    (choice === 'system' &&
      typeof document !== 'undefined' &&
      document.documentElement.dataset.theme === 'dark');
  const label = t(dark ? 'appearance.toLight' : 'appearance.toDark');
  return (
    <Button
      variant="secondary"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setThemeChoice(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}

/** A tab in the phone's bar: the icon in a pill when it's the current page. */
function Tab({
  item,
  badge,
}: {
  item: { to: NavTo | '/more'; label: AdminKey; icon: LucideIcon };
  badge: number;
}) {
  const { t } = useLocale();
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      className="group flex min-h-13 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground"
      activeProps={{ 'aria-current': 'page', className: 'text-foreground' }}
    >
      <span className="relative flex h-7 w-12 items-center justify-center rounded-full group-aria-[current=page]:bg-muted">
        <Icon aria-hidden className="size-4 accent-primary" />
        {badge > 0 && (
          <Badge
            count={badge}
            className="absolute -top-1 right-1 h-4 min-w-4 rounded-full bg-danger px-1 text-[10px] text-danger-foreground"
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
    <Button variant="secondary" size="icon" asChild>
      <a
        href={store.data.storeUrl}
        target="_blank"
        rel="noopener"
        aria-label={t('store.viewNewTab')}
        title={t('store.view')}
      >
        <ExternalLink aria-hidden />
      </a>
    </Button>
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
    <button type="button" disabled={busy} onClick={end} className="font-semibold underline">
      {t('support.end')}
    </button>
  );
}
