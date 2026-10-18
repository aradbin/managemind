import { createFileRoute } from '@tanstack/react-router';
import { ReturnSettingsPage } from '../../../pages/return-settings';

export const Route = createFileRoute('/_shell/settings/returns')({
  component: ReturnSettingsPage,
});
