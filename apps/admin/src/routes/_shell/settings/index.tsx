// Settings (phase-1-plan §7.3, redesigned in ADR 0029): every settings page
// as a card, grouped by what it is about, with a filter, and a status line
// where the setup checklist knows whether the page is done.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Bell,
  CreditCard,
  Globe,
  Percent,
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
import { PageHeader } from '../../../components/page-header';
import { usePermission } from '../../../components/permission-gate';
import { setupQuery } from '../../../components/setup-card';
import { type AdminKey, useLocale } from '../../../i18n';
import { cn } from '../../../lib/utils';

export const Route = createFileRoute('/_shell/settings/')({ component: Page });

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
      '/settings/checkout',
      '/settings/vat',
      '/settings/returns',
    ],
  },
  { label: 'settings.messages', paths: ['/settings/notifications'] },
  { label: 'settings.planAndData', paths: ['/settings/billing'] },
] as const satisfies readonly { label: AdminKey; paths: readonly string[] }[];

function Page() {
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
    usePermission('settings.read') && {
      to: '/settings/vat' as const,
      icon: Percent,
      title: t('vat.title'),
      description: t('vat.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/delivery' as const,
      icon: Truck,
      title: t('delivery.title'),
      description: t('delivery.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/checkout' as const,
      icon: ShoppingCart,
      title: t('checkoutSettings.title'),
      description: t('checkoutSettings.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/returns' as const,
      icon: RotateCcw,
      title: t('returnSettings.title'),
      description: t('returnSettings.description'),
    },
    usePermission('settings.credentials') && {
      to: '/settings/payments' as const,
      icon: CreditCard,
      title: t('payments.title'),
      description: t('payments.description'),
    },
    usePermission('billing.read') && {
      to: '/settings/billing' as const,
      icon: Receipt,
      title: t('billing.title'),
      description: t('billing.description'),
    },
    usePermission('settings.read') && {
      to: '/settings/notifications' as const,
      icon: Bell,
      title: t('notify.title'),
      description: t('notify.description'),
    },
    usePermission('inventory.read') && {
      to: '/settings/location' as const,
      icon: Warehouse,
      title: t('location.title'),
      description: t('location.description'),
    },
  ].filter((x) => x !== false);
  const [query, setQuery] = useState('');
  const setup = useQuery({ ...setupQuery, enabled: canRead });
  const done = (item: string) => setup.data?.items.find((i) => i.item === item)?.done;
  // Where the setup checklist knows a page's state, its card says it.
  const status: Partial<Record<string, boolean | undefined>> = {
    '/settings/store': done('profile'),
    '/settings/delivery': done('delivery'),
    '/settings/payments': done('payments'),
    '/settings/domains': done('domain'),
    '/settings/notifications': done('email'),
  };
  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => !q || `${i.title} ${i.description}`.toLowerCase().includes(q));
  const groups = GROUPS.map((g) => ({
    ...g,
    items: shown.filter((i) => (g.paths as readonly string[]).includes(i.to)),
  })).filter((g) => g.items.length > 0);
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader className="mb-0" title={t('settings.title')} />
        <label className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 md:w-80">
          <Search aria-hidden className="size-4 text-muted-foreground" />
          <span className="sr-only">{t('settings.find')}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.find')}
            className="min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
          />
        </label>
      </div>
      {groups.length === 0 && <p className="text-muted-foreground">{t('settings.noMatch')}</p>}
      {groups.map((g) => (
        <section
          key={g.label}
          aria-labelledby={`settings-${g.label}`}
          className="flex flex-col gap-2.5"
        >
          <h2
            id={`settings-${g.label}`}
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t(g.label)}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {g.items.map(({ to, icon: Icon, title, description }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="flex h-full items-start gap-3.5 rounded-xl border border-border bg-background p-4 hover:border-input hover:shadow-sm"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"
                  >
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-semibold">{title}</span>
                    <span className="text-sm text-muted-foreground">{description}</span>
                    {status[to] !== undefined && (
                      <span
                        className={cn(
                          'mt-1 inline-flex items-center gap-1.5 text-xs font-medium before:size-1.5 before:rounded-full before:bg-current',
                          status[to] ? 'text-success' : 'text-warning-foreground',
                        )}
                      >
                        {t(status[to] ? 'settings.ready' : 'settings.toFinish')}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
