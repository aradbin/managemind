import { createFileRoute } from '@tanstack/react-router';
import { defined, searchUuid } from '../../../../lib/search';
import { PurchaseOrderPage } from '../../../../pages/purchase-order';

export const Route = createFileRoute('/_shell/inventory/purchase-orders/new')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({ supplierId: searchUuid(search.supplierId) }),
  component: PurchaseOrderPage,
});
