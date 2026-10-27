import { createFileRoute } from '@tanstack/react-router';
import { defined, searchUuid } from '../../../lib/search';
import { ReceiveStockPage } from '../../../pages/receive-stock';

export const Route = createFileRoute('/_shell/inventory/receive')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({ purchaseOrderId: searchUuid(search.purchaseOrderId) }),
  component: ReceiveStockPage,
});
