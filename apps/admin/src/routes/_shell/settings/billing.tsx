import { createFileRoute } from '@tanstack/react-router';
import { defined, searchUuid } from '../../../lib/search';
import { BillingPage } from '../../../pages/billing';

export const Route = createFileRoute('/_shell/settings/billing')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({ invoice: searchUuid(search.invoice) }),
  component: BillingPage,
});
