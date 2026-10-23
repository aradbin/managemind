// The page lives in src/pages so the router's code splitting moves all of
// it, schemas included, out of the first download.
import { createFileRoute } from '@tanstack/react-router';
import { defined, searchOneOf, searchUuid } from '../../../lib/search';
import { PlatformBillingPage } from '../../../pages/platform/billing';

const FILTERS = ['all', 'draft', 'overdue', 'week', 'paid', 'void'] as const;

export const Route = createFileRoute('/_shell/platform/billing/')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({ filter: searchOneOf(search.filter, FILTERS), tenant: searchUuid(search.tenant) }),
  component: PlatformBillingPage,
});
