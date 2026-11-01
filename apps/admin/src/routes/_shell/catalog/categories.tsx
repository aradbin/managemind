import { createFileRoute } from '@tanstack/react-router';
import { defined, searchNew } from '../../../lib/search';
import { CategoriesPage } from '../../../pages/categories';

export const Route = createFileRoute('/_shell/catalog/categories')({
  validateSearch: (search: Record<string, unknown>) => defined({ new: searchNew(search.new) }),
  component: CategoriesPage,
});
