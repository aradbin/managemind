// Resolves the store for every request before any page renders: the KV host
// map first, then the API over its service binding (ADR 0015). Pages read it
// from Astro.locals.

import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { uuidv7 } from '@managemind/shared';
import type { Locale } from '@managemind/shared/i18n';
import { captureException } from '@sentry/cloudflare';
import { DEV_STORE_COOKIE, lookupStore, resolveStoreHost, type StoreContext } from './lib/store';

export const onRequest = defineMiddleware(async (context, next) => {
  const url = context.url;
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

  const requestId = uuidv7();
  const store = await lookupStore(resolution.host, {
    ...(env.EDGE ? { kv: env.EDGE } : {}),
    api: async (host) => {
      const res = await env.API.fetch('https://api.internal/v1/store/context', {
        headers: { 'x-forwarded-host': host, 'x-request-id': requestId },
      });
      return res.status === 200 ? ((await res.json()) as StoreContext) : null;
    },
    onKvError: (e) => captureException(e, { tags: { request_id: requestId } }),
  });

  const lang = url.searchParams.get('lang');
  const locale: Locale = lang === 'bn' || lang === 'en' ? lang : (store?.defaultLocale ?? 'bn');
  Object.assign(context.locals, {
    store,
    host: resolution.host,
    devStore: resolution.devStore,
    locale,
    requestId,
  });
  try {
    return await next();
  } catch (e) {
    // Astro renders its 500 page for this; report it before it does.
    captureException(e, { tags: { request_id: requestId } });
    throw e;
  }
});
