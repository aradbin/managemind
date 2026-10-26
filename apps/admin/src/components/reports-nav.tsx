// The Reports area's tabs (phase-8-plan §3.8): Overview (Phase 5A's screen),
// Sales and Profit, as pills like the inventory's. Profit needs the cost
// permission.
import { Link } from '@tanstack/react-router';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/back-office-reports';
import { usePermission } from './permission-gate';

const SECTIONS = [
  { to: '/reports', label: 'reports.tab.overview', exact: true },
  { to: '/reports/sales', label: 'reports.tab.sales' },
  { to: '/reports/profit', label: 'reports.tab.profit', cost: true },
] as const satisfies readonly { to: string; label: AdminKey; exact?: boolean; cost?: boolean }[];

export function ReportsNav() {
  const { t } = useLocale();
  const cost = usePermission('catalog.cost');
  return (
    <nav aria-label={t('reports.sections')} className="-mx-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-2">
        {SECTIONS.filter((s) => !('cost' in s) || cost).map((s) => (
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
