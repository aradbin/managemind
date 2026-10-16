import { createFileRoute } from '@tanstack/react-router';
import { VatSettingsPage } from '../../../pages/catalog-settings';

export const Route = createFileRoute('/_shell/settings/vat')({ component: VatSettingsPage });
