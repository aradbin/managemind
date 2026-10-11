// Spike: per-store cache invalidation on the Free plan (phase-0-plan §3.6, ADR 0007).
// Throwaway code. Pages are cached with the Cache API, tagged per store and per
// product, and purged from outside through the zone purge API (by tag, hostname,
// prefix and URL). The fallback keeps a per-store catalog version in KV and puts
// it in the cache key, so a bump makes old entries unreachable.

interface Env {
  KV: KVNamespace;
  SPIKE_TOKEN: string;
}

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ spike: 'cache', ...o }));

function render(
  mode: string,
  tenant: string,
  product: string,
  version: string | null,
  colo: string,
) {
  const body = JSON.stringify({ mode, tenant, product, version, renderedAt: Date.now(), colo });
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      // How long the Cache API keeps it; visitors get no-store (below).
      'cache-control': 'public, s-maxage=86400',
      'cache-tag': `tenant:${tenant},tenant:${tenant}:product:${product}`,
    },
  });
}

async function cached(
  key: string,
  ctx: ExecutionContext,
  make: () => Response,
): Promise<{ res: Response; hit: boolean }> {
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return { res: hit, hit: true };
  const res = make();
  ctx.waitUntil(cache.put(key, res.clone()));
  return { res, hit: false };
}

function toVisitor(res: Response, hit: boolean, colo: string, ms: number): Response {
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'no-store');
  out.headers.set('x-cache', hit ? 'HIT' : 'MISS');
  out.headers.set('x-colo', colo);
  out.headers.set('x-lookup-ms', String(ms));
  out.headers.delete('cache-tag');
  return out;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const colo = String(request.cf?.colo ?? '?');
    const parts = url.pathname.split('/').filter(Boolean);
    const t0 = Date.now();

    // /t/<tenant>/p/<product>: tagged entry, purged through the purge API.
    if (request.method === 'GET' && parts[0] === 't' && parts[2] === 'p' && parts.length === 4) {
      const [, tenant, , product] = parts as [string, string, string, string];
      const key = `https://${url.hostname}/t/${tenant}/p/${product}`;
      const { res, hit } = await cached(key, ctx, () => render('tag', tenant, product, null, colo));
      log({ mode: 'tag', tenant, product, hit, colo });
      return toVisitor(res, hit, colo, Date.now() - t0);
    }

    // /v/<tenant>/p/<product>: the fallback, a catalog version in the cache key.
    if (request.method === 'GET' && parts[0] === 'v' && parts[2] === 'p' && parts.length === 4) {
      const [, tenant, , product] = parts as [string, string, string, string];
      const ttl = Number(url.searchParams.get('ttl') ?? 60);
      const version = (await env.KV.get(`catalog-version:${tenant}`, { cacheTtl: ttl })) ?? '0';
      const key = `https://${url.hostname}/__v/${version}/t/${tenant}/p/${product}`;
      const { res, hit } = await cached(key, ctx, () =>
        render('version', tenant, product, version, colo),
      );
      log({ mode: 'version', tenant, product, version, hit, colo });
      const out = toVisitor(res, hit, colo, Date.now() - t0);
      out.headers.set('x-version', version);
      return out;
    }

    // POST /bump/<tenant>?k=<token>: what a debounced catalog change would do.
    if (request.method === 'POST' && parts[0] === 'bump' && parts.length === 2) {
      if (url.searchParams.get('k') !== env.SPIKE_TOKEN)
        return new Response('not found', { status: 404 });
      const version = String(Date.now());
      await env.KV.put(`catalog-version:${parts[1]}`, version);
      log({ mode: 'bump', tenant: parts[1], version, colo });
      return Response.json({ version, colo });
    }

    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
