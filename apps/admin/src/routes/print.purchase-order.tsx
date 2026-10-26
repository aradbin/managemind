import { createFileRoute, redirect } from '@tanstack/react-router';
import { ApiError, meQuery } from '../lib/api';
import { defined, searchUuid } from '../lib/search';
import { chooseStore } from '../lib/store';
import { PurchaseOrderPrintPage } from '../pages/purchase-order-print';

// A purchase order to print or share, in its own tab outside the shell.
export const Route = createFileRoute('/print/purchase-order')({
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
  component: PurchaseOrderPrintPage,
});
