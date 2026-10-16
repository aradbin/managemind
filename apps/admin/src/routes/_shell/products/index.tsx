import { createFileRoute } from '@tanstack/react-router';
import { defined, searchFlag, searchOneOf, searchText, searchUuid } from '../../../lib/search';
import { ProductsPage } from '../../../pages/products';

// The list's filters live in the URL, so a filtered list can be shared and survives a reload.
export const Route = createFileRoute('/_shell/products/')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({
      q: searchText(search.q, 100),
      status: searchOneOf(search.status, ['draft', 'active', 'archived'] as const),
      categoryId: searchUuid(search.categoryId),
      collectionId: searchUuid(search.collectionId),
      brandValueId: searchUuid(search.brandValueId),
      tag: searchText(search.tag, 50),
      lowStock: searchFlag(search.lowStock),
    }),
  component: ProductsPage,
});
