// Reports for staff (phase-5a-plan §3.15): one call for a date range. The
// back office's sales, products and profit (phase-8-plan §3.8) read the
// summary tables; costs and profit need catalog.cost.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  COD_AGE_BUCKETS,
  codOutstanding,
  expenseReport,
  getRecoveryReport,
  getReports,
  productsReport,
  profitReport,
  salesReport,
  slowMovers,
  stockValuation,
  supplierReport,
} from '@managemind/core';
import { AGEING_BUCKETS } from '@managemind/shared/back-office';
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

const ValuationRow = z.object({
  variantId: z.uuid(),
  productId: z.string(),
  title: Names,
  optionLabels: z.array(Names),
  sku: z.string().nullable(),
  locationId: z.uuid(),
  location: z.string(),
  categoryId: z.uuid().nullable(),
  category: Names.nullable(),
  onHand: Count,
  unitCost: Money.nullable(),
  value: Money,
});
const StockValuation = z
  .object({
    asOf: z.string(),
    month: z.string().nullable(),
    items: z.array(ValuationRow),
    negative: z.array(ValuationRow).openapi({ description: 'Below zero, never netted' }),
    byLocation: z.array(
      z.object({ locationId: z.uuid(), location: z.string(), units: Count, value: Money }),
    ),
    byCategory: z.array(
      z.object({
        categoryId: z.uuid().nullable(),
        category: Names.nullable(),
        units: Count,
        value: Money,
      }),
    ),
    totals: z.object({ units: Count, value: Money, missingCostUnits: Count }),
    months: z.array(z.string()).openapi({ description: 'Month ends with stored values' }),
  })
  .openapi('StockValuation');
const SlowMovers = z
  .object({
    days: Count,
    items: z.array(
      z.object({
        variantId: z.uuid(),
        productId: z.string(),
        title: Names,
        optionLabels: z.array(Names),
        sku: z.string().nullable(),
        onHand: Count,
        lastSoldAt: z.string().nullable(),
        value: Money.optional().openapi({ description: 'With catalog.cost' }),
      }),
    ),
  })
  .openapi('SlowMovers');
const Buckets = z.object(
  Object.fromEntries(AGEING_BUCKETS.map((b) => [b, Money])) as Record<
    (typeof AGEING_BUCKETS)[number],
    typeof Money
  >,
);
const SupplierReport = z
  .object({
    from: z.string(),
    to: z.string(),
    dues: z.array(
      z.object({
        supplierId: z.uuid(),
        name: z.string(),
        archived: z.boolean(),
        balance: Money,
        buckets: Buckets,
      }),
    ),
    duesTotal: z.object({ balance: Money, buckets: Buckets }),
    purchases: z.array(
      z.object({
        supplierId: z.uuid().nullable(),
        name: z.string().nullable(),
        receipts: Count,
        received: Money,
        paid: Money,
      }),
    ),
  })
  .openapi('SupplierReport');
const ExpenseReport = z
  .object({
    from: z.string(),
    to: z.string(),
    months: z.array(z.string()),
    categories: z.array(
      z.object({
        categoryId: z.uuid(),
        name: z.object({ bn: z.string(), en: z.string() }),
        amounts: z.array(Money),
        total: Money,
      }),
    ),
    monthTotals: z.array(Money),
    total: Money,
  })
  .openapi('ExpenseReport');
const CodOutstanding = z
  .object({
    holders: z.array(
      z.object({
        courier: z.string().nullable().openapi({ description: "Null for the store's own riders" }),
        parcels: Count,
        amount: Money,
        buckets: z.object(
          Object.fromEntries(COD_AGE_BUCKETS.map((b) => [b, Money])) as Record<
            (typeof COD_AGE_BUCKETS)[number],
            typeof Money
          >,
        ),
        oldestDays: Count,
      }),
    ),
    total: Money,
  })
  .openapi('CodOutstanding');

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
  stock: createRoute({
    method: 'get',
    path: '/v1/admin/reports/stock',
    tags: ['admin'],
    summary:
      "What the stock is worth today, or at a past month's end (reports.read, catalog.cost, back office)",
    request: {
      query: z.object({ month: z.string().optional().openapi({ description: 'YYYY-MM' }) }),
    },
    responses: {
      200: { content: { 'application/json': { schema: StockValuation } }, description: 'Report' },
    },
  }),
  slowMovers: createRoute({
    method: 'get',
    path: '/v1/admin/reports/slow-movers',
    tags: ['admin'],
    summary: 'On hand with no sale in a number of days, 60 by default (reports.read, back office)',
    request: { query: z.object({ days: z.string().optional() }) },
    responses: {
      200: { content: { 'application/json': { schema: SlowMovers } }, description: 'Report' },
    },
  }),
  suppliers: createRoute({
    method: 'get',
    path: '/v1/admin/reports/suppliers',
    tags: ['admin'],
    summary:
      'Supplier balances and ageing today, purchases and payments in a range (reports.read, purchasing.pay, back office)',
    request: { query: Range },
    responses: {
      200: { content: { 'application/json': { schema: SupplierReport } }, description: 'Report' },
    },
  }),
  expenses: createRoute({
    method: 'get',
    path: '/v1/admin/reports/expenses',
    tags: ['admin'],
    summary: 'Expenses by category and month (reports.read, expenses.read, back office)',
    request: { query: Range },
    responses: {
      200: { content: { 'application/json': { schema: ExpenseReport } }, description: 'Report' },
    },
  }),
  codOutstanding: createRoute({
    method: 'get',
    path: '/v1/admin/reports/cod-outstanding',
    tags: ['admin'],
    summary:
      "Delivered COD couriers haven't paid out and own riders haven't handed in, by age (reports.read, back office)",
    responses: {
      200: { content: { 'application/json': { schema: CodOutstanding } }, description: 'Report' },
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
  admin.openapi(REPORT_ROUTES.stock, async (c) =>
    c.json(
      await inStore(c, (tx) => stockValuation(tx, c.var.staff.actor, c.req.valid('query'))),
      200,
    ),
  );
  admin.openapi(REPORT_ROUTES.slowMovers, async (c) =>
    c.json(await inStore(c, (tx) => slowMovers(tx, c.var.staff.actor, c.req.valid('query'))), 200),
  );
  admin.openapi(REPORT_ROUTES.suppliers, async (c) =>
    c.json(
      await inStore(c, (tx) => supplierReport(tx, c.var.staff.actor, c.req.valid('query'))),
      200,
    ),
  );
  admin.openapi(REPORT_ROUTES.expenses, async (c) =>
    c.json(
      await inStore(c, (tx) => expenseReport(tx, c.var.staff.actor, c.req.valid('query'))),
      200,
    ),
  );
  admin.openapi(REPORT_ROUTES.codOutstanding, async (c) =>
    c.json(await inStore(c, (tx) => codOutstanding(tx, c.var.staff.actor)), 200),
  );
  admin.openapi(REPORT_ROUTES.recovery, async (c) =>
    c.json(
      await inStore(c, (tx) => getRecoveryReport(tx, c.var.staff.actor, c.req.valid('query'))),
      200,
    ),
  );
}
