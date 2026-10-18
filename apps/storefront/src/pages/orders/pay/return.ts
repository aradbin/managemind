// Where SSLCommerz sends the shopper back (phase-5a-plan §3.3): it posts the
// tran_id and val_id here. This page only shows: it hands them to the API,
// which validates with SSLCommerz exactly as the IPN does, then sends the
// shopper to the order's page with what happened.
import { env } from 'cloudflare:workers';
import { SHELL_PATHS } from '@managemind/shared/storefront/urls';
import type { APIRoute } from 'astro';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['success', 'failed', 'cancelled']);

const back: APIRoute = async ({ request, url, locals, redirect }) => {
  const status = STATUSES.has(url.searchParams.get('status') ?? '')
    ? (url.searchParams.get('status') as string)
    : 'failed';
  let tranId = url.searchParams.get('tran_id') ?? '';
  let valId = '';
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    tranId = String(form?.get('tran_id') ?? tranId);
    valId = String(form?.get('val_id') ?? '');
  }
  const track = `/${SHELL_PATHS.track}`;
  if (!UUID.test(tranId)) return redirect(track, 303);
  const res = await env.API.fetch('https://api.internal/v1/store/payments/return', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-host': locals.host,
      'x-request-id': locals.requestId,
      'x-shopper-ip': locals.shopperIp,
    },
    body: JSON.stringify({ status, tranId, ...(valId ? { valId: valId.slice(0, 100) } : {}) }),
  });
  if (!res.ok) return redirect(track, 303);
  const { viewToken, paid } = (await res.json()) as { viewToken: string; paid: boolean };
  const result = paid ? 'paid' : status === 'cancelled' ? 'cancelled' : 'failed';
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/${SHELL_PATHS.thanks}?payment=${result}#${viewToken}`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
};

export const GET = back;
export const POST = back;
