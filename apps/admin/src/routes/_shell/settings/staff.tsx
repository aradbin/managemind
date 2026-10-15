// The page lives in src/pages so the router's code splitting moves all of
// it, schemas included, out of the first download.
import { createFileRoute } from '@tanstack/react-router';
import { StaffPage } from '../../../pages/staff';

export const Route = createFileRoute('/_shell/settings/staff')({ component: StaffPage });
