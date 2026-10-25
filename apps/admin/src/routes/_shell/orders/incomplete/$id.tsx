import { createFileRoute } from '@tanstack/react-router';
import { IncompleteOrderPage } from '../../../../pages/incomplete-orders';

export const Route = createFileRoute('/_shell/orders/incomplete/$id')({
  component: IncompleteOrderPage,
});
