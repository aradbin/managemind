// What the storefront does with a request before rendering (phase-3-plan
// §3.3, §3.9): the bare store domain goes to the platform's site, a store
// with a primary custom domain redirects its other hosts there, and the
// default language's prefix is dropped. Pure, so it is unit-tested.
import type { Locale } from '@managemind/shared/i18n';
import { parseStorePath } from '@managemind/shared/storefront/urls';
import type { StoreContext } from './store';

export type Decision =
  | { type: 'redirect'; status: 301 | 302; location: string; cacheable: boolean }
  | { type: 'continue'; locale: Locale; prefixed: boolean };

export interface RoutingInput {
  url: URL;
  /** The request's host (or the dev selector's), lowercase. */
  host: string;
  store: StoreContext | null;
  environment: string;
  storeDomain: string;
  platformDomain: string | undefined;
  /** Set when the dev store selector chose the store (never in production). */
  devStore: string | null;
}

/** Paths that work on every host of a store, never redirected. */
const ANY_HOST = /^\/(api|media)\//;

export function decide(input: RoutingInput): Decision {
  const { url, store } = input;
  const production = input.environment === 'production';
  if (
    production &&
    !store &&
    (input.host === input.storeDomain || input.host === `stores.${input.storeDomain}`)
  ) {
    return {
      type: 'redirect',
      status: 302,
      location: `https://${input.platformDomain ?? input.storeDomain}/`,
      cacheable: false,
    };
  }
  if (!store) return { type: 'continue', locale: 'bn', prefixed: false };
  if (
    production &&
    !input.devStore &&
    store.primaryHost !== input.host &&
    !ANY_HOST.test(url.pathname)
  ) {
    return {
      type: 'redirect',
      status: 301,
      location: `https://${store.primaryHost}${url.pathname}${url.search}`,
      cacheable: true,
    };
  }
  const parsed = parseStorePath(url.pathname);
  const prefix = parsed.type === 'route' ? parsed.locale : null;
  if (prefix && prefix === store.defaultLocale) {
    // /bn/products/x on a Bangla store is /products/x.
    const rest = url.pathname.slice(3) || '/';
    return { type: 'redirect', status: 301, location: `${rest}${url.search}`, cacheable: true };
  }
  return { type: 'continue', locale: prefix ?? store.defaultLocale, prefixed: prefix !== null };
}
