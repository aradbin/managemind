import { createFileRoute } from '@tanstack/react-router';
import { defined, searchOneOf } from '../../lib/search';
import { ExpensesPage } from '../../pages/expenses';

export const Route = createFileRoute('/_shell/expenses')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({
      tab: searchOneOf(search.tab, ['recurring', 'categories'] as const),
      month:
        typeof search.month === 'string' && /^\d{4}-\d{2}$/.test(search.month)
          ? search.month
          : undefined,
    }),
  component: ExpensesPage,
});
