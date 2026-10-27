import { createFileRoute } from '@tanstack/react-router';
import { SuppliersPage } from '../../../../pages/suppliers';

export const Route = createFileRoute('/_shell/inventory/suppliers/')({ component: SuppliersPage });
