import { createFileRoute } from '@tanstack/react-router';
import { CourierSettingsPage } from '../../../pages/courier-settings';

export const Route = createFileRoute('/_shell/settings/couriers')({
  component: CourierSettingsPage,
});
