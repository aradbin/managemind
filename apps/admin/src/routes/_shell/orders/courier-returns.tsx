import { createFileRoute } from '@tanstack/react-router';
import { CourierReturnsPage } from '../../../pages/courier-returns';

export const Route = createFileRoute('/_shell/orders/courier-returns')({
  component: CourierReturnsPage,
});
