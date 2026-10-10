// Resolves the store for every request through the API (service binding),
// before any page renders. Pages read it from Astro.locals.

import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { uuidv7 } from '@managemind/shared';
import type { Locale } from '@managemind/shared/i18n';
import { DEV_STORE_COOKIE, resolveStoreHost, type StoreContext } from './lib/store';

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
  const res = await env.API.fetch('https://api.internal/v1/store/context', {
    headers: { 'x-forwarded-host': resolution.host, 'x-request-id': requestId },
  });
  const store = res.status === 200 ? ((await res.json()) as StoreContext) : null;

  const lang = url.searchParams.get('lang');
  const locale: Locale = lang === 'bn' || lang === 'en' ? lang : (store?.defaultLocale ?? 'bn');
  Object.assign(context.locals, {
    store,
    host: resolution.host,
    devStore: resolution.devStore,
    locale,
    requestId,
  });
  return next();
});
