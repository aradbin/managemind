import { createFileRoute } from '@tanstack/react-router';
import { defined, searchOneOf, searchText, searchUuid } from '../../../lib/search';
import { NewOrderPage } from '../../../pages/order-new';

// The manual order sources, listed here so the route stays out of zod's bundle.
const SOURCES = [
  'facebook',
  'messenger',
  'whatsapp',
  'instagram',
  'phone',
  'walk_in',
  'other',
] as const;

export const Route = createFileRoute('/_shell/orders/new')({
  // ?incomplete=<id>: start from an incomplete checkout (phase-6-plan §3.2).
  // ?source=, ?phone=, ?name=: start from a chat; ?text=, ?title=, ?url=: what
  // Android's share sheet sends to the installed admin (phase-9-plan §3.1.2).
  validateSearch: (search: Record<string, unknown>) =>
    defined({
      incomplete: searchUuid(search.incomplete),
      source: searchOneOf(search.source, SOURCES),
      phone: searchText(search.phone, 32),
      name: searchText(search.name, 100),
      text: searchText(search.text, 5000),
      title: searchText(search.title, 200),
      url: searchText(search.url, 2000),
    }),
  component: NewOrderPage,
});
