import { createFileRoute } from '@tanstack/react-router';
import { defined, searchFlag, searchOneOf, searchText, searchUuid } from '../../../lib/search';
import { OrdersPage } from '../../../pages/orders';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown) => (typeof v === 'string' && DATE.test(v) ? v : undefined);

// The list's filters live in the URL, so a filtered list can be shared and survives a reload.
export const Route = createFileRoute('/_shell/orders/')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({
      q: searchText(search.q, 100),
      status: searchOneOf(search.status, [
        'pending',
        'confirmed',
        'processing',
        'completed',
        'cancelled',
      ] as const),
      paymentStatus: searchOneOf(search.paymentStatus, [
        'unpaid',
        'partially_paid',
        'paid',
      ] as const),
      deliveryStatus: searchOneOf(search.deliveryStatus, [
        'not_shipped',
        'partially_shipped',
        'shipped',
        'delivered',
        'failed',
      ] as const),
      source: searchOneOf(search.source, [
        'website',
        'facebook',
        'phone',
        'walk_in',
        'other',
      ] as const),
      zoneId: searchUuid(search.zoneId),
      tag: searchText(search.tag, 50),
      cancelledByShopper: searchFlag(search.cancelledByShopper),
      from: date(search.from),
      to: date(search.to),
    }),
  component: OrdersPage,
});
