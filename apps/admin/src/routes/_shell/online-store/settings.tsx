import { createFileRoute } from '@tanstack/react-router';
import { StorefrontSettingsPage } from '../../../pages/storefront-settings';

export const Route = createFileRoute('/_shell/online-store/settings')({
  component: StorefrontSettingsPage,
});
