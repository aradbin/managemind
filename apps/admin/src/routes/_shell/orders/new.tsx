import { createFileRoute } from '@tanstack/react-router';
import { defined, searchUuid } from '../../../lib/search';
import { NewOrderPage } from '../../../pages/order-new';

export const Route = createFileRoute('/_shell/orders/new')({
  // ?incomplete=<id>: start from an incomplete checkout (phase-6-plan §3.2).
  validateSearch: (search: Record<string, unknown>) =>
    defined({ incomplete: searchUuid(search.incomplete) }),
  component: NewOrderPage,
});
