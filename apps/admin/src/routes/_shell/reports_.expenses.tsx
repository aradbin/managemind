// The page lives in src/pages so the router's code splitting moves all of
// it out of the first download.
import { createFileRoute } from '@tanstack/react-router';
import { ExpenseReportPage } from '../../pages/expense-report';

export const Route = createFileRoute('/_shell/reports_/expenses')({ component: ExpenseReportPage });
