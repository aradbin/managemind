// The catalog area's sections, as a row of links under the page title: a
// scrollable strip on phones, a tab row from md.
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
      <ul className="flex min-w-max gap-1 border-b border-border">
        {SECTIONS.filter((s) => allowed('permission' in s ? s.permission : undefined)).map((s) => (
          <li key={s.to}>
            <Link
              to={s.to}
              className="flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm text-muted-foreground hover:text-foreground"
              activeProps={{
                'aria-current': 'page',
                className: 'border-primary! font-semibold text-foreground!',
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
