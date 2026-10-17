import { createFileRoute } from '@tanstack/react-router';
import { OrderDetailPage } from '../../../pages/order-detail';

export const Route = createFileRoute('/_shell/orders/$id')({ component: OrderDetailPage });
