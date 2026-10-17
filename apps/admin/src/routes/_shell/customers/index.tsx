import { createFileRoute } from '@tanstack/react-router';
import { defined, searchText } from '../../../lib/search';
import { CustomersPage } from '../../../pages/customers';

export const Route = createFileRoute('/_shell/customers/')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({ q: searchText(search.q, 100), tag: searchText(search.tag, 50) }),
  component: CustomersPage,
});
