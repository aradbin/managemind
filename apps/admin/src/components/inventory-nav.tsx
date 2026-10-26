// The inventory area's sections (phase-8-plan §3.12), under the catalog's
// own row: stock, purchase orders, receiving, suppliers, counts and
// adjustments, as pills.
import { Link } from '@tanstack/react-router';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/purchasing';
import { usePermission } from './permission-gate';

const SECTIONS = [
  { to: '/inventory', label: 'inventory.tab.stock', exact: true },
  {
    to: '/inventory/purchase-orders',
    label: 'inventory.tab.purchaseOrders',
    permission: 'purchasing.read',
  },
  { to: '/inventory/receive', label: 'inventory.tab.receive', permission: 'inventory.write' },
  { to: '/inventory/suppliers', label: 'inventory.tab.suppliers', permission: 'purchasing.read' },
  { to: '/inventory/counts', label: 'inventory.tab.counts' },
  { to: '/inventory/adjustments', label: 'inventory.tab.adjustments' },
] as const satisfies readonly {
  to: string;
  label: AdminKey;
  exact?: boolean;
  permission?: 'purchasing.read' | 'inventory.write';
}[];

export function InventoryNav() {
  const { t } = useLocale();
  const read = usePermission('purchasing.read');
  const write = usePermission('inventory.write');
  const allowed = (p: string | undefined) =>
    !p || (p === 'purchasing.read' ? read : p === 'inventory.write' ? write && read : false);
  return (
    <nav aria-label={t('inventory.sections')} className="-mx-4 mb-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-2">
        {SECTIONS.filter((s) => allowed('permission' in s ? s.permission : undefined)).map((s) => (
          <li key={s.to}>
            <Link
              to={s.to}
              activeOptions={{ exact: 'exact' in s }}
              className="flex min-h-10 items-center rounded-full border border-input bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
              activeProps={{
                'aria-current': 'page',
                className: 'border-primary! bg-primary-soft! font-semibold text-primary!',
              }}
            >
              {t(s.label)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
