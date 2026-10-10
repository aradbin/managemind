// Which store a request is for. Shoppers reach a store on its own host
// ({slug}.<STORE_DOMAIN>, or a custom domain from Phase 3). On workers.dev
// previews and localhost, the dev store selector (?store=<slug>, remembered
// in a cookie) stands in for the host; it is never active in production.

export const DEV_STORE_COOKIE = 'dev_store';
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export interface StoreRequest {
  /** The request's host, without port. */
  host: string;
  /** Value of ?store=, if present (empty string clears the selection). */
  storeParam: string | null;
  /** Value of the dev_store cookie, if any. */
  storeCookie: string | null;
  environment: string;
  storeDomain: string;
}

export interface StoreResolution {
  /** The host to ask the API about (X-Forwarded-Host). */
  host: string;
  /** The store chosen with the dev selector, if one is active. */
  devStore: string | null;
  /** What to do with the dev_store cookie. */
  cookie: { set: string } | { clear: true } | null;
}

export function resolveStoreHost(req: StoreRequest): StoreResolution {
  const host = req.host.toLowerCase().replace(/:\d+$/, '');
  if (req.environment === 'production') return { host, devStore: null, cookie: null };

  if (req.storeParam !== null) {
    if (req.storeParam === '') return { host, devStore: null, cookie: { clear: true } };
    if (SLUG.test(req.storeParam)) {
      return {
        host: `${req.storeParam}.${req.storeDomain}`,
        devStore: req.storeParam,
        cookie: { set: req.storeParam },
      };
    }
  }
  if (req.storeCookie && SLUG.test(req.storeCookie)) {
    return {
      host: `${req.storeCookie}.${req.storeDomain}`,
      devStore: req.storeCookie,
      cookie: null,
    };
  }
  return { host, devStore: null, cookie: null };
}

export interface StoreContext {
  id: string;
  slug: string;
  name: string;
  defaultLocale: 'bn' | 'en';
}
