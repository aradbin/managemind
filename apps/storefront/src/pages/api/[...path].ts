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
];

export const ALL: APIRoute = async ({ request, params, url, locals }) => {
  const target = new URL(`https://api.internal/v1/store/${params.path ?? ''}`);
  target.search = url.search;
  const headers = new Headers({
    'x-forwarded-host': locals.host,
    'x-request-id': locals.requestId,
  });
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return env.API.fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    redirect: 'manual',
  });
};
