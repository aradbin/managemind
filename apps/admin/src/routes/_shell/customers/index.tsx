import { createFileRoute } from '@tanstack/react-router';
import { defined, searchPage, searchText } from '../../../lib/search';
import { CustomersPage } from '../../../pages/customers';

export const Route = createFileRoute('/_shell/customers/')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({
      q: searchText(search.q, 100),
      tag: searchText(search.tag, 1000),
      page: searchPage(search.page),
    }),
  component: CustomersPage,
});
