import { createFileRoute } from '@tanstack/react-router';
import { defined, searchNew } from '../../../../lib/search';
import { StorePagesPage } from '../../../../pages/store-pages';

export const Route = createFileRoute('/_shell/online-store/pages/')({
  validateSearch: (search: Record<string, unknown>) => defined({ new: searchNew(search.new) }),
  component: StorePagesPage,
});
