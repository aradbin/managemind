import { createFileRoute } from '@tanstack/react-router';
import { defined, searchFlag, searchText } from '../../lib/search';
import { InventoryPage } from '../../pages/inventory';

export const Route = createFileRoute('/_shell/inventory')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({ q: searchText(search.q, 100), lowStock: searchFlag(search.lowStock) }),
  component: InventoryPage,
});
