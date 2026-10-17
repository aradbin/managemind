import { createFileRoute } from '@tanstack/react-router';
import { CheckoutSettingsPage } from '../../../pages/checkout-settings';

export const Route = createFileRoute('/_shell/settings/checkout')({
  component: CheckoutSettingsPage,
});
