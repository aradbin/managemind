// Reports for staff (phase-5a-plan §3.15): one call for a date range. The
// back office's sales, products and profit (phase-8-plan §3.8) read the
// summary tables; costs and profit need catalog.cost.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  getRecoveryReport,
  getReports,
  productsReport,
  profitReport,
  salesReport,
} from '@managemind/core';
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

const Money = z.number().int();
const Names = z.object({ bn: z.string().optional(), en: z.string().optional() });
const Range = z.object({ from: z.iso.date(), to: z.iso.date() });
const SalesFigures = z.object({
  ordersDelivered: Count,
  units: Count,
  grossSales: Money,
  discounts: Money,
  netSales: Money,
  returnedUnits: Count,
  returns: Money,
  deliveryIncome: Money,
});
const SalesReport = z
  .object({
    from: z.string(),
    to: z.string(),
    by: z.enum(['day', 'week', 'month']),
    buckets: z.array(
      SalesFigures.extend({
        start: z.string().openapi({ description: "The day, the week's Monday or the month's 1st" }),
      }),
    ),
    totals: SalesFigures,
  })
  .openapi('SalesReport');
const ProductsReport = z
  .object({
    from: z.string(),
    to: z.string(),
    items: z.array(
      z.object({
        variantId: z.uuid(),
        productId: z.uuid(),
        title: Names,
        optionLabels: z.array(Names),
        sku: z.string().nullable(),
        units: Count,
        returnedUnits: Count,
        netSales: Money,
        returns: Money,
        cogs: Money.optional().openapi({ description: 'With catalog.cost' }),
        grossProfit: Money.optional(),
        marginBp: z.number().int().nullable().optional(),
        missingCostUnits: Count.optional(),
      }),
    ),
  })
  .openapi('ProductsReport');
const ProfitStatement = z
  .object({
    from: z.string(),
    to: z.string(),
    netSales: Money,
    returns: Money,
    cogs: Money,
    grossProfit: Money,
    deliveryIncome: Money,
    courierFees: Money,
    failedDeliveryCosts: Money,
    deliveryResult: Money,
    stockLosses: Money,
    expenses: Money,
    expensesByCategory: z.array(
      z.object({
        categoryId: z.uuid(),
        name: z.object({ bn: z.string(), en: z.string() }),
        amount: Money,
      }),
    ),
    netProfit: Money,
    missingCostUnits: Count.openapi({ description: 'Delivered units without a cost' }),
    ordersDelivered: Count,
    vat: Money,
    grossSales: Money,
    discounts: Money,
  })
  .openapi('ProfitStatement');

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
  sales: createRoute({
    method: 'get',
    path: '/v1/admin/reports/sales',
    tags: ['admin'],
    summary: 'Delivered sales by day, week or month (reports.read, back office)',
    request: {
      query: Range.extend({ by: z.enum(['day', 'week', 'month']).optional() }),
    },
    responses: {
      200: { content: { 'application/json': { schema: SalesReport } }, description: 'Report' },
    },
  }),
  products: createRoute({
    method: 'get',
    path: '/v1/admin/reports/products',
    tags: ['admin'],
    summary: 'Sales per variant, with cost and profit for catalog.cost (reports.read, back office)',
    request: { query: Range },
    responses: {
      200: { content: { 'application/json': { schema: ProductsReport } }, description: 'Report' },
    },
  }),
  profit: createRoute({
    method: 'get',
    path: '/v1/admin/reports/profit',
    tags: ['admin'],
    summary:
      'The profit statement for a range and the same number of days before (reports.read, catalog.cost, back office)',
    request: { query: Range },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z
              .object({ current: ProfitStatement, previous: ProfitStatement })
              .openapi('ProfitReport'),
          },
        },
        description: 'Report',
      },
    },
  }),
} as const;

export function registerReports(admin: OpenAPIHono<StaffEnv>): void {
  admin.openapi(REPORT_ROUTES.reports, async (c) =>
    c.json(await inStore(c, (tx) => getReports(tx, c.var.staff.actor, c.req.valid('query'))), 200),
  );
  admin.openapi(REPORT_ROUTES.sales, async (c) =>
    c.json(await inStore(c, (tx) => salesReport(tx, c.var.staff.actor, c.req.valid('query'))), 200),
  );
  admin.openapi(REPORT_ROUTES.products, async (c) =>
    c.json(
      await inStore(c, (tx) => productsReport(tx, c.var.staff.actor, c.req.valid('query'))),
      200,
    ),
  );
  admin.openapi(REPORT_ROUTES.profit, async (c) =>
    c.json(
      await inStore(c, (tx) => profitReport(tx, c.var.staff.actor, c.req.valid('query'))),
      200,
    ),
  );
  admin.openapi(REPORT_ROUTES.recovery, async (c) =>
    c.json(
      await inStore(c, (tx) => getRecoveryReport(tx, c.var.staff.actor, c.req.valid('query'))),
      200,
    ),
  );
}
