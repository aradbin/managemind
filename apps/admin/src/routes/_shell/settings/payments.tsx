import { createFileRoute } from '@tanstack/react-router';
import { PaymentSettingsPage } from '../../../pages/payment-settings';

export const Route = createFileRoute('/_shell/settings/payments')({
  component: PaymentSettingsPage,
});
