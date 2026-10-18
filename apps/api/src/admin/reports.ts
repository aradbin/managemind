// Reports for staff (phase-5a-plan §3.15): one call for a date range.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { getReports } from '@managemind/core';
import { inStore, type StaffEnv } from './context';

const Localized = z.record(z.string(), z.string());

const Reports = z
  .object({
    from: z.string(),
    to: z.string(),
    returnsByProduct: z.array(
      z.object({
        productId: z.uuid(),
        title: Localized,
        delivered: z.number().int(),
        returned: z.number().int(),
      }),
    ),
    returnsByReason: z.array(
      z.object({ reason: z.string(), returns: z.number().int(), units: z.number().int() }),
    ),
    refundsByMethod: z.array(
      z.object({ method: z.string(), refunds: z.number().int(), amount: z.number().int() }),
    ),
    failedByZone: z.array(
      z.object({
        zoneId: z.uuid().nullable(),
        zone: Localized.nullable(),
        shipped: z.number().int(),
        failed: z.number().int(),
        cost: z.number().int(),
      }),
    ),
    payments: z.array(
      z.object({
        kind: z.enum(['online', 'cod', 'manual', 'mixed']),
        orders: z.number().int(),
        revenue: z.number().int(),
      }),
    ),
  })
  .openapi('Reports');

export const REPORT_ROUTES = {
  reports: createRoute({
    method: 'get',
    path: '/v1/admin/reports',
    tags: ['admin'],
    summary: 'Returns, refunds, failed deliveries and payment mix for a date range (reports.read)',
    request: { query: z.object({ from: z.iso.date(), to: z.iso.date() }) },
    responses: {
      200: { content: { 'application/json': { schema: Reports } }, description: 'Reports' },
    },
  }),
} as const;

export function registerReports(admin: OpenAPIHono<StaffEnv>): void {
  admin.openapi(REPORT_ROUTES.reports, async (c) =>
    c.json(await inStore(c, (tx) => getReports(tx, c.var.staff.actor, c.req.valid('query'))), 200),
  );
}
