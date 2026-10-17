import { createFileRoute } from '@tanstack/react-router';
import { DeliverySettingsPage } from '../../../pages/delivery-settings';

export const Route = createFileRoute('/_shell/settings/delivery')({
  component: DeliverySettingsPage,
});
