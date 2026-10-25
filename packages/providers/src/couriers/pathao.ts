// Pathao (phase-7-plan §3.2). From Pathao's merchant API as its SDKs use it;
// to be checked against its sandbox before stores are offered it:
// - `https://api-hermes.pathao.com` (sandbox `courier-api-sandbox.pathao.com`),
//   under `/aladdin/api/v1`;
// - an OAuth password grant with the merchant's panel login (Q6), renewed
//   with the refresh token and sealed back with the store's credentials;
// - orders need Pathao's city and zone (and optionally area) IDs, and a
//   pickup store;
// - `orders/{id}/info` answers the status.
// Its webhooks carry `X-PATHAO-Signature`, checked against the store's
// secret, and Pathao may ask for an integration header in the reply, which
// the store copies from Pathao into its settings. Pathao's API has no
// cancel or search by our invoice that we rely on: staff use its panel.
import type { CourierUpdateKind } from '@managemind/shared/orders';
import {
  type Booked,
  CourierError,
  type CourierProvider,
  type CourierStatus,
  courierCall,
  courierTime,
  type Fetch,
  sameSecret,
  takaToPoisha,
} from './types';

export const PATHAO_HOSTS = {
  live: 'https://api-hermes.pathao.com',
  sandbox: 'https://courier-api-sandbox.pathao.com',
} as const;

/** Pathao's order statuses in our words (§3.2), compared without case or separators. */
const PATHAO_STATUSES: Record<string, CourierUpdateKind> = {
  pending: 'booked',
  pickup_requested: 'booked',
  assigned_for_pickup: 'booked',
  pickup_failed: 'on_hold',
  pickup_cancelled: 'cancelled',
  picked: 'picked_up',
  at_the_sorting_hub: 'in_transit',
  in_transit: 'in_transit',
  received_at_last_mile_hub: 'in_transit',
  assigned_for_delivery: 'in_transit',
  on_hold: 'on_hold',
  delivered: 'delivered',
  partial_delivery: 'partial_delivered',
  delivery_failed: 'returning',
  return: 'returning',
  returned: 'returned',
  paid_return: 'returned',
  payment_invoice: 'paid_out',
  paid: 'paid_out',
};

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^order\./, '')
    .replace(/[\s.-]+/g, '_');

export const pathaoUpdate = (status: string): CourierUpdateKind =>
  PATHAO_STATUSES[slug(status)] ?? 'unknown';

export interface PathaoOptions {
  mode: 'sandbox' | 'live';
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  /** Seconds since the epoch. */
  expiresAt?: number | undefined;
  storeId?: number | undefined;
  deliveryType?: number | undefined;
  itemType?: number | undefined;
  /** The value Pathao asks to see in a webhook's reply, when it asks. */
  integrationSecret?: string | undefined;
  fetch?: Fetch;
  /** Seals renewed tokens back with the store's credentials. */
  saveTokens?: (tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  }) => Promise<void>;
  now?: () => number;
}

/** A list in Pathao's `{ data: { data: [...] } }` envelope, or its plain `data` array. */
function listOf(body: Record<string, unknown>): Record<string, unknown>[] {
  const d = body.data as { data?: unknown } | unknown[] | undefined;
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  return Array.isArray(d?.data) ? (d.data as Record<string, unknown>[]) : [];
}

