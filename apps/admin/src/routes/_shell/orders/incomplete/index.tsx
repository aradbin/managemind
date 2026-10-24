import { createFileRoute } from '@tanstack/react-router';
import { defined, searchOneOf } from '../../../../lib/search';
import { IncompleteOrdersPage } from '../../../../pages/incomplete-orders';

export const Route = createFileRoute('/_shell/orders/incomplete/')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({
      tab: searchOneOf(search.tab, ['converted', 'recovered', 'dismissed'] as const),
    }),
  component: IncompleteOrdersPage,
});
