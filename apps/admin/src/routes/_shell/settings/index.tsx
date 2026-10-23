import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Bell,
  ChevronRight,
  CreditCard,
  Globe,
  Percent,
  RotateCcw,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import { PageHeader } from '../../../components/page-header';
import { usePermission } from '../../../components/permission-gate';
import { useLocale } from '../../../i18n';

export const Route = createFileRoute('/_shell/settings/')({ component: Page });

function Page() {
  const { t } = useLocale();
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
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <ul className="flex max-w-2xl flex-col divide-y divide-border rounded-md border border-border">
        {items.map(({ to, icon: Icon, title, description }) => (
          <li key={to}>
            <Link to={to} className="flex min-h-16 items-center gap-3 p-4 hover:bg-muted">
              <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex flex-1 flex-col">
                <span className="font-medium">{title}</span>
                <span className="text-sm text-muted-foreground">{description}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
