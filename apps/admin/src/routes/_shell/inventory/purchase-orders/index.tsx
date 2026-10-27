import { createFileRoute } from '@tanstack/react-router';
import { PurchaseOrdersPage } from '../../../../pages/purchase-orders';

export const Route = createFileRoute('/_shell/inventory/purchase-orders/')({
  component: PurchaseOrdersPage,
});
