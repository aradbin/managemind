import { createFileRoute } from '@tanstack/react-router';
import { LocationSettingsPage } from '../../../pages/catalog-settings';

export const Route = createFileRoute('/_shell/settings/location')({
  component: LocationSettingsPage,
});
