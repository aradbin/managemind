// The page lives in src/pages so the router's code splitting moves all of
// it out of the first download.
import { createFileRoute } from '@tanstack/react-router';
import { ExpenseImportPage } from '../../pages/back-office-import';

export const Route = createFileRoute('/_shell/expenses_/import')({ component: ExpenseImportPage });
