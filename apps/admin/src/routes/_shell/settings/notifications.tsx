import { createFileRoute } from '@tanstack/react-router';
import { NotificationSettingsPage } from '../../../pages/notification-settings';

export const Route = createFileRoute('/_shell/settings/notifications')({
  component: NotificationSettingsPage,
});
