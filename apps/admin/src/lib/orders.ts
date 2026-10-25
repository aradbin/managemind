// Orders, customers and delivery for the admin screens (phase-4-plan §7):
// the API's types, queries, and the small helpers the screens share.
import type { paths } from '@managemind/sdk';
import { formatDateTime, type Locale } from '@managemind/shared/i18n';
import type { QueryClient } from '@tanstack/react-query';
import type { AdminKey } from '../i18n';
import { ApiError, api, unwrap } from './api';
import { compact } from './catalog';
import { saveErrorMessage } from './errors';

type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { 200: { content: { 'application/json': infer T } } };
}
  ? T
  : paths[P][M] extends { responses: { 201: { content: { 'application/json': infer T } } } }
    ? T
    : never;
type Body<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer T } };
}
  ? T
  : never;

export type OrderPage = Json<'/v1/admin/orders', 'get'>;
export type OrderSummary = OrderPage['items'][number];
export type OrderDetail = Json<'/v1/admin/orders/{id}', 'get'>;
export type OrderLine = OrderDetail['lines'][number];
export type Shipment = OrderDetail['shipments'][number];
export type OrderQuote = Json<'/v1/admin/orders/quote', 'post'>;
export type ManualOrderBody = Body<'/v1/admin/orders', 'post'>;
export type EditBody = Body<'/v1/admin/orders/{id}/edit', 'post'>;
export type EditPreview = Json<'/v1/admin/orders/{id}/edit/preview', 'post'>;
export type PrintData = Json<'/v1/admin/orders/print', 'get'>;
export type Customer = Json<'/v1/admin/customers/{id}', 'get'>;
export type CustomerSummary = Json<'/v1/admin/customers', 'get'>['items'][number];
export type CustomerAddress = Customer['addresses'][number];
export type Zone = Json<'/v1/admin/delivery-zones', 'get'>[number];
export type BlockedPhone = Json<'/v1/admin/blocked-phones', 'get'>[number];
export type Dashboard = Json<'/v1/admin/dashboard', 'get'>;
export type ConfirmationQueue = Json<'/v1/admin/confirmations', 'get'>;
export type QueueItem = ConfirmationQueue['items'][number];
export type CallPanel = Json<'/v1/admin/orders/{id}/confirmation/claim', 'post'>;
export type QueueTab = 'to_call' | 'later' | 'unreachable' | 'risky';
export type IncompletePage = Json<'/v1/admin/incomplete-orders', 'get'>;
export type IncompleteSummary = IncompletePage['items'][number];
export type IncompleteDetail = Json<'/v1/admin/incomplete-orders/{id}', 'get'>;
export type IncompleteTab = 'open' | 'converted' | 'recovered' | 'dismissed';

/** Incomplete checkouts (phase-6-plan §3.2), newest change first. */
export const incompleteQuery = (tab: IncompleteTab) => ({
  queryKey: ['incomplete-orders', tab] as const,
  queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
    api
      .GET('/v1/admin/incomplete-orders', {
        params: { query: { tab, limit: 50, ...(pageParam ? { after: pageParam } : {}) } },
      })
      .then(unwrap),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: IncompletePage) => last.nextCursor ?? undefined,
});

export const incompleteOrderQuery = (id: string) => ({
  queryKey: ['incomplete-order', id] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/incomplete-orders/{id}', { params: { path: { id } } })),
});
export type Localized = { bn?: string | undefined; en?: string | undefined };

/** The value in `locale`, else the other language, else ''. */
export const pickText = (v: Localized | null | undefined, locale: Locale) =>
  v?.[locale] ?? v?.[locale === 'bn' ? 'en' : 'bn'] ?? '';

/** An Idempotency-Key for one attempt of a command (PLAN.md): a retry of the same click reuses it. */
export const idempotencyKey = () => crypto.randomUUID();
export const withKey = (key: string) => ({ params: { header: { 'idempotency-key': key } } });

export const dateTime = (locale: Locale, iso: string) => formatDateTime(locale, new Date(iso));
export const dateOnly = (locale: Locale, iso: string) =>
  formatDateTime(locale, new Date(iso), { dateStyle: 'medium' });

// ---- Queries ---------------------------------------------------------------------------

export interface OrderFilters {
  status?: 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled' | undefined;
  paymentStatus?:
    | 'unpaid'
    | 'partially_paid'
    | 'paid'
    | 'partially_refunded'
    | 'refunded'
    | undefined;
  deliveryStatus?:
    | 'not_shipped'
    | 'partially_shipped'
    | 'shipped'
    | 'delivered'
    | 'failed'
    | undefined;
  source?: 'website' | 'facebook' | 'phone' | 'walk_in' | 'other' | 'exchange' | undefined;
  zoneId?: string | undefined;
  tag?: string | undefined;
  cancelledByShopper?: boolean | undefined;
  /** Risky phones, possible duplicates, unreachable (phase-6-plan §3.8). */
  flag?: 'flagged_phone' | 'possible_duplicate' | 'unreachable' | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
}

