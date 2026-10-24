// The admin's navigation (ADR 0029), one list for the desktop sidebar, the
// phone's tab bar and its More page, each item shown only to roles that can
// open it. Hiding is a convenience: the server checks every request.
import { formatNumber } from '@managemind/shared/i18n';
import type { Permission } from '@managemind/shared/permissions';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  BadgePercent,
  ChartLine,
  Home,
  type LucideIcon,
  Mail,
  Package,
  ReceiptText,
  RotateCcw,
  Settings2,
  Shield,
  ShoppingBag,
  Store,
  Users,
  Warehouse,
} from 'lucide-react';
import { type AdminKey, useLocale } from '../i18n';
import { healthQuery, meQuery } from '../lib/api';
import { dashboardQuery } from '../lib/orders';
import { cn } from '../lib/utils';

export type NavTo =
  | '/'
  | '/orders'
  | '/products'
  | '/customers'
  | '/promotions'
  | '/reports'
  | '/returns'
  | '/inventory'
  | '/online-store'
  | '/settings'
  | '/settings/billing'
  | '/platform'
  | '/dev/mailbox';

export interface NavItem {
  to: NavTo;
  label: AdminKey;
  icon: LucideIcon;
  /** Without it, everyone with the store open sees the item. */
  permission?: Permission;
}

const SELL: NavItem[] = [
  { to: '/', label: 'nav.home', icon: Home },
  { to: '/orders', label: 'nav.orders', icon: ShoppingBag, permission: 'orders.read' },
  { to: '/products', label: 'nav.products', icon: Package, permission: 'catalog.read' },
  { to: '/customers', label: 'nav.customers', icon: Users, permission: 'customers.read' },
  { to: '/promotions', label: 'nav.promotions', icon: BadgePercent, permission: 'promotions.read' },
  { to: '/reports', label: 'nav.reports', icon: ChartLine, permission: 'reports.read' },
];
const MORE_SELL: NavItem[] = [
  { to: '/returns', label: 'nav.returns', icon: RotateCcw, permission: 'orders.read' },
  { to: '/inventory', label: 'nav.inventory', icon: Warehouse, permission: 'inventory.read' },
];
const STORE: NavItem[] = [
  { to: '/online-store', label: 'nav.onlineStore', icon: Store, permission: 'settings.read' },
  { to: '/settings', label: 'nav.settings', icon: Settings2 },
];
const BILLING: NavItem = {
  to: '/settings/billing',
  label: 'billing.title',
  icon: ReceiptText,
  permission: 'billing.read',
};
const PLATFORM: NavItem = { to: '/platform', label: 'nav.platform', icon: Shield };
const MAILBOX: NavItem = { to: '/dev/mailbox', label: 'dev.mailbox', icon: Mail };
/** The phone's tab bar: the four most used pages, then More. */
const TABS: NavTo[] = ['/', '/orders', '/products', '/customers'];

export function useNav() {
  const { data: me } = useQuery(meQuery);
  const { data: health } = useQuery(healthQuery);
  const can = (item: NavItem) =>
    !item.permission || (me?.permissions.includes(item.permission) ?? false);
  const hasStore = Boolean(me?.activeStore);
  const store = hasStore ? (items: NavItem[]) => items.filter(can) : () => [];
  const sell = store(SELL);
  const platform = [
    ...(me?.user.platformRole ? [PLATFORM] : []),
    ...(health && health.environment !== 'production' ? [MAILBOX] : []),
  ];
  return {
    /** The sidebar's first group. */
    sell: sell.length ? sell : [SELL[0] as NavItem],
    /** The sidebar's "Store" group. */
    store: store(STORE),
    platform,
    /** The phone's tabs before More. */
    tabs: (sell.length ? sell : [SELL[0] as NavItem]).filter((i) => TABS.includes(i.to)),
    /** What the More page lists beyond the tabs. */
    more: {
      sell: [...sell.filter((i) => !TABS.includes(i.to)), ...store(MORE_SELL)],
      store: [...store(STORE), ...store([BILLING])],
      platform,
    },
  };
}

/** How many orders wait for confirmation, for the Orders badge. */
export function useToConfirm(): number {
  const { data: me } = useQuery(meQuery);
  const enabled = Boolean(me?.activeStore && me.permissions.includes('orders.read'));
  const { data } = useQuery({ ...dashboardQuery, enabled });
  return enabled ? (data?.counts.awaitingConfirmation ?? 0) : 0;
}

/** A sidebar link: icon, label and, for Orders, how many wait. */
export function SidebarLink({ item, badge }: { item: NavItem; badge?: number | undefined }) {
  const { t } = useLocale();
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      activeProps={{
        'aria-current': 'page',
        className:
          'bg-primary-soft font-semibold text-primary hover:bg-primary-soft hover:text-primary',
      }}
    >
      <Icon aria-hidden className="size-[18px] shrink-0" />
      <span className="flex-1 truncate">{t(item.label)}</span>
      {badge ? <Badge count={badge} /> : null}
    </Link>
  );
}

export function Badge({ count, className }: { count: number; className?: string }) {
  const { t, locale } = useLocale();
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-xs font-semibold tabular-nums text-warning-foreground',
        className,
      )}
    >
      <span aria-hidden>
        {count > 99 ? `${formatNumber(locale, 99)}+` : formatNumber(locale, count)}
      </span>
      <span className="sr-only">{t('nav.toConfirm', { count })}</span>
    </span>
  );
}
