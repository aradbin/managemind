// Spike: auth (docs/phases/phase-0-plan.md §3.4, ADR 0005).
// Throwaway code: two Better Auth instances on Workers with Drizzle.
// - Staff: platform schema, email + password, organization plugin.
// - Shoppers: store schema with tenant_id + FORCE RLS; every request runs
//   inside one tenant transaction, so Better Auth only ever sees one store.
import { AsyncLocalStorage } from 'node:async_hooks';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword as baHash } from 'better-auth/crypto';
import { emailOTP, organization } from 'better-auth/plugins';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { shopperSchema, staffSchema } from './schema';

interface Env {
  HYPERDRIVE: Hyperdrive;
  AUTH_SECRET: string;
  SPIKE_TOKEN: string;
  PBKDF2_ITERATIONS?: string;
}

const TENANTS: Record<string, string> = {
  A: '0199d000-0000-7000-8000-00000000000a',
  B: '0199d000-0000-7000-8000-00000000000b',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Db = NodePgDatabase;
type HashAlgo = 'scrypt' | 'pbkdf2';

// --- Instance caching. Building a Better Auth instance costs ~19 ms CPU, so
// the cached variant builds each instance once per isolate and gives it a
// database proxy that resolves to the current request's handle.
const requestDb = new AsyncLocalStorage<Db>();
const dbProxy = new Proxy({} as Db, {
  get(_target, prop) {
    const db = requestDb.getStore();
    if (!db) throw new Error('database used outside a request context');
    const value = Reflect.get(db, prop, db);
    return typeof value === 'function' ? value.bind(db) : value;
  },
});
const cachedAuth = new Map<string, { handler: (r: Request) => Promise<Response> }>();
function cached<T extends { handler: (r: Request) => Promise<Response> }>(
  key: string,
  make: () => T,
) {
  let auth = cachedAuth.get(key);
  if (!auth) {
    auth = make();
    cachedAuth.set(key, auth);
  }
  return auth;
}

// --- PBKDF2 on Web Crypto (native) as the alternative to Better Auth's scrypt.
const enc = new TextEncoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function pbkdf2Hasher(iterations: number) {
  return {
    hash: async (password: string) => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const dk = await pbkdf2(password, salt, iterations);
      return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(dk)}`;
    },
    verify: async ({ password, hash }: { password: string; hash: string }) => {
      const [scheme, iter, salt, expected] = hash.split('$');
      if (scheme !== 'pbkdf2-sha256' || !iter || !salt || !expected) return false;
      const dk = await pbkdf2(password, unb64(salt), Number(iter));
      const want = unb64(expected);
      return dk.length === want.length && crypto.subtle.timingSafeEqual(dk, want);
    },
  };
}

// --- Auth instances (created per request, because the database handle is).
function staffAuth(env: Env, db: Db, origin: string, algo: HashAlgo) {
  const iterations = Number(env.PBKDF2_ITERATIONS ?? 100_000);
  return betterAuth({
    baseURL: origin,
    basePath: '/staff/api/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: [origin],
    database: drizzleAdapter(db, { provider: 'pg', schema: staffSchema }),
    emailAndPassword:
      algo === 'pbkdf2' ? { enabled: true, password: pbkdf2Hasher(iterations) } : { enabled: true },
    plugins: [organization()],
    rateLimit: { enabled: false },
    advanced: { cookiePrefix: 'mm_staff', database: { generateId: false } },
  });
}

function shopperAuth(env: Env, db: Db, origin: string, storeKey: string, cookieCache = false) {
  return betterAuth({
    baseURL: origin,
    basePath: `/store/${storeKey}/api/auth`,
    secret: env.AUTH_SECRET,
    trustedOrigins: [origin],
    database: drizzleAdapter(db, { provider: 'pg', schema: shopperSchema }),
    plugins: [
      emailOTP({
        // Spike only: the code is read back from the database by the test
        // harness. Never log the code itself.
        sendVerificationOTP: async ({ email, type }) => {
          console.log(JSON.stringify({ spike: 'auth-otp', store: storeKey, email, type }));
        },
      }),
    ],
    rateLimit: { enabled: false },
    // Spike only: cookieCache on demand, to test cross-store replay.
    session: { cookieCache: { enabled: cookieCache, maxAge: 300 } },
    advanced: { cookiePrefix: 'mm_shop', database: { generateId: false } },
  });
}

// --- One tenant transaction around the whole shopper request (ADR 0002).
async function withTenant(
  env: Env,
  ctx: ExecutionContext,
  tenantId: string,
  fn: (db: Db) => Promise<Response>,
): Promise<Response> {
  if (!UUID.test(tenantId)) throw new Error('invalid tenant id');
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    await client.query(
      `begin; select set_config('app.tenant_id', '${tenantId}', true), set_config('app.tenant_at', now()::text, true)`,
    );
    const res = await fn(drizzle(client));
    await client.query(res.status >= 500 ? 'rollback' : 'commit');
    return res;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    ctx.waitUntil(client.end());
  }
}

async function withClient(env: Env, ctx: ExecutionContext, fn: (db: Db) => Promise<Response>) {
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    return await fn(drizzle(client));
  } finally {
    ctx.waitUntil(client.end());
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const key = url.searchParams.get('k') ?? request.headers.get('x-spike-key');
    if (key !== env.SPIKE_TOKEN) return new Response('not found', { status: 404 });
    const origin = url.origin;
    const algo: HashAlgo = request.headers.get('x-spike-hash') === 'pbkdf2' ? 'pbkdf2' : 'scrypt';

    // Pure CPU probes, no database.
    if (url.pathname === '/probe/hash') {
      const which = url.searchParams.get('algo') ?? 'scrypt';
      const iterations = Number(url.searchParams.get('iter') ?? 100_000);
      try {
        const out =
          which === 'pbkdf2'
            ? await pbkdf2Hasher(iterations).hash('correct horse battery staple')
            : await baHash('correct horse battery staple');
        return Response.json({ algo: which, iterations, length: out.length });
      } catch (e) {
        return Response.json({ algo: which, iterations, error: String(e) }, { status: 500 });
      }
    }
    if (url.pathname === '/probe/init') {
      // Builds both instances and waits for their lazy context, without any query.
      const db = drizzle(new pg.Client());
      const staff = staffAuth(env, db, origin, 'scrypt');
      const shop = shopperAuth(env, db, origin, 'A');
      await Promise.all([staff.$context, shop.$context]);
      return Response.json({ ok: true });
    }

    const useCache =
      request.headers.get('x-spike-cache') === '1' || url.searchParams.get('cache') === '1';

    if (url.pathname.startsWith('/staff/api/auth/')) {
      return withClient(env, ctx, (db) =>
        useCache
          ? requestDb.run(db, () =>
              cached(`staff:${algo}`, () => staffAuth(env, dbProxy, origin, algo)).handler(request),
            )
          : staffAuth(env, db, origin, algo).handler(request),
      );
    }

    const m = /^\/store\/([AB])\/api\/auth\//.exec(url.pathname);
    if (m?.[1]) {
      const storeKey = m[1];
      const tenantId = TENANTS[storeKey];
      if (!tenantId) return new Response('not found', { status: 404 });
      return withTenant(env, ctx, tenantId, (db) =>
        useCache
          ? requestDb.run(db, () =>
              cached(`shop:${storeKey}`, () => shopperAuth(env, dbProxy, origin, storeKey)).handler(
                request,
              ),
            )
          : shopperAuth(
              env,
              db,
              origin,
              storeKey,
              request.headers.get('x-spike-cc') === '1',
            ).handler(request),
      );
    }
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
