import { createFileRoute } from '@tanstack/react-router';
import { defined, searchUuid } from '../../../lib/search';
import { ImportPage } from '../../../pages/import';

// The job in the URL, so a closed tab or a reload resumes where it was.
export const Route = createFileRoute('/_shell/catalog/import')({
  validateSearch: (search: Record<string, unknown>) => defined({ job: searchUuid(search.job) }),
  component: ImportPage,
});
