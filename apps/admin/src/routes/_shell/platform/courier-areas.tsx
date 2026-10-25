// The page lives in src/pages so the router's code splitting moves all of
// it out of the first download.
import { createFileRoute } from '@tanstack/react-router';
import { CourierAreasPage } from '../../../pages/platform/courier-areas';

export const Route = createFileRoute('/_shell/platform/courier-areas')({
  component: CourierAreasPage,
});
