// Settings → Store → Download the store's data (phase-5b-plan §3.10, Q13):
// an owner asks for an export at most once a day; it runs in GitHub
// Actions, and the owners are emailed the link when it's ready.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { listJobs, requestExport } from '@managemind/core';
import { dispatchJobs, Job, jobOut } from '../tenant-jobs';
import { inStore, type StaffEnv } from './context';

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });

export const EXPORT_ROUTES = {
  export: r({
    method: 'get',
    path: '/export',
    summary: "The store's latest export, with its link while it lasts (owner)",
    responses: {
      200: {
        content: { 'application/json': { schema: z.union([Job, z.null()]) } },
        description: 'Export',
      },
    },
  }),
  requestExport: r({
    method: 'post',
    path: '/export',
    summary: "Export the store's data, at most once a day; the owners are emailed the link (owner)",
    responses: {
      202: { content: { 'application/json': { schema: Job } }, description: 'Queued' },
    },
  }),
} as const;

const ownerOnly = (actor: StaffEnv['Variables']['staff']['actor']) => actor.storeRole === 'owner';

export function registerExport(admin: OpenAPIHono<StaffEnv>): void {
  admin.openapi(EXPORT_ROUTES.export, async (c) => {
    const job = await inStore(c, async (tx) => {
      if (!ownerOnly(c.var.staff.actor)) return null;
      const [latest] = await listJobs(tx, tx.tenantId, { kind: 'export', limit: 1 });
      return latest ?? null;
    });
    return c.json(job ? await jobOut(c.env, job, true) : null, 200);
  });
  admin.openapi(EXPORT_ROUTES.requestExport, async (c) => {
    // Owners only (core checks); allowed while the store is suspended.
    const { job, created } = await inStore(c, (tx) => requestExport(tx, c.var.staff.actor));
    if (created) dispatchJobs(c.env, c.executionCtx);
    return c.json(await jobOut(c.env, job, true), 202);
  });
}
