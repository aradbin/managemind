// Reports for staff (phase-5a-plan §3.15): one call for a date range.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { getRecoveryReport, getReports } from '@managemind/core';
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

const Count = z.number().int();
const RecoveryReport = z
  .object({
    from: z.string(),
    to: z.string(),
    incomplete: z.object({
      saved: Count,
      contacted: Count,
      converted: Count,
      recovered: Count,
      recoveredAfterCall: Count,
      dismissed: Count,
      savedValue: Count,
      convertedValue: Count,
      recoveredValue: Count,
    }),
    confirmation: z.object({
      placed: Count,
      confirmedBy: z.object({ call: Count, link: Count, staff: Count, auto: Count }),
      cancelledBy: z.array(z.object({ code: z.string(), orders: Count })),
      unreachable: Count,
      medianMinutes: Count.nullable(),
      rate: Count.nullable(),
    }),
    deliveryByScore: z.array(
      z.object({
        band: z.enum(['0-49', '50-79', '80-100', 'new']),
        delivered: Count,
        notReceived: Count,
      }),
    ),
    duplicates: z.object({ flagged: Count, merged: Count, cancelled: Count, dismissed: Count }),
  })
  .openapi('RecoveryReport');

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
  recovery: createRoute({
    method: 'get',
    path: '/v1/admin/reports/recovery',
    tags: ['admin'],
    summary:
      'Sales recovery for a date range: incomplete orders, confirmation, delivery by score and duplicates (reports.read)',
    request: { query: z.object({ from: z.iso.date(), to: z.iso.date() }) },
    responses: {
      200: { content: { 'application/json': { schema: RecoveryReport } }, description: 'Report' },
    },
  }),
} as const;

export function registerReports(admin: OpenAPIHono<StaffEnv>): void {
  admin.openapi(REPORT_ROUTES.reports, async (c) =>
    c.json(await inStore(c, (tx) => getReports(tx, c.var.staff.actor, c.req.valid('query'))), 200),
  );
  admin.openapi(REPORT_ROUTES.recovery, async (c) =>
    c.json(
      await inStore(c, (tx) => getRecoveryReport(tx, c.var.staff.actor, c.req.valid('query'))),
      200,
    ),
  );
}
