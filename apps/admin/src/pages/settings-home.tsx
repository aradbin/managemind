// Settings (phase-1-plan §7.3, redesigned in ADR 0029): every settings page
// as a card, grouped by what it is about, with a filter, and a status line
// where the setup checklist knows whether the page is done.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Bell,
  CreditCard,
  Globe,
  Megaphone,
  Package,
  Percent,
  PhoneCall,
  Receipt,
  RotateCcw,
  Search,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import { useState } from 'react';
import { usePermission } from '../components/permission-gate';
import { setupQuery } from '../components/setup-card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/launch';
import { cn } from '../lib/utils';

const GROUPS = [
  {
    label: 'nav.store',
    paths: ['/settings/store', '/settings/domains', '/settings/staff', '/settings/location'],
  },
  {
    label: 'settings.selling',
    paths: [
      '/settings/payments',
      '/settings/delivery',
      '/settings/couriers',
      '/settings/checkout',
      '/settings/confirmation',
      '/settings/vat',
      '/settings/returns',
      '/settings/meta',
    ],
  },
  { label: 'settings.messages', paths: ['/settings/notifications'] },
  { label: 'settings.planAndData', paths: ['/settings/billing'] },
] as const satisfies readonly { label: AdminKey; paths: readonly string[] }[];

export function SettingsHomePage() {
  const { t } = useLocale();
  const canRead = usePermission('settings.read');
  const items = [
    usePermission('settings.read') && {
      to: '/settings/store' as const,
      icon: Store,
      title: t('settings.store'),
      description: t('settings.store.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/domains' as const,
      icon: Globe,
      title: t('domains.title'),
      description: t('domains.description'),
    },
    usePermission('staff.read') && {
      to: '/settings/staff' as const,
      icon: Users,
      title: t('settings.staff'),
      description: t('settings.staff.description'),
    },
    usePermission('inventory.read') && {
      to: '/settings/location' as const,
      icon: Warehouse,
      title: t('location.title'),
      description: t('location.description'),
    },
    usePermission('settings.credentials') && {
      to: '/settings/payments' as const,
      icon: CreditCard,
      title: t('payments.title'),
      description: t('payments.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/delivery' as const,
      icon: Truck,
      title: t('delivery.title'),
      description: t('delivery.description'),
    },
    usePermission('orders.read') && {
      to: '/settings/couriers' as const,
      icon: Package,
      title: t('couriers.title'),
      description: t('couriers.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/checkout' as const,
      icon: ShoppingCart,
      title: t('checkoutSettings.title'),
      description: t('checkoutSettings.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/confirmation' as const,
      icon: PhoneCall,
      title: t('confirmSettings.title'),
      description: t('confirmSettings.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/vat' as const,
      icon: Percent,
      title: t('vat.title'),
      description: t('vat.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/returns' as const,
      icon: RotateCcw,
      title: t('returnSettings.title'),
      description: t('returnSettings.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/meta' as const,
      icon: Megaphone,
      title: t('meta.title'),
      description: t('meta.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/notifications' as const,
      icon: Bell,
      title: t('notify.title'),
      description: t('notify.description'),
    },
    usePermission('billing.read') && {
      to: '/settings/billing' as const,
      icon: Receipt,
      title: t('billing.title'),
      description: t('billing.description'),
    },
  ].filter((x) => x !== false);
  const [query, setQuery] = useState('');
  const setup = useQuery({ ...setupQuery, enabled: canRead });
  const done = (item: string) => setup.data?.items.find((i) => i.item === item)?.done;
  // Where the setup checklist knows a page's state, its card says it.
  const STATUS = {
    '/settings/store': 'profile',
    '/settings/delivery': 'delivery',
    '/settings/payments': 'payments',
    '/settings/domains': 'domain',
    '/settings/notifications': 'email',
  } as const;
  /** "Done" in green, or "To do: …" in amber, as drawn. */
  const status = (to: string) => {
    const item = STATUS[to as keyof typeof STATUS];
    const state = item ? done(item) : undefined;
    if (state === undefined || !item) return null;
    return state
      ? { text: t('settings.done'), done: true }
      : { text: t('settings.todo', { what: t(`settings.todo.${item}`) }), done: false };
  };
  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => !q || `${i.title} ${i.description}`.toLowerCase().includes(q));
  const groups = GROUPS.map((g) => ({
    ...g,
    items: shown.filter((i) => (g.paths as readonly string[]).includes(i.to)),
  })).filter((g) => g.items.length > 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl leading-7 font-semibold tracking-[-0.01em]">
          {t('settings.title')}
        </h1>
        <div className="relative w-full md:w-[280px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={t('settings.find')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.find')}
            className="h-10 pl-8 md:h-8"
          />
        </div>
      </div>
      {groups.length === 0 && (
        <div className="flex flex-col items-center gap-2.5 rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-muted-foreground">
          <p>{t('settings.noMatch')}</p>
          <Button variant="secondary" onClick={() => setQuery('')}>
            {t('settings.clearSearch')}
          </Button>
        </div>
      )}
      {groups.map((g) => (
        <section
          key={g.label}
          aria-labelledby={`settings-${g.label}`}
          className="flex flex-col gap-2.5"
        >
          <h2 id={`settings-${g.label}`} className="font-semibold text-muted-foreground">
            {t(g.label)}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {g.items.map(({ to, icon: Icon, title, description }) => {
              const st = status(to);
              return (
                <li key={to}>
                  <Link
                    to={to}
                    className="flex h-full gap-3 rounded-[12px] border border-border bg-card p-4 hover:bg-[color-mix(in_oklch,var(--color-muted)_40%,var(--color-card))]"
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium">{title}</span>
                      <span className="text-[13px] leading-[18px] text-muted-foreground">
                        {description}
                      </span>
                      {st && (
                        <span
                          className={cn(
                            'mt-1 text-xs font-medium',
                            st.done ? 'text-success-foreground' : 'text-warning-foreground',
                          )}
                        >
                          {st.text}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
