import { createFileRoute, redirect } from '@tanstack/react-router';
import { ApiError, meQuery } from '../lib/api';
import { defined, searchUuid } from '../lib/search';
import { chooseStore } from '../lib/store';
import { InvoicePrintPage } from '../pages/invoice-print';

// Our invoice to the store opens in its own tab, outside the shell, so only
// the invoice prints.
export const Route = createFileRoute('/print/invoice')({
  validateSearch: (search: Record<string, unknown>) => defined({ id: searchUuid(search.id) }),
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
  component: InvoicePrintPage,
});
