// Runs on every page miss before any page renders (the page cache answers
// hits before this, in worker.ts). It resolves the store from the host (the
// KV host map, then the API; ADR 0015), applies the redirects of
// lib/routing.ts, picks the page's language from its path, and handles the
// theme preview: /__preview?token= sets a short-lived cookie, and while it is
// there pages render with the draft theme, never cached and only framed by
// the admin (phase-3-plan §3.4).
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { uuidv7 } from '@managemind/shared';
import { storeTag } from '@managemind/shared/storefront/cache';
import { captureException } from '@sentry/cloudflare';
import { CACHE_TAGS_HEADER } from './lib/cache';
import { decide } from './lib/routing';
import { DEV_STORE_COOKIE, lookupStore, resolveStoreHost, type StoreContext } from './lib/store';

export const PREVIEW_COOKIE = 'mm_preview';
const PREVIEW_TOKEN = /^[0-9a-f-]{36}\.\d{1,12}\.[A-Za-z0-9_-]{43}$/;

/** Who may frame preview pages: the admin, and locally its dev servers. */
function frameAncestors(): string {
  if (env.ENVIRONMENT === 'development')
    return "'self' http://localhost:8787 http://localhost:5173";
  return env.ADMIN_HOST ? `https://${env.ADMIN_HOST}` : "'none'";
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = context.url;
  const requestId = uuidv7();

  // Entering the preview: remember the token for 15 minutes, then show the page.
  if (url.pathname === '/__preview') {
    const token = url.searchParams.get('token') ?? '';
    const target = url.searchParams.get('path') ?? '/';
    const location = new URL(
      target.startsWith('/') && !target.startsWith('//') ? target : '/',
      url,
    );
    // Keep the dev store selector working inside the preview (previews, locally).
    const store = url.searchParams.get('store');
    if (store) location.searchParams.set('store', store);
    const headers = new Headers({
      Location: `${location.pathname}${location.search}`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    });
    if (PREVIEW_TOKEN.test(token)) {
      // Partitioned (CHIPS): the preview runs in the admin's iframe, on another site.
      headers.append(
        'Set-Cookie',
        `${PREVIEW_COOKIE}=${token}; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=None; Partitioned`,
      );
    }
    return new Response(null, { status: 302, headers });
  }

  const resolution = resolveStoreHost({
    host: url.host,
    storeParam: url.searchParams.get('store'),
    storeCookie: context.cookies.get(DEV_STORE_COOKIE)?.value ?? null,
    environment: env.ENVIRONMENT,
    storeDomain: env.STORE_DOMAIN,
  });
  if (resolution.cookie && 'set' in resolution.cookie) {
    context.cookies.set(DEV_STORE_COOKIE, resolution.cookie.set, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
  } else if (resolution.cookie) {
    context.cookies.delete(DEV_STORE_COOKIE, { path: '/' });
  }

  const store: StoreContext | null = await lookupStore(resolution.host, {
    ...(env.EDGE ? { kv: env.EDGE } : {}),
    api: async (host) => {
      const res = await env.API.fetch('https://api.internal/v1/store/context', {
        headers: { 'x-forwarded-host': host, 'x-request-id': requestId },
      });
      return res.status === 200 ? ((await res.json()) as StoreContext) : null;
    },
    onKvError: (e) => captureException(e, { tags: { request_id: requestId } }),
  });

  const decision = decide({
    url,
    host: resolution.host,
    store,
    environment: env.ENVIRONMENT,
    storeDomain: env.STORE_DOMAIN,
    platformDomain: env.PLATFORM_DOMAIN,
    devStore: resolution.devStore,
  });
  if (decision.type === 'redirect') {
    const headers = new Headers({ Location: decision.location });
    if (decision.cacheable && store) headers.set(CACHE_TAGS_HEADER, storeTag(store.id));
    return new Response(null, { status: decision.status, headers });
  }

  const preview = context.cookies.get(PREVIEW_COOKIE)?.value ?? null;
  const previewToken = preview && PREVIEW_TOKEN.test(preview) ? preview : null;
  Object.assign(context.locals, {
    store,
    host: resolution.host,
    devStore: resolution.devStore,
    locale: decision.locale,
    prefixed: decision.prefixed,
    requestId,
    previewToken,
    shopperIp: context.request.headers.get('cf-connecting-ip') ?? '',
  });

  let response: Response;
  try {
    response = await next();
  } catch (e) {
    // Astro renders its 500 page for this; report it before it does.
    captureException(e, { tags: { request_id: requestId } });
    throw e;
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (previewToken) {
    response.headers.delete(CACHE_TAGS_HEADER);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    response.headers.set('Content-Security-Policy', `frame-ancestors ${frameAncestors()}`);
  } else {
    response.headers.set('Content-Security-Policy', "frame-ancestors 'self'");
  }
  return response;
});
