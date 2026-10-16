// Settings > Domains under /v1/admin (phase-3-plan §3.9, §6.2): list, add,
// check now, make primary, remove. `settings.write` for everything but the
// list (Q10). Another store's domain IDs answer 404, and every route with an
// ID is in the isolation suite.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  addDomain,
  checkDomain,
  type Domain,
  listDomains,
  makePrimaryDomain,
  removeDomain,
} from '@managemind/core';
import { captureException } from '@sentry/cloudflare';
import type { Context } from 'hono';
import { dnsInstructions, hostnameProvider, scheduleDomainChecks } from '../domains';
import { createLimiter } from '../rate-limit/index';
import { inStore, type StaffEnv } from './context';
import { storeUrls } from './store-urls';

const Id = z.object({ id: z.uuid() });
const DnsRecord = z.object({ type: z.enum(['CNAME', 'TXT']), name: z.string(), value: z.string() });
const DomainSchema = z
  .object({
    id: z.uuid(),
    hostname: z.string(),
    status: z.enum(['pending', 'active', 'failed', 'removed']),
    isPrimary: z.boolean(),
    sslStatus: z.string().nullable(),
    verifiedAt: z.string().nullable(),
    lastCheckedAt: z.string().nullable(),
    checkAttempts: z.number().int(),
    failureReason: z.string().nullable(),
    createdAt: z.string(),
    /** What to add at the client's DNS provider. */
    dns: z.array(DnsRecord),
  })
  .openapi('Domain');
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });

export const DOMAIN_ROUTES = {
  domains: r({
    method: 'get',
    path: '/domains',
    summary: 'The store’s default address and custom domains (settings.read)',
    responses: json(
      z.object({
        defaultHost: z.string(),
        primaryHost: z.string(),
        domains: z.array(DomainSchema),
      }),
      'Domains',
    ),
  }),
  addDomain: r({
    method: 'post',
    path: '/domains',
    summary: 'Connect a domain, such as www.shop.com.bd (settings.write)',
    request: {
      body: {
        content: {
          'application/json': { schema: z.object({ hostname: z.string().min(3).max(253) }) },
        },
        required: true,
      },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: DomainSchema } },
        description: 'Added, pending',
      },
    },
  }),
  checkDomain: r({
    method: 'post',
    path: '/domains/{id}/check',
    summary: 'Check a domain now (settings.write; 20 an hour per store)',
    request: { params: Id },
    responses: json(DomainSchema, 'Checked'),
  }),
  makePrimaryDomain: r({
    method: 'post',
    path: '/domains/{id}/primary',
    summary: 'Make an active domain the store’s primary address (settings.write)',
    request: { params: Id },
    responses: json(DomainSchema, 'Primary'),
  }),
  removeDomain: r({
    method: 'delete',
    path: '/domains/{id}',
    summary: 'Disconnect a domain (settings.write)',
    request: { params: Id },
    responses: { 204: { description: 'Removed' } },
  }),
} as const;

export function registerDomains(admin: OpenAPIHono<StaffEnv>): void {
  const R = DOMAIN_ROUTES;
  const actor = (c: Context<StaffEnv>) => c.var.staff.actor;
  const write = { write: true };
  const view = (c: Context<StaffEnv>, d: Domain) => {
    const { ownershipRecord, ...rest } = d;
    return {
      ...rest,
      dns: dnsInstructions(d.hostname, ownershipRecord, c.var.config.STORE_DOMAIN),
    };
  };
  const provider = (c: Context<StaffEnv>) => hostnameProvider(c.env, c.var.config);
  const rules = (c: Context<StaffEnv>) => ({
    platformDomain: c.var.config.PLATFORM_DOMAIN,
    storeDomain: c.var.config.STORE_DOMAIN,
  });

  admin.openapi(R.domains, async (c) =>
    c.json(
      await inStore(c, async (tx) => {
        const urls = await storeUrls(c, tx);
        return {
          defaultHost: urls.defaultHost,
          primaryHost: urls.primaryHost,
          domains: (await listDomains(tx, actor(c))).map((d) => view(c, d)),
        };
      }),
      200,
    ),
  );
  admin.openapi(R.addDomain, async (c) => {
    const input = c.req.valid('json');
    const domain = await inStore(
      c,
      (tx) => addDomain(tx, actor(c), input, { ...rules(c), provider: provider(c) }),
      write,
    );
    await scheduleDomainChecks(c.env, actor(c).tenantId as string, domain.id);
    return c.json(view(c, domain), 201);
  });
  admin.openapi(R.checkDomain, async (c) => {
    const { id } = c.req.valid('param');
    const limiter = createLimiter(c.env.RATE_LIMITER, (e) =>
      captureException(e, { tags: { request_id: c.var.requestId } }),
    );
    await limiter.check('domain-check:tenant', actor(c).tenantId as string);
    const before = await inStore(c, (tx) => listDomains(tx, actor(c)));
    const result = await inStore(
      c,
      (tx) => checkDomain(tx, actor(c), id, { provider: provider(c), manual: true }),
      write,
    );
    // A failed domain checked by hand starts a new round of checks.
    if (
      before.find((d) => d.id === id)?.status === 'failed' &&
      result.domain.status === 'pending'
    ) {
      await scheduleDomainChecks(c.env, actor(c).tenantId as string, id);
    }
    return c.json(view(c, result.domain), 200);
  });
  admin.openapi(R.makePrimaryDomain, async (c) => {
    const { id } = c.req.valid('param');
    const domain = await inStore(c, (tx) => makePrimaryDomain(tx, actor(c), id), write);
    return c.json(view(c, domain), 200);
  });
  admin.openapi(R.removeDomain, async (c) => {
    const { id } = c.req.valid('param');
    await inStore(c, (tx) => removeDomain(tx, actor(c), id, { provider: provider(c) }), write);
    return c.body(null, 204);
  });
}
