import { createFileRoute } from '@tanstack/react-router';
import { defined, searchNew } from '../../../../lib/search';
import { StockCountsPage } from '../../../../pages/stock-counts';

export const Route = createFileRoute('/_shell/inventory/counts/')({
  validateSearch: (search: Record<string, unknown>) => defined({ new: searchNew(search.new) }),
  component: StockCountsPage,
});
