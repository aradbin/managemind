import { createFileRoute } from '@tanstack/react-router';
import { defined, searchNew } from '../../../../lib/search';
import { SuppliersPage } from '../../../../pages/suppliers';

export const Route = createFileRoute('/_shell/inventory/suppliers/')({
  validateSearch: (search: Record<string, unknown>) => defined({ new: searchNew(search.new) }),
  component: SuppliersPage,
});
