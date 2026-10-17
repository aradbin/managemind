import { createFileRoute } from '@tanstack/react-router';
import { defined, searchUuid } from '../../../lib/search';
import { CustomerImportPage } from '../../../pages/customer-import';

// The job ID is in the URL, so a closed tab picks up where it stopped.
export const Route = createFileRoute('/_shell/customers/import')({
  validateSearch: (search: Record<string, unknown>) => defined({ job: searchUuid(search.job) }),
  component: CustomerImportPage,
});
