// The Reports area's tabs (phase-8-plan §3.8): Overview (Phase 5A's screen),
// Sales, Profit, Stock, Suppliers, Expenses and COD outstanding, as pills
// like the inventory's. Each shows only with the permission its data needs.
import type { Permission } from '@managemind/shared/permissions';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/back-office-reports';
import { meQuery } from '../lib/api';

const SECTIONS = [
  { to: '/reports', label: 'reports.tab.overview', exact: true },
  { to: '/reports/sales', label: 'reports.tab.sales' },
  { to: '/reports/profit', label: 'reports.tab.profit', permission: 'catalog.cost' },
  { to: '/reports/stock', label: 'reports.tab.stock' },
  { to: '/reports/suppliers', label: 'reports.tab.suppliers', permission: 'purchasing.pay' },
  { to: '/reports/expenses', label: 'reports.tab.expenses', permission: 'expenses.read' },
  { to: '/reports/cod-outstanding', label: 'reports.tab.cod' },
] as const satisfies readonly {
  to: string;
  label: AdminKey;
  exact?: boolean;
  permission?: Permission;
}[];

export function ReportsNav() {
  const { t } = useLocale();
  const { data } = useQuery(meQuery);
  const has = (p: Permission) => data?.permissions.includes(p) ?? false;
  return (
    <nav aria-label={t('reports.sections')} className="-mx-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-2">
        {SECTIONS.filter((s) => !('permission' in s) || has(s.permission)).map((s) => (
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