export function pathaoCourier(o: PathaoOptions): CourierProvider & {
  places(): AsyncGenerator<{
    kind: 'city' | 'zone' | 'area';
    externalId: number;
    parentId: number | null;
    name: string;
  }>;
} {
  const f = o.fetch ?? fetch;
  const base = `${PATHAO_HOSTS[o.mode]}/aladdin/api/v1`;
  const now = o.now ?? (() => Math.floor(Date.now() / 1000));
  let token = o.accessToken && (o.expiresAt ?? 0) > now() + 3600 ? o.accessToken : null;

  async function issue(): Promise<string> {
    const grant =
      o.refreshToken && o.accessToken
        ? { grant_type: 'refresh_token', refresh_token: o.refreshToken }
        : { grant_type: 'password', username: o.username, password: o.password };
    const { body } = await courierCall(f, 'Pathao', `${base}/issue-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: o.clientId, client_secret: o.clientSecret, ...grant }),
    }).catch(async (e: unknown) => {
      // A refresh token past its life: sign in with the login again.
      if (grant.grant_type === 'refresh_token' && e instanceof CourierError && e.refused) {
        return courierCall(f, 'Pathao', `${base}/issue-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            client_id: o.clientId,
            client_secret: o.clientSecret,
            grant_type: 'password',
            username: o.username,
            password: o.password,
          }),
        });
      }
      throw e;
    });
    const access = typeof body.access_token === 'string' ? body.access_token : null;
    if (!access) {
      throw new CourierError('unauthorized', {
        refused: true,
        message: 'Pathao refused the login',
      });
    }
    const expiresAt = now() + (Number(body.expires_in) || 3600);
    const refresh = typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
    await o.saveTokens?.({
      accessToken: access,
      ...(refresh ? { refreshToken: refresh } : {}),
      expiresAt,
    });
    return access;
  }

  async function call(path: string, init: RequestInit = {}) {
    token ??= await issue();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    try {
      return await courierCall(f, 'Pathao', `${base}${path}`, { ...init, headers });
    } catch (e) {
      // An access token Pathao no longer takes: once more with a new one.
      if (e instanceof CourierError && e.code === 'http_401') {
        token = await issue();
        return courierCall(f, 'Pathao', `${base}${path}`, {
          ...init,
          headers: { ...headers, Authorization: `Bearer ${token}` },
        });
      }
      throw e;
    }
  }

  const statusOf = (d: Record<string, unknown>): CourierStatus => {
    const status = String(d.order_status_slug ?? d.order_status ?? 'unknown');
    return {
      status,
      update: pathaoUpdate(status),
      at: courierTime(d.updated_at),
      codCollected: takaToPoisha(d.collected_amount),
      fee: takaToPoisha(d.delivery_fee),
    };
  };

  return {
    name: 'pathao',
    async check() {
      const { body } = await call('/stores');
      const stores = listOf(body)
        .map((s) => ({ id: Number(s.store_id), name: String(s.store_name ?? s.store_id) }))
        .filter((s) => Number.isInteger(s.id));
      return { pickupStores: stores };
    },
    async book(p): Promise<Booked> {
      if (!o.storeId) {
        throw new CourierError('no_store', {
          refused: true,
          message: 'Pathao: choose a pickup store',
        });
      }
      if (!p.place?.cityId || !p.place.zoneId) {
        throw new CourierError('no_area', { refused: true, message: "Pathao: pick Pathao's area" });
      }
      const { body } = await call('/orders', {
        method: 'POST',
        body: JSON.stringify({
          store_id: o.storeId,
          merchant_order_id: p.invoice,
          recipient_name: p.name,
          recipient_phone: p.phone,
          recipient_address: p.address,
          recipient_city: p.place.cityId,
          recipient_zone: p.place.zoneId,
          ...(p.place.areaId ? { recipient_area: p.place.areaId } : {}),
          delivery_type: o.deliveryType ?? 48,
          item_type: o.itemType ?? 2,
          special_instruction: p.note,
          item_quantity: p.itemCount,
          item_weight: Math.max(0.5, Math.round(p.weightGrams / 100) / 10),
          item_description: p.items,
          amount_to_collect: p.codTaka,
        }),
      });
      const d = (body.data ?? {}) as Record<string, unknown>;
      if (!d.consignment_id) {
        throw new CourierError('refused', {
          refused: true,
          message: `Pathao: ${String(body.message ?? 'refused the parcel').slice(0, 200)}`,
        });
      }
      const status = String(d.order_status ?? 'Pending');
      return {
        consignmentId: String(d.consignment_id),
        trackingCode: String(d.consignment_id),
        status,
        update: pathaoUpdate(status),
        at: new Date(),
        fee: takaToPoisha(d.delivery_fee),
      };
    },
    async status(ref) {
      if (!ref.consignmentId) {
        throw new CourierError('not_found', { refused: true, message: 'Pathao: no consignment' });
      }
      const { body } = await call(`/orders/${encodeURIComponent(ref.consignmentId)}/info`);
      return statusOf((body.data ?? {}) as Record<string, unknown>);
    },
    parseWebhook(req, secret) {
      const signature = req.headers.get('x-pathao-signature') ?? '';
      if (!signature || !sameSecret(signature, secret)) return 'refused';
      const b = (req.body ?? {}) as Record<string, unknown>;
      return {
        consignmentId: b.consignment_id != null ? String(b.consignment_id) : undefined,
        invoice: typeof b.merchant_order_id === 'string' ? b.merchant_order_id : undefined,
        codCollected: takaToPoisha(b.collected_amount),
        fee: takaToPoisha(b.delivery_fee),
      };
    },
    ...(o.integrationSecret
      ? {
          webhookReply: () => ({
            status: 202,
            headers: { 'X-Pathao-Merchant-Webhook-Integration-Secret': o.integrationSecret ?? '' },
          }),
        }
      : {}),
    trackingUrl: (code) =>
      `https://merchant.pathao.com/tracking?consignment_id=${encodeURIComponent(code)}`,
    async *places() {
      const { body: cities } = await call('/city-list');
      for (const c of listOf(cities)) {
        const cityId = Number(c.city_id);
        if (!Number.isInteger(cityId)) continue;
        yield { kind: 'city', externalId: cityId, parentId: null, name: String(c.city_name) };
        const { body: zones } = await call(`/cities/${cityId}/zone-list`);
        for (const z of listOf(zones)) {
          const zoneId = Number(z.zone_id);
          if (!Number.isInteger(zoneId)) continue;
          yield { kind: 'zone', externalId: zoneId, parentId: cityId, name: String(z.zone_name) };
          const { body: areas } = await call(`/zones/${zoneId}/area-list`);
          for (const a of listOf(areas)) {
            const areaId = Number(a.area_id);
            if (!Number.isInteger(areaId)) continue;
            yield { kind: 'area', externalId: areaId, parentId: zoneId, name: String(a.area_name) };
          }
        }
      }
    },
  };
}
