import { createFileRoute } from '@tanstack/react-router';
import { SupplierDetailPage } from '../../../../pages/supplier-detail';

export const Route = createFileRoute('/_shell/inventory/suppliers/$id')({
  component: SupplierDetailPage,
});