export async function fetchOrders(filters: OrderFilters, after?: string, limit = 50) {
  const { cancelledByShopper, ...rest } = filters;
  return unwrap(
    await api.GET('/v1/admin/orders', {
      params: {
        query: compact({
          ...rest,
          ...(cancelledByShopper ? { cancelledByShopper: true } : {}),
          after,
          limit,
        }) as never,
      },
    }),
  );
}

export const ordersQuery = (filters: OrderFilters) => ({
  queryKey: ['orders', filters] as const,
  queryFn: ({ pageParam }: { pageParam: string | undefined }) => fetchOrders(filters, pageParam),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: OrderPage) => last.nextCursor ?? undefined,
});

/** One tab of the confirmation queue (phase-6-plan §3.5); refreshed every 30 seconds while open. */
export const confirmationsQuery = (tab: QueueTab) => ({
  queryKey: ['confirmations', tab] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/confirmations', { params: { query: { tab, limit: 100 } } })),
  refetchInterval: 30_000,
});

export const orderQuery = (id: string) => ({
  queryKey: ['order', id] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/orders/{id}', { params: { path: { id } } })),
});

export interface CustomerFilters {
  q?: string | undefined;
  tag?: string | undefined;
}

export async function fetchCustomers(filters: CustomerFilters, after?: string, limit = 50) {
  return unwrap(
    await api.GET('/v1/admin/customers', {
      params: { query: compact({ ...filters, after, limit }) },
    }),
  );
}

export const customersQuery = (filters: CustomerFilters) => ({
  queryKey: ['customers', filters] as const,
  queryFn: ({ pageParam }: { pageParam: string | undefined }) => fetchCustomers(filters, pageParam),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
});

export const customerQuery = (id: string) => ({
  queryKey: ['customer', id] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/customers/{id}', { params: { path: { id } } })),
});

export const zonesQuery = {
  queryKey: ['delivery-zones'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/delivery-zones')),
};

export const blockedQuery = {
  queryKey: ['blocked-phones'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/blocked-phones')),
};

/**
 * The API lets the browser keep the dashboard for 60 seconds (§3.17); a
 * refetch, which follows a change made here, skips that copy.
 */
export const dashboardQuery = {
  queryKey: ['dashboard'] as const,
  queryFn: async ({ client }: { client: QueryClient }) => {
    const refetch = client.getQueryData(['dashboard']) !== undefined;
    return unwrap(await api.GET('/v1/admin/dashboard', refetch ? { cache: 'no-cache' } : {}));
  },
  staleTime: 60_000,
};

/** Variants for the order screens' product search, with what is available to sell. */
export const variantSearchQuery = (q: string) => ({
  queryKey: ['variant-search', q] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/inventory', { params: { query: { q, limit: 20 } } })).items,
  enabled: q.trim().length > 0,
  staleTime: 10_000,
});

// ---- Geography -------------------------------------------------------------------------

export type Geo = typeof import('@managemind/shared/geo');

let geo: Promise<Geo> | undefined;

/** Bangladesh's divisions, districts and areas: about 20 KB, loaded by the screens that pick a place. */
export const loadGeo = () => {
  geo ??= import('@managemind/shared/geo');
  return geo;
};

export const geoQuery = {
  queryKey: ['geo'] as const,
  queryFn: loadGeo,
  staleTime: Number.POSITIVE_INFINITY,
};

/** "Dhanmondi, Dhaka" from an order's stored names. */
export function placeLine(
  names: { area: Localized; district: Localized } | null | undefined,
  locale: Locale,
): string {
  if (!names) return '';
  return [pickText(names.area, locale), pickText(names.district, locale)]
    .filter(Boolean)
    .join(', ');
}

/** The order's lines as labels: "Rice 5 kg — Miniket × 2". */
export function lineLabel(
  line: { title: Localized; optionLabels: Localized[] },
  locale: Locale,
): string {
  const options = line.optionLabels.map((o) => pickText(o, locale)).filter(Boolean);
  return [pickText(line.title, locale), options.join(' / ')].filter(Boolean).join(' — ');
}

const ORDER_ERRORS = {
  insufficient_stock: 'orderError.stock',
  illegal_transition: 'orderError.state',
  limit_exceeded: 'orderError.limit',
  cod_unavailable: 'orderError.cod',
  promotion_unavailable: 'orderError.promotion',
  conflict: 'orderError.conflict',
  in_use: 'orderError.inUse',
} as const satisfies Record<string, AdminKey>;

/** saveErrorMessage, plus the reasons an order command is refused. */
export function orderErrorMessage(error: unknown, t: (key: AdminKey) => string): string {
  const code = error instanceof ApiError ? error.problem?.code : undefined;
  if (code && code in ORDER_ERRORS) return t(ORDER_ERRORS[code as keyof typeof ORDER_ERRORS]);
  return saveErrorMessage(error, t);
}
