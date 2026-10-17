import { createFileRoute, redirect } from '@tanstack/react-router';
import { ApiError, meQuery } from '../lib/api';
import { defined, searchOneOf, searchText } from '../lib/search';
import { chooseStore } from '../lib/store';
import { OrderPrintPage } from '../pages/order-print';

// Invoices and packing slips open in their own tab, outside the shell, so
// only the documents print.
export const Route = createFileRoute('/print/orders')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({
      ids: searchText(search.ids, 4000),
      doc: searchOneOf(search.doc, ['invoice', 'slip'] as const),
    }),
  beforeLoad: async ({ context, location }) => {
    try {
      const me = await context.queryClient.ensureQueryData(meQuery);
      await chooseStore(context.queryClient, me);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        throw redirect({ to: '/sign-in', search: { redirect: location.href } });
      }
      throw e;
    }
  },
  component: OrderPrintPage,
});
