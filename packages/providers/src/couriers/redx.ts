// RedX (phase-7-plan §3.2). From RedX's OpenAPI as its SDKs use it; to be
// checked against its sandbox before stores are offered it:
// - `https://openapi.redx.com.bd/v1.0.0-beta` (sandbox
//   `sandbox.redx.com.bd/v1.0.0-beta`), with the store's token in
//   `API-ACCESS-TOKEN: Bearer …`;
// - a parcel needs RedX's delivery area and a pickup store;
// - `parcel/info/{tracking}` answers the status, and `PATCH parcels` can
//   cancel one.
// RedX's webhooks are not signed. They are believed only as far as naming a
// parcel: the handler asks RedX about it (§3.5).
import type { CourierUpdateKind } from '@managemind/shared/orders';
import {
  type Booked,
  CourierError,
  type CourierProvider,
  type CourierStatus,
  courierCall,
  courierTime,
  type Fetch,
  takaToPoisha,
} from './types';

export const REDX_HOSTS = {
  live: 'https://openapi.redx.com.bd/v1.0.0-beta',
  sandbox: 'https://sandbox.redx.com.bd/v1.0.0-beta',
} as const;

const REDX_STATUSES: Record<string, CourierUpdateKind> = {
  'pickup-pending': 'booked',
  'ready-for-delivery': 'in_transit',
  'delivery-in-progress': 'in_transit',
  'agent-hold': 'on_hold',
  'agent-area-change': 'on_hold',
  'agent-returning': 'returning',
  returned: 'returned',
  delivered: 'delivered',
  paid: 'paid_out',
  cancelled: 'cancelled',
};

export const redxUpdate = (status: string): CourierUpdateKind =>
  REDX_STATUSES[status.trim().toLowerCase()] ?? 'unknown';

export interface RedxOptions {
  mode: 'sandbox' | 'live';
  token: string;
  pickupStoreId?: number | undefined;
  fetch?: Fetch;
}

export function redxCourier(o: RedxOptions): CourierProvider & {
  places(): AsyncGenerator<{
    kind: 'area';
    externalId: number;
    parentId: null;
    name: string;
    districtName: string | null;
    postCode: string | null;
  }>;
} {
  const f = o.fetch ?? fetch;
  const base = REDX_HOSTS[o.mode];
  const headers = {
    'API-ACCESS-TOKEN': `Bearer ${o.token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const call = (path: string, init: RequestInit = {}) =>
    courierCall(f, 'RedX', `${base}${path}`, { ...init, headers });
  const statusOf = (p: Record<string, unknown>): CourierStatus => {
    const status = String(p.status ?? 'unknown');
    return {
      status,
      update: redxUpdate(status),
      at: courierTime(p.updated_at ?? p.timestamp),
      ...(redxUpdate(status) === 'delivered'
        ? { codCollected: takaToPoisha(p.cash_collection_amount) }
        : {}),
      fee: takaToPoisha(p.charge),
    };
  };
  return {
    name: 'redx',
    async check() {
      const { body } = await call('/pickup/stores');
      const list = Array.isArray(body.pickup_stores)
        ? (body.pickup_stores as Record<string, unknown>[])
        : [];
      return {
        pickupStores: list
          .map((s) => ({ id: Number(s.id), name: String(s.name ?? s.id) }))
          .filter((s) => Number.isInteger(s.id)),
      };
    },
    async book(p): Promise<Booked> {
      if (!p.place?.areaId) {
        throw new CourierError('no_area', { refused: true, message: "RedX: pick RedX's area" });
      }
      const { body } = await call('/parcel', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: p.name,
          customer_phone: p.phone,
          delivery_area: p.place.name ?? p.areaName,
          delivery_area_id: p.place.areaId,
          customer_address: p.address,
          merchant_invoice_id: p.invoice,
          cash_collection_amount: String(p.codTaka),
          parcel_weight: p.weightGrams,
          instruction: p.note,
          value: p.valueTaka,
          ...(o.pickupStoreId ? { pickup_store_id: o.pickupStoreId } : {}),
        }),
      });
      const id = body.tracking_id;
      if (!id) {
        throw new CourierError('refused', {
          refused: true,
          message: `RedX: ${String(body.message ?? 'refused the parcel').slice(0, 200)}`,
        });
      }
      return {
        consignmentId: String(id),
        trackingCode: String(id),
        status: 'pickup-pending',
        update: 'booked',
        at: new Date(),
      };
    },
    async status(ref) {
      if (!ref.consignmentId) {
        throw new CourierError('not_found', { refused: true, message: 'RedX: no tracking ID' });
      }
      const { body } = await call(`/parcel/info/${encodeURIComponent(ref.consignmentId)}`);
      return statusOf((body.parcel ?? {}) as Record<string, unknown>);
    },
    async cancel(ref) {
      if (!ref.consignmentId) return;
      await call('/parcels', {
        method: 'PATCH',
        body: JSON.stringify({
          entity_type: 'parcel-tracking-id',
          entity_id: ref.consignmentId,
          update_details: {
            property_name: 'status',
            new_value: 'cancelled',
            reason: 'Cancelled by the store',
          },
        }),
      });
    },
    parseWebhook(req) {
      const b = (req.body ?? {}) as Record<string, unknown>;
      return {
        consignmentId: b.tracking_number != null ? String(b.tracking_number) : undefined,
        invoice: typeof b.invoice_number === 'string' ? b.invoice_number : undefined,
      };
    },
    trackingUrl: (code) =>
      `https://redx.com.bd/track-parcel/?trackingId=${encodeURIComponent(code)}`,
    async *places() {
      const { body } = await call('/areas');
      const list = Array.isArray(body.areas) ? (body.areas as Record<string, unknown>[]) : [];
      for (const a of list) {
        const id = Number(a.id);
        if (!Number.isInteger(id)) continue;
        yield {
          kind: 'area',
          externalId: id,
          parentId: null,
          name: String(a.name),
          districtName: typeof a.district_name === 'string' ? a.district_name : null,
          postCode: a.post_code != null ? String(a.post_code) : null,
        };
      }
    },
  };
}
