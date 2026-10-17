// {store host}/api/* is forwarded to the API's /v1/store/* over the service
// binding, with the store's host, so shopper cookies stay first-party on the
// store's own domain and no CORS is needed (PLAN.md domains and routing).

import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';

const FORWARDED_HEADERS = [
  'accept',
  'content-type',
  'cookie',
  'idempotency-key',
  'accept-language',
  // Checkout keeps the user agent with the order.
  'user-agent',
  // Shopper sign-in code requests carry their Turnstile token here (§3.15).
  'x-turnstile-token',
];

/**
 * A browser's write must come from this host's own pages (no Origin: older
 * browsers, where SameSite=Lax cookies still protect the cart). Checked here,
 * against the host the browser sees: in development and on previews the
 * store host the API gets is the dev selector's, not the page's.
 */
function sameOrigin(request: Request, url: URL): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

const forward: APIRoute = async ({ request, params, url, locals }) => {
  if (!sameOrigin(request, url)) {
    return new Response(JSON.stringify({ status: 403, code: 'forbidden', title: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/problem+json', 'X-Astro-Reroute': 'no' },
    });
  }
  const target = new URL(`https://api.internal/v1/store/${params.path ?? ''}`);
  target.search = url.search;
  const headers = new Headers({
    'x-forwarded-host': locals.host,
    'x-request-id': locals.requestId,
    // Rate limits and the order's IP (phase-4-plan §3.15); the API trusts it
    // only over the service binding.
    'x-shopper-ip': locals.shopperIp,
  });
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const res = await env.API.fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    redirect: 'manual',
  });
  // A copy: the fetched response's headers are immutable, and the middleware
  // adds its own. X-Astro-Reroute keeps an API 404 (a problem body) from
  // being replaced with the store's 404 page.
  const out = new Response(res.body, res);
  out.headers.set('X-Astro-Reroute', 'no');
  return out;
};

// Each method by name: this Astro version doesn't route `ALL` (no page used
// /api/* from a browser before the cart).
export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
