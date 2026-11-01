// The admin's navigation (ADR 0029, ADR 0033): one tree for the desktop
// sidebar, the header's breadcrumb, the phone's tab bar and its Menu page.
// Areas with several pages (orders, catalog, inventory, reports, online
// store, platform) open into their pages, so no page needs section tabs.
// Each item shows only to roles that can open it. Hiding is a convenience:
// the server checks every request.
import { formatNumber } from '@managemind/shared/i18n';
import type { Permission } from '@managemind/shared/permissions';
import { useQuery } from '@tanstack/react-query';
import {
  BadgePercent,
  ChartLine,
  Home,
  type LucideIcon,
  Mail,
  Package,
  Settings2,
  Shield,
  ShoppingBag,
  Store,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';
import { type AdminKey, useLocale } from '../i18n';
import { healthQuery, meQuery } from '../lib/api';
import { dashboardQuery } from '../lib/orders';
import { cn } from '../lib/utils';

export type NavTo =
  | '/'
  | '/orders'
  | '/orders/confirm'
  | '/orders/incomplete'
  | '/orders/courier-returns'
  | '/returns'
  | '/products'
  | '/catalog/categories'
  | '/catalog/collections'
  | '/catalog/attributes'
  | '/catalog/import'
  | '/inventory'
  | '/inventory/purchase-orders'
  | '/inventory/receive'
  | '/inventory/suppliers'
  | '/inventory/counts'
  | '/inventory/adjustments'
  | '/customers'
  | '/promotions'
  | '/expenses'
  | '/reports'
  | '/reports/sales'
  | '/reports/profit'
  | '/reports/stock'
  | '/reports/suppliers'
  | '/reports/expenses'
  | '/reports/cod-outstanding'
  | '/online-store'
  | '/online-store/theme'
  | '/online-store/pages'
  | '/online-store/settings'
  | '/settings'
  | '/platform'
  | '/platform/dashboard'
  | '/platform/billing'
  | '/platform/courier-areas'
  | '/platform/terms'
  | '/platform/staff'
  | '/platform/audit'
  | '/dev/mailbox';

/** A page in an area. */
export interface NavLeaf {
  to: NavTo;
  label: AdminKey;
  /** Without it, everyone who can see the area sees the page. */
  permission?: Permission;
  superAdmin?: boolean;
  /** Shows how many orders wait for confirmation. */
  toConfirm?: boolean;
}

/** A sidebar entry: a page, or an area that opens into its pages. */
export interface NavItem {
  key: string;
  to: NavTo;
  label: AdminKey;
  icon: LucideIcon;
  permission?: Permission;
  children?: NavLeaf[];
  /** An area's own overview page, which the sidebar doesn't list. */
  overview?: NavTo;
  toConfirm?: boolean;
}

const SELL: NavItem[] = [
  { key: 'home', to: '/', label: 'nav.home', icon: Home },
  {
    key: 'orders',
    to: '/orders',
    label: 'nav.orders',
    icon: ShoppingBag,
    permission: 'orders.read',
    toConfirm: true,
    children: [
      { to: '/orders', label: 'nav.allOrders' },
      { to: '/orders/confirm', label: 'nav.confirmOrders', toConfirm: true },
      { to: '/orders/incomplete', label: 'nav.incomplete' },
      { to: '/orders/courier-returns', label: 'nav.courierReturns' },
      { to: '/returns', label: 'nav.returns' },
    ],
  },
  {
    key: 'catalog',
    to: '/products',
    label: 'nav.catalog',
    icon: Package,
    permission: 'catalog.read',
    children: [
      { to: '/products', label: 'catalog.products' },
      { to: '/catalog/categories', label: 'catalog.categories' },
      { to: '/catalog/collections', label: 'catalog.collections' },
      { to: '/catalog/attributes', label: 'catalog.attributes' },
      { to: '/catalog/import', label: 'catalog.import', permission: 'catalog.write' },
    ],
  },
  {
    key: 'inventory',
    to: '/inventory',
    label: 'nav.inventory',
    icon: Warehouse,
    permission: 'inventory.read',
    children: [
      { to: '/inventory', label: 'nav.stock' },
      {
        to: '/inventory/purchase-orders',
        label: 'nav.purchaseOrders',
        permission: 'purchasing.read',
      },
      { to: '/inventory/receive', label: 'nav.receiveStock', permission: 'inventory.write' },
      {
        to: '/inventory/suppliers',
        label: 'nav.suppliers',
        permission: 'purchasing.read',
      },
      { to: '/inventory/counts', label: 'nav.stockCounts' },
      { to: '/inventory/adjustments', label: 'nav.adjustments' },
    ],
  },
  {
    key: 'customers',
    to: '/customers',
    label: 'nav.customers',
    icon: Users,
    permission: 'customers.read',
  },
  {
    key: 'promotions',
    to: '/promotions',
    label: 'nav.promotions',
    icon: BadgePercent,
    permission: 'promotions.read',
  },
  {
    key: 'expenses',
    to: '/expenses',
    label: 'nav.expenses',
    icon: Wallet,
    permission: 'expenses.read',
  },
  {
    key: 'reports',
    to: '/reports',
    label: 'nav.reports',
    icon: ChartLine,
    permission: 'reports.read',
    children: [
      { to: '/reports', label: 'nav.overview' },
      { to: '/reports/sales', label: 'nav.reportSales' },
      { to: '/reports/profit', label: 'nav.reportProfit', permission: 'catalog.cost' },
      { to: '/reports/stock', label: 'nav.reportStock' },
      { to: '/reports/suppliers', label: 'nav.reportSuppliers', permission: 'purchasing.pay' },
      { to: '/reports/expenses', label: 'nav.reportExpenses', permission: 'expenses.read' },
      { to: '/reports/cod-outstanding', label: 'nav.reportCod' },
    ],
  },
];

const STORE: NavItem[] = [
  {
    key: 'online-store',
    to: '/online-store',
    overview: '/online-store',
    label: 'nav.onlineStore',
    icon: Store,
    permission: 'settings.read',
    children: [
      { to: '/online-store/theme', label: 'nav.theme' },
      { to: '/online-store/pages', label: 'nav.pages' },
      { to: '/online-store/settings', label: 'nav.storeSettings' },
    ],
  },
  // Billing lives in Settings.
  { key: 'settings', to: '/settings', label: 'nav.settings', icon: Settings2 },
];

const PLATFORM: NavItem = {
  key: 'platform',
  to: '/platform',
  label: 'nav.platform',
  icon: Shield,
  children: [
    { to: '/platform', label: 'platform.tenants' },
    { to: '/platform/dashboard', label: 'platform.dashboard' },
    { to: '/platform/billing', label: 'platform.billing' },
    { to: '/platform/courier-areas', label: 'platform.courierAreas' },
    { to: '/platform/terms', label: 'platform.terms' },
    { to: '/platform/staff', label: 'platform.staff', superAdmin: true },
    { to: '/platform/audit', label: 'platform.audit', superAdmin: true },
  ],
};
const MAILBOX: NavItem = { key: 'mailbox', to: '/dev/mailbox', label: 'dev.mailbox', icon: Mail };

/** The phone's tab bar: the four most used pages, then Menu. */
const TABS: { to: NavTo; label: AdminKey; icon: LucideIcon; permission?: Permission }[] = [
  { to: '/', label: 'nav.home', icon: Home },
  { to: '/orders', label: 'nav.orders', icon: ShoppingBag, permission: 'orders.read' },
  { to: '/products', label: 'nav.products', icon: Package, permission: 'catalog.read' },
  { to: '/customers', label: 'nav.customers', icon: Users, permission: 'customers.read' },
];

export interface NavGroup {
  key: 'sell' | 'store' | 'platform';
  label: AdminKey;
  items: NavItem[];
}

export function useNav() {
  const { data: me } = useQuery(meQuery);
  const { data: health } = useQuery(healthQuery);
  const has = (p: Permission | undefined) => !p || (me?.permissions.includes(p) ?? false);
  const superAdmin = me?.user.platformRole === 'super_admin';
  const hasStore = Boolean(me?.activeStore);

  /** Drops what this person can't open; an area keeps the pages they can. */
  const visible = (items: NavItem[]): NavItem[] =>
    items.flatMap((item) => {
      if (!has(item.permission)) return [];
      if (!item.children) return [item];
      const children = item.children.filter(
        (c) => has(c.permission) && (!c.superAdmin || superAdmin),
      );
      const first = children[0];
      return first ? [{ ...item, to: first.to, children }] : [];
    });

  const sell = hasStore ? visible(SELL) : [];
  const groups: NavGroup[] = [
    { key: 'sell', label: 'nav.sell', items: sell.length ? sell : [SELL[0] as NavItem] },
    { key: 'store', label: 'nav.store', items: hasStore ? visible(STORE) : [] },
    {
      key: 'platform',
      label: 'nav.platform',
      items: [
        ...(me?.user.platformRole ? visible([PLATFORM]) : []),
        ...(health && health.environment !== 'production' ? [MAILBOX] : []),
      ],
    },
  ];
  return {
    groups: groups.filter((g) => g.items.length > 0),
    /** The phone's tabs before Menu. */
    tabs: TABS.filter((tab) => tab.to === '/' || (hasStore && has(tab.permission))),
  };
}

/** Whether `path` is `to` or a page under it. Home matches only itself. */
export function isUnder(path: string, to: string): boolean {
  if (to === '/') return path === '/';
  return path === to || path.startsWith(`${to}/`);
}

/**
 * Where a path sits: the sidebar entry and, in an area, the page whose
 * address matches the most of it (so /reports/cod-outstanding is not Overview).
 */
export function locate(
  groups: NavGroup[],
  path: string,
): { item: NavItem; leaf?: NavLeaf | undefined } | undefined {
  let best: { item: NavItem; leaf?: NavLeaf; length: number } | undefined;
  for (const group of groups) {
    for (const item of group.items) {
      const targets = item.children ?? [{ to: item.to, label: item.label }];
      for (const leaf of targets) {
        if (!isUnder(path, leaf.to)) continue;
        if (!best || leaf.to.length > best.length) {
          best = { item, ...(item.children ? { leaf } : {}), length: leaf.to.length };
        }
      }
      // The area's overview: the area itself, with none of its pages current.
      if (!best && item.overview === path) best = { item, length: path.length };
    }
  }
  return best && { item: best.item, leaf: best.leaf };
}

/** How many orders wait for confirmation, for the Orders badge. */
export function useToConfirm(): number {
  const { data: me } = useQuery(meQuery);
  const enabled = Boolean(me?.activeStore && me.permissions.includes('orders.read'));
  const { data } = useQuery({ ...dashboardQuery, enabled });
  return enabled ? (data?.counts.awaitingConfirmation ?? 0) : 0;
}

/** A small count, as in the sidebar beside Orders. */
export function Badge({ count, className }: { count: number; className?: string }) {
  const { t, locale } = useLocale();
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums',
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
