import { createFileRoute } from '@tanstack/react-router';
import { SupplierImportPage } from '../../../../pages/back-office-import';

export const Route = createFileRoute('/_shell/inventory/suppliers/import')({
  component: SupplierImportPage,
});
