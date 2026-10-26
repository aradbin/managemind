import { createFileRoute } from '@tanstack/react-router';
import { AdjustmentsPage } from '../../../pages/adjustments';

export const Route = createFileRoute('/_shell/inventory/adjustments')({
  component: AdjustmentsPage,
});
