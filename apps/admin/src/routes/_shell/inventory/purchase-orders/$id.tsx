import { createFileRoute } from '@tanstack/react-router';
import { PurchaseOrderPage } from '../../../../pages/purchase-order';

export const Route = createFileRoute('/_shell/inventory/purchase-orders/$id')({
  component: PurchaseOrderPage,
});
