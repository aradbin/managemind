import { createFileRoute } from '@tanstack/react-router';
import { CustomerDetailPage } from '../../../pages/customers';

export const Route = createFileRoute('/_shell/customers/$id')({ component: CustomerDetailPage });
