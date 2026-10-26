// Purchasing in the admin (phase-8-plan §3.12): the API's shapes, the
// queries the screens share, and small helpers for money and dates.
import type { paths } from '@managemind/sdk';
import type { Locale } from '@managemind/shared/i18n';
import { api, unwrap } from './api';
import { formatPrice } from './catalog';

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

export type Supplier = Json<'/v1/admin/suppliers/{id}', 'get'>;
export type SupplierLedger = Json<'/v1/admin/suppliers/{id}/ledger', 'get'>;
export type PurchaseOrder = Json<'/v1/admin/purchase-orders/{id}', 'get'>;
export type PurchaseOrderStatus = PurchaseOrder['status'];
export type PurchaseOrderSummary = Json<'/v1/admin/purchase-orders', 'get'>['items'][number];
export type PurchaseOrderBody = Body<'/v1/admin/purchase-orders', 'post'>;
export type ReorderLine = Json<'/v1/admin/purchase-orders/reorder', 'get'>['items'][number];
export type GoodsReceipt = Json<'/v1/admin/goods-receipts/{id}', 'get'>;
export type GoodsReceiptBody = Body<'/v1/admin/goods-receipts', 'post'>;
export type SupplierPayment = Json<'/v1/admin/supplier-payments', 'get'>['items'][number];
export type CostChange = Json<'/v1/admin/variants/{id}/cost-history', 'get'>['items'][number];

export const SPEND_METHODS = ['cash', 'bank', 'bkash', 'nagad', 'card', 'other'] as const;
export type SpendMethod = (typeof SPEND_METHODS)[number];

export const PO_STATUSES = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const satisfies readonly PurchaseOrderStatus[];

export const suppliersQuery = (filters: { q?: string; archived?: boolean } = {}) => ({
  queryKey: ['suppliers', filters] as const,
  queryFn: async () =>
    unwrap(
      await api.GET('/v1/admin/suppliers', {
        params: {
          query: {
            ...(filters.q ? { q: filters.q } : {}),
            ...(filters.archived ? { archived: 'true' as const } : {}),
          },
        },
      }),
    ).items,
});

export const supplierQuery = (id: string) => ({
  queryKey: ['supplier', id] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/suppliers/{id}', { params: { path: { id } } })),
});

export const supplierLedgerQuery = (id: string) => ({
  queryKey: ['supplier-ledger', id] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/suppliers/{id}/ledger', { params: { path: { id } } })),
});

export const purchaseOrderQuery = (id: string) => ({
  queryKey: ['purchase-order', id] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/purchase-orders/{id}', { params: { path: { id } } })),
});

export const costHistoryQuery = (variantId: string) => ({
  queryKey: ['cost-history', variantId] as const,
  queryFn: async () =>
    unwrap(
      await api.GET('/v1/admin/variants/{id}/cost-history', {
        params: { path: { id: variantId }, query: {} },
      }),
    ),
});

/** Everything the purchasing screens change, refetched after a write. */
export const PURCHASING_KEYS = [
  ['suppliers'],
  ['supplier'],
  ['supplier-ledger'],
  ['purchase-orders'],
  ['purchase-order'],
  ['goods-receipts'],
  ['inventory'],
  ['cost-history'],
] as const;

/** Poisha as money, or a dash. */
export const priceOrDash = (amount: number | null | undefined, locale: Locale) =>
  amount === null || amount === undefined ? '—' : formatPrice(amount, locale);

/** Today in Dhaka, for date inputs. */
export const dhakaToday = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

/** A whole number typed in Bangla or Western digits; NaN when it isn't one. */
export function readCount(text: string): number {
  const latin = text.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim();
  return /^\d+$/.test(latin) ? Number(latin) : Number.NaN;
}
