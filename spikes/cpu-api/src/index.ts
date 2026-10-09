// Spike: CPU budget and bundle size, API side (phase-0-plan §3.2–3.3,
// ADRs 0003 and 0004). Throwaway code, but built the way the real API will be:
// Hono with zod-openapi, Drizzle over Hyperdrive, one Better Auth staff
// instance per request (ADR 0013), output validated with zod, Sentry SDK.
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import * as Sentry from '@sentry/cloudflare';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { staffSchema } from '../../auth/src/schema';

interface Env {
  HYPERDRIVE: Hyperdrive;
  AUTH_SECRET: string;
  SPIKE_TOKEN: string;
  SENTRY_DSN?: string;
}

const TENANTS: Record<string, string> = {
  A: '0199d000-0000-7000-8000-00000000000a',
  B: '0199d000-0000-7000-8000-00000000000b',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const Product = z
  .object({
    id: z.uuid(),
    title: z.string(),
    price: z.number().int(),
    currency: z.literal('BDT'),
    description: z.string(),
    createdAt: z.string(),
  })
  .openapi('Product');
const ProductList = z
  .object({
    items: z.array(Product),
    total: z.number().int(),
    featured: Product.nullable(),
    priceRange: z.object({ min: z.number().int(), max: z.number().int() }),
  })
  .openapi('ProductList');
const ProductDetail = z
  .object({ product: Product, related: z.array(Product) })
  .openapi('ProductDetail');
const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  code: z.string(),
});

type Row = { id: string; title: string; price: string | number; created_at: Date | string };
const toProduct = (r: Row) => ({
  id: r.id,
  title: r.title,
  price: Number(r.price),
  currency: 'BDT' as const,
  // Pads the payload to a realistic size (about 5 KB for 20 items).
  description: `${r.title}. Cotton, machine washable, made in Bangladesh. Delivery in 2–3 days inside Dhaka.`,
  createdAt: new Date(r.created_at).toISOString(),
});

function staffAuth(env: Env, db: NodePgDatabase, origin: string) {
  return betterAuth({
    baseURL: origin,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: [origin],
    database: drizzleAdapter(db, { provider: 'pg', schema: staffSchema }),
    // Spike setup only: a password account to obtain a session cookie.
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    advanced: { cookiePrefix: 'mm_staff', database: { generateId: false } },
  });
}

async function connect(env: Env) {
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  return client;
}

const setTenant = (tenantId: string) => {
  if (!UUID.test(tenantId)) throw new Error('invalid tenant id');
  return `select set_config('app.tenant_id', '${tenantId}', true), set_config('app.tenant_at', now()::text, true)`;
};

type AppEnv = { Bindings: Env };
const app = new OpenAPIHono<AppEnv>();

app.use('*', async (c, next) => {
  const key = c.req.query('k') ?? c.req.header('x-spike-key');
  if (key !== c.env.SPIKE_TOKEN) return c.text('not found', 404);
  await next();
  if (c.req.query('trace') === '1') {
    const t = await fetch('https://www.cloudflare.com/cdn-cgi/trace').then((r) => r.text());
    c.header('x-exec-colo', /colo=([A-Z]+)/.exec(t)?.[1] ?? 'unknown');
  }
  return;
});

app.get('/health', (c) => c.json({ status: 'ok' }));
app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
  const client = await connect(c.env);
  try {
    return await staffAuth(c.env, drizzle(client), new URL(c.req.url).origin).handler(c.req.raw);
  } finally {
    c.executionCtx.waitUntil(client.end());
  }
});

