// The page lives in src/pages so the router's code splitting moves all of
// it out of the first download.
import { createFileRoute } from '@tanstack/react-router';
import { CodOutstandingPage } from '../../pages/cod-outstanding';

export const Route = createFileRoute('/_shell/reports_/cod-outstanding')({
  component: CodOutstandingPage,
});
