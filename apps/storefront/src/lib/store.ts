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
  /** A suspended store shows its maintenance page; a closed one answers 410. */
  status: 'active' | 'suspended' | 'closed';
  primaryHost: string;
}

/** The KV host map's value (ADR 0015), written by the API's outbox consumer. */
interface HostRecord {
  tenantId: string;
  slug: string;
  name: string;
  defaultLocale: 'bn' | 'en';
  status: 'active' | 'suspended' | 'closed';
  primaryHost: string;
}

export interface StoreLookup {
  /** The EDGE namespace; absent on previews and locally. */
  kv?: Pick<KVNamespace, 'get'>;
  /** Asks the API (GET /v1/store/context) about a host. */
  api: (host: string) => Promise<StoreContext | null>;
  onKvError?: (e: unknown) => void;
}

/**
 * The store for a host: the KV map first, then the API on a miss. The API
 * never writes KV, so a host that isn't a store costs one KV read and one
 * API call, and no KV write (ADR 0015).
 */
export async function lookupStore(
  host: string,
  { kv, api, onKvError }: StoreLookup,
): Promise<StoreContext | null> {
  if (kv) {
    try {
      const record = await kv.get<HostRecord>(`host:${host}`, 'json');
      if (record) {
        const { tenantId, ...rest } = record;
        return { id: tenantId, ...rest };
      }
    } catch (e) {
      // KV trouble falls back to the API rather than failing the page.
      onKvError?.(e);
    }
  }
  return api(host);
}

/**
 * The API's answer about a host (GET /v1/store/context). Only a 404 means no
 * store is there. Anything else, such as a request stopped at the Free plan's
 * CPU limit (ADR 0013), is tried once more and then fails the page with a
 * 5xx, so a store that exists never shows, or caches, the "store not found" page.
 */
export async function storeFromApi(call: () => Promise<Response>): Promise<StoreContext | null> {
  let problem: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await call();
      if (res.status === 200) return (await res.json()) as StoreContext;
      if (res.status === 404) return null;
      problem = new Error(`store context answered ${res.status}`);
    } catch (e) {
      problem = e;
    }
  }
  throw problem;
}

/** Stores found through the API, per isolate, for as long as its answer may be cached. */
const remembered = new Map<string, { store: StoreContext; until: number }>();
const REMEMBER_MS = 60_000;

/**
 * storeFromApi, remembered for a minute per isolate (the API sends
 * `Cache-Control: max-age=60`), so a page miss on a host the KV map doesn't
 * hold costs one API call, not two. Only found stores are kept.
 */
export async function rememberedStoreFromApi(
  host: string,
  call: () => Promise<Response>,
  now = Date.now(),
): Promise<StoreContext | null> {
  const hit = remembered.get(host);
  if (hit && hit.until > now) return hit.store;
  const store = await storeFromApi(call);
  if (store) {
    if (remembered.size >= 500) remembered.clear();
    remembered.set(host, { store, until: now + REMEMBER_MS });
  } else {
    remembered.delete(host);
  }
  return store;
}
