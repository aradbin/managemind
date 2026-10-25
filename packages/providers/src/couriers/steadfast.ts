// Steadfast (phase-7-plan §3.2). From Steadfast's own Laravel package and
// the merchant API it wraps; to be checked against a real account (Q3):
// - `https://portal.packzy.com/api/v1`, with the `Api-Key` and `Secret-Key`
//   headers;
// - `create_order` takes a free-text address, so no area IDs, and an
//   invoice that must be unique;
// - `status_by_cid` and `status_by_invoice` answer `delivery_status` only;
// - `get_balance` proves the keys.
// Webhooks carry `Authorization: Bearer <the token set in the panel>`, with
// the consignment, invoice, status and amounts. There is no cancel call;
// staff cancel in the panel.
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

export const STEADFAST_BASE = 'https://portal.packzy.com/api/v1';

/** Steadfast's delivery statuses in our words (§3.2). Approval-pending ones wait for the final word. */
export const STEADFAST_STATUSES: Record<string, CourierUpdateKind> = {
  in_review: 'booked',
  pending: 'in_transit',
  hold: 'on_hold',
  delivered_approval_pending: 'on_hold',
  partial_delivered_approval_pending: 'on_hold',
  cancelled_approval_pending: 'on_hold',
  unknown_approval_pending: 'on_hold',
  delivered: 'delivered',
  partial_delivered: 'partial_delivered',
  cancelled: 'returning',
  unknown: 'unknown',
};

export const steadfastUpdate = (status: string): CourierUpdateKind =>
  STEADFAST_STATUSES[status] ?? 'unknown';

export function steadfastCourier(o: {
  apiKey: string;
  secretKey: string;
  fetch?: Fetch;
  base?: string;
}): CourierProvider {
  const f = o.fetch ?? fetch;
  const base = o.base ?? STEADFAST_BASE;
  const headers = {
    'Api-Key': o.apiKey,
    'Secret-Key': o.secretKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const get = (path: string) => courierCall(f, 'Steadfast', `${base}${path}`, { headers });
  const statusOf = (body: Record<string, unknown>): CourierStatus => {
    const status = String(body.delivery_status ?? 'unknown');
    return { status, update: steadfastUpdate(status), at: new Date() };
  };
  return {
    name: 'steadfast',
    async check() {
      const { body } = await get('/get_balance');
      if (Number(body.status) !== 200) {
        throw new CourierError('unauthorized', {
          refused: true,
          message: 'Steadfast refused the keys',
        });
      }
      return {};
    },
    async book(p): Promise<Booked> {
      const { body } = await courierCall(f, 'Steadfast', `${base}/create_order`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          invoice: p.invoice,
          recipient_name: p.name,
          recipient_phone: p.phone,
          recipient_address: p.address,
          cod_amount: p.codTaka,
          note: p.note,
          item_description: p.items,
        }),
      });
      const c = (body.consignment ?? null) as Record<string, unknown> | null;
      if (Number(body.status) !== 200 || !c?.consignment_id) {
        throw new CourierError('refused', {
          refused: true,
          message: `Steadfast: ${String(body.message ?? 'refused the parcel').slice(0, 200)}`,
        });
      }
      const status = String(c.status ?? 'in_review');
      return {
        consignmentId: String(c.consignment_id),
        trackingCode: c.tracking_code ? String(c.tracking_code) : null,
        status,
        update: steadfastUpdate(status),
        at: courierTime(c.created_at),
      };
    },
    async status(ref) {
      const path = ref.consignmentId
        ? `/status_by_cid/${encodeURIComponent(ref.consignmentId)}`
        : `/status_by_invoice/${encodeURIComponent(ref.invoice ?? '')}`;
      const { body } = await get(path);
      if (Number(body.status) !== 200) {
        throw new CourierError('not_found', {
          refused: true,
          message: 'Steadfast: no such parcel',
        });
      }
      return statusOf(body);
    },
    async findByInvoice(invoice) {
      try {
        const { body } = await get(`/status_by_invoice/${encodeURIComponent(invoice)}`);
        if (Number(body.status) !== 200) return null;
        // Steadfast answers the status only: the webhook fills in the consignment.
        return { ...statusOf(body), consignmentId: null, trackingCode: null };
      } catch (e) {
        if (e instanceof CourierError && e.refused) return null;
        throw e;
      }
    },
    parseWebhook(req, secret) {
      const auth = req.headers.get('authorization') ?? '';
      if (!sameSecret(auth, `Bearer ${secret}`)) return 'refused';
      const b = (req.body ?? {}) as Record<string, unknown>;
      return {
        consignmentId: b.consignment_id != null ? String(b.consignment_id) : undefined,
        invoice: typeof b.invoice === 'string' ? b.invoice : undefined,
        trackingCode: typeof b.tracking_code === 'string' ? b.tracking_code : undefined,
        codCollected: takaToPoisha(b.cod_amount),
        fee: takaToPoisha(b.delivery_charge),
      };
    },
    trackingUrl: (code) => `https://steadfast.com.bd/t/${encodeURIComponent(code)}`,
  };
}