// The "typical API request": session check, tenant transaction, 4 queries,
// zod-validated JSON of about 5 KB.
const adminProducts = createRoute({
  method: 'get',
  path: '/v1/admin/products',
  responses: {
    200: { content: { 'application/json': { schema: ProductList } }, description: 'Products' },
    401: {
      content: { 'application/problem+json': { schema: Problem } },
      description: 'No session',
    },
  },
});
app.openapi(adminProducts, async (c) => {
  const client = await connect(c.env);
  try {
    await client.query('begin');
    const db = drizzle(client);
    const session = await staffAuth(c.env, db, new URL(c.req.url).origin).api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session) {
      await client.query('rollback');
      return c.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'unauthorized' },
        401,
      );
    }
    await client.query(setTenant(TENANTS.A as string));
    const total = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from store.notes_guarded`,
    );
    const list = await db.execute<Row>(
      sql`select id, title, price, created_at from store.notes_guarded order by created_at desc limit 20`,
    );
    const range = await db.execute<{ min: number; max: number }>(
      sql`select min(price)::int as min, max(price)::int as max from store.notes_guarded`,
    );
    const featuredId = list.rows[0]?.id ?? '00000000-0000-0000-0000-000000000000';
    const featured = await db.execute<Row>(
      sql`select id, title, price, created_at from store.notes_guarded where id = ${featuredId}`,
    );
    await client.query('commit');
    const body = ProductList.parse({
      items: list.rows.map(toProduct),
      total: total.rows[0]?.n ?? 0,
      featured: featured.rows[0] ? toProduct(featured.rows[0]) : null,
      priceRange: { min: range.rows[0]?.min ?? 0, max: range.rows[0]?.max ?? 0 },
    });
    return c.json(body, 200);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.executionCtx.waitUntil(client.end());
  }
});

// Anonymous store routes (the storefront calls these over its service binding).
const storeProducts = createRoute({
  method: 'get',
  path: '/v1/store/products',
  responses: {
    200: { content: { 'application/json': { schema: ProductList } }, description: 'Products' },
  },
});
app.openapi(storeProducts, async (c) => {
  const tenant = TENANTS[c.req.header('x-store') ?? 'A'] ?? (TENANTS.A as string);
  const client = await connect(c.env);
  try {
    await client.query(`begin; ${setTenant(tenant)}`);
    const db = drizzle(client);
    const list = await db.execute<Row>(
      sql`select id, title, price, created_at from store.notes_guarded order by created_at desc limit 20`,
    );
    await client.query('commit');
    const items = list.rows.map(toProduct);
    return c.json(
      ProductList.parse({
        items,
        total: items.length,
        featured: items[0] ?? null,
        priceRange: { min: 0, max: 0 },
      }),
      200,
    );
  } finally {
    c.executionCtx.waitUntil(client.end());
  }
});

const storeProduct = createRoute({
  method: 'get',
  path: '/v1/store/products/{id}',
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { content: { 'application/json': { schema: ProductDetail } }, description: 'Product' },
    404: { content: { 'application/problem+json': { schema: Problem } }, description: 'Not found' },
  },
});
app.openapi(storeProduct, async (c) => {
  const { id } = c.req.valid('param');
  const tenant = TENANTS[c.req.header('x-store') ?? 'A'] ?? (TENANTS.A as string);
  const client = await connect(c.env);
  try {
    await client.query(`begin; ${setTenant(tenant)}`);
    const db = drizzle(client);
    const product = await db.execute<Row>(
      sql`select id, title, price, created_at from store.notes_guarded where id = ${id}`,
    );
    const related = await db.execute<Row>(
      sql`select id, title, price, created_at from store.notes_guarded where id <> ${id} order by created_at desc limit 8`,
    );
    await client.query('commit');
    const row = product.rows[0];
    if (!row) {
      return c.json(
        { type: 'about:blank', title: 'Not found', status: 404, code: 'not_found' },
        404,
      );
    }
    return c.json(
      ProductDetail.parse({ product: toProduct(row), related: related.rows.map(toProduct) }),
      200,
    );
  } finally {
    c.executionCtx.waitUntil(client.end());
  }
});

app.doc('/openapi.json', { openapi: '3.1.0', info: { title: 'managemind spike', version: '0' } });

export default Sentry.withSentry(
  (env: Env) => ({ dsn: env.SENTRY_DSN, enabled: Boolean(env.SENTRY_DSN), tracesSampleRate: 0 }),
  { fetch: app.fetch } satisfies ExportedHandler<Env>,
);
