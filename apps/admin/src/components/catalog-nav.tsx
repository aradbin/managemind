// The catalog area's sections, as a row of links under the page title: a
// scrollable strip of pills on phones, a tab row from md (ADR 0029).
import { Link } from '@tanstack/react-router';
import { type AdminKey, useLocale } from '../i18n';
import { usePermission } from './permission-gate';

const SECTIONS = [
  { to: '/products', label: 'catalog.products' },
  { to: '/catalog/categories', label: 'catalog.categories' },
  { to: '/catalog/collections', label: 'catalog.collections' },
  { to: '/catalog/attributes', label: 'catalog.attributes' },
  { to: '/inventory', label: 'catalog.inventory', permission: 'inventory.read' },
  { to: '/catalog/import', label: 'catalog.import', permission: 'catalog.write' },
] as const satisfies readonly {
  to: string;
  label: AdminKey;
  permission?: 'inventory.read' | 'catalog.write';
}[];

export function CatalogNav() {
  const { t } = useLocale();
  const inventory = usePermission('inventory.read');
  const write = usePermission('catalog.write');
  const allowed = (p: string | undefined) =>
    !p || (p === 'inventory.read' ? inventory : p === 'catalog.write' ? write : false);
  return (
    <nav aria-label={t('catalog.sections')} className="-mx-4 mb-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-2 md:gap-1 md:border-b md:border-border">
        {SECTIONS.filter((s) => allowed('permission' in s ? s.permission : undefined)).map((s) => (
          <li key={s.to}>
            <Link
              to={s.to}
              className="flex min-h-10 items-center rounded-full border border-input bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground md:min-h-11 md:rounded-none md:border-0 md:border-b-2 md:border-transparent md:bg-transparent md:px-3"
              activeProps={{
                'aria-current': 'page',
                className:
                  'border-foreground! bg-foreground! font-semibold text-background! md:border-foreground! md:bg-transparent! md:text-foreground!',
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
