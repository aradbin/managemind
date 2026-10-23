// Our invoices to the store (phase-5b-plan §3.7): queries and formatting
// shared by Settings → Plan and billing, its print page and the dashboard.
import { formatDateTime, type Locale } from '@managemind/shared/i18n';
import { api, unwrap } from './api';

export const billingQuery = {
  queryKey: ['billing'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/billing')),
};

export const storeInvoiceQuery = (id: string) => ({
  queryKey: ['billing', 'invoice', id] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/billing/invoices/{id}', { params: { path: { id } } })),
});

/** A Dhaka date (YYYY-MM-DD) as the reader writes dates. */
export const formatDay = (locale: Locale, day: string) =>
  formatDateTime(locale, new Date(`${day}T00:00:00+06:00`), { dateStyle: 'medium' });
