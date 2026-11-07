// Settings: every settings page as a card (pages/settings-home.tsx). The
// page and its messages load with the route.
import { createFileRoute } from '@tanstack/react-router';
import { SettingsHomePage } from '../../../pages/settings-home';

export const Route = createFileRoute('/_shell/settings/')({ component: SettingsHomePage });
