import { createFileRoute } from '@tanstack/react-router';
import { ConfirmationSettingsPage } from '../../../pages/confirmation-settings';

export const Route = createFileRoute('/_shell/settings/confirmation')({
  component: ConfirmationSettingsPage,
});
