// The page lives in src/pages so the router's code splitting moves all of
// it, schemas included, out of the first download.
import { createFileRoute } from '@tanstack/react-router';
import { TenantsPage } from '../../../pages/platform/tenants';

export const Route = createFileRoute('/_shell/platform/')({ component: TenantsPage });
