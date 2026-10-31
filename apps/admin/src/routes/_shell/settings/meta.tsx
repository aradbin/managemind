import { createFileRoute } from '@tanstack/react-router';
import { MetaSettingsPage } from '../../../pages/meta-settings';

export const Route = createFileRoute('/_shell/settings/meta')({
  component: MetaSettingsPage,
});
