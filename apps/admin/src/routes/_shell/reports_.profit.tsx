// The page lives in src/pages so the router's code splitting moves all of
// it out of the first download.
import { createFileRoute } from '@tanstack/react-router';
import { ProfitReportPage } from '../../pages/profit-report';

export const Route = createFileRoute('/_shell/reports_/profit')({ component: ProfitReportPage });
