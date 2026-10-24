// The page lives in src/pages so the router's code splitting moves all of
// it, schemas included, out of the first download.
import { createFileRoute } from '@tanstack/react-router';
import { PlatformDashboardPage } from '../../../pages/platform/dashboard';

export const Route = createFileRoute('/_shell/platform/dashboard')({
  component: PlatformDashboardPage,
});
