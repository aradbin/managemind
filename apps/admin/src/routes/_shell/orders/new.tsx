import { createFileRoute } from '@tanstack/react-router';
import { NewOrderPage } from '../../../pages/order-new';

export const Route = createFileRoute('/_shell/orders/new')({ component: NewOrderPage });
