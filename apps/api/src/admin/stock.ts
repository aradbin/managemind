// Stock counts and the adjustments list in the admin (phase-8-plan §3.4,
// §3.5, §6). Expected quantities stay hidden while a count is being
// counted, and values need catalog.cost; the core services decide both.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  applyStockCount,
  cancelStockCount,
  createStockCount,
  getStockCount,
  listAdjustments,
  listStockCounts,
  reopenStockCount,
  setCountLine,
  submitStockCount,
} from '@managemind/core';
import {
  countLineInput,
  STOCK_COUNT_STATUSES,
  stockCountInput,
} from '@managemind/shared/back-office';
import { ADJUSTMENT_REASONS } from '@managemind/shared/catalog';
import { queueStockCountApply } from '../stock-counts';
import { inStore, type StaffEnv } from './context';

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });
const json = <T extends z.ZodType>(schema: T, description: string, status = 200) => ({
  [status]: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const Id = z.object({ id: z.uuid() });
const Money = z.number().int();
const Localized = z.object({ bn: z.string().optional(), en: z.string().optional() });
const day = z.iso.date();
const cursor = {
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
};
const VariantLine = {
  variantId: z.uuid(),
  productId: z.string(),
  title: Localized,
  optionLabels: z.array(Localized),
  sku: z.string().nullable(),
};

const Adjustment = z.object({
  id: z.uuid(),
  ...VariantLine,
  locationId: z.uuid(),
  quantity: z.number().int(),
  reason: z.string(),
  note: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: z.uuid().nullable(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  createdAt: z.string(),
  unitCost: Money.nullable().optional().openapi({ description: 'Only with catalog.cost' }),
  value: Money.nullable().optional().openapi({ description: 'Only with catalog.cost' }),
});
const Adjustments = z
  .object({
    items: z.array(Adjustment),
    nextCursor: z.string().nullable(),
    totals: z.object({
      count: z.number().int(),
      units: z.number().int(),
      unvalued: z.number().int(),
      value: Money.optional(),
    }),
  })
  .openapi('AdjustmentPage');

const Scope = z.record(z.string(), z.unknown());
const CountLine = z
  .object({
    ...VariantLine,
    barcode: z.string().nullable(),
    counted: z.number().int().nullable(),
    countedAt: z.string().nullable(),
    countedBy: z.string().nullable(),
    expected: z.number().int().optional(),
    difference: z.number().int().optional(),
    unitCost: Money.nullable().optional(),
    value: Money.optional(),
    applied: z.boolean().optional(),
  })
  .openapi('StockCountLine');
const StockCount = z
  .object({
    id: z.uuid(),
    number: z.number().int(),
    reference: z.string(),
    locationId: z.uuid(),
    status: z.enum(STOCK_COUNT_STATUSES),
    scope: Scope,
    note: z.string().nullable(),
    lineCount: z.number().int(),
    countedLines: z.number().int(),
    startedBy: z.string().nullable(),
    submittedAt: z.string().nullable(),
    appliedAt: z.string().nullable(),
    appliedBy: z.string().nullable(),
    applyError: z.string().nullable(),
    createdAt: z.string(),
    lines: z.array(CountLine),
    differences: z
      .object({ lines: z.number().int(), units: z.number().int(), value: Money.optional() })
      .optional(),
    approvalThreshold: Money.optional(),
  })
  .openapi('StockCount');
const StockCountSummary = z.object({
  id: z.uuid(),
  number: z.number().int(),
  reference: z.string(),
  status: z.enum(STOCK_COUNT_STATUSES),
  locationId: z.uuid(),
  scope: Scope,
  lineCount: z.number().int(),
  countedLines: z.number().int(),
  createdAt: z.string(),
  appliedAt: z.string().nullable(),
});

export const STOCK_ROUTES = {
  adjustments: r({
    method: 'get',
    path: '/inventory/adjustments',
    summary: 'Adjustments and hand receipts with totals; values with catalog.cost (inventory.read)',
    request: {
      query: z.object({
        reason: z.enum(ADJUSTMENT_REASONS).optional(),
        locationId: z.uuid().optional(),
        actorId: z.uuid().optional(),
        from: day.optional(),
        to: day.optional(),
        ...cursor,
      }),
    },
    responses: json(Adjustments, 'Adjustments'),
  }),
  stockCounts: r({
    method: 'get',
    path: '/stock-counts',
    summary: 'Stock counts, newest first (inventory.read)',
    request: { query: z.object({ status: z.enum(STOCK_COUNT_STATUSES).optional(), ...cursor }) },
    responses: json(
      z.object({ items: z.array(StockCountSummary), nextCursor: z.string().nullable() }),
      'Counts',
    ),
  }),
  createStockCount: r({
    method: 'post',
    path: '/stock-counts',
    summary: 'Start a count of a location, a category, a tag or chosen items (inventory.write)',
    request: body(stockCountInput),
    responses: json(StockCount, 'Started', 201),
  }),
  stockCount: r({
    method: 'get',
    path: '/stock-counts/{id}',
    summary: 'A count; expected quantities from review on (inventory.read)',
    request: { params: Id },
    responses: json(StockCount, 'Count'),
  }),
  countLine: r({
    method: 'put',
    path: '/stock-counts/{id}/lines/{variantId}',
    summary: "A counter's number for one item, stamped with when (inventory.write)",
    request: {
      params: z.object({ id: z.uuid(), variantId: z.uuid() }),
      ...body(countLineInput),
    },
    responses: json(CountLine, 'Counted'),
  }),
  submitStockCount: r({
    method: 'post',
    path: '/stock-counts/{id}/submit',
    summary: 'Counting is done: on to review (inventory.write)',
    request: { params: Id },
    responses: json(StockCount, 'In review'),
  }),
  reopenStockCount: r({
    method: 'post',
    path: '/stock-counts/{id}/reopen',
    summary: 'Back to counting (inventory.write)',
    request: { params: Id },
    responses: json(StockCount, 'Counting'),
  }),
  applyStockCount: r({
    method: 'post',
    path: '/stock-counts/{id}/apply',
    summary:
      "Apply the differences; above the store's threshold also catalog.cost (inventory.write)",
    request: { params: Id },
    responses: json(StockCount, 'Applied, or applying in the background'),
  }),
  cancelStockCount: r({
    method: 'post',
    path: '/stock-counts/{id}/cancel',
    summary: 'Cancel a count that is not applied (inventory.write)',
    request: { params: Id },
    responses: json(StockCount, 'Cancelled'),
  }),
} as const;

export function registerStock(admin: OpenAPIHono<StaffEnv>): void {
  const R = STOCK_ROUTES;
  const actor = (c: { var: StaffEnv['Variables'] }) => c.var.staff.actor;
  const write = { write: true };

  admin.openapi(R.adjustments, async (c) =>
    c.json(await inStore(c, (tx) => listAdjustments(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.stockCounts, async (c) =>
    c.json(await inStore(c, (tx) => listStockCounts(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.createStockCount, async (c) =>
    c.json(
      await inStore(c, (tx) => createStockCount(tx, actor(c), c.req.valid('json')), write),
      201,
    ),
  );
  admin.openapi(R.stockCount, async (c) =>
    c.json(await inStore(c, (tx) => getStockCount(tx, actor(c), c.req.valid('param').id)), 200),
  );
  admin.openapi(R.countLine, async (c) => {
    const { id, variantId } = c.req.valid('param');
    return c.json(
      await inStore(
        c,
        (tx) => setCountLine(tx, actor(c), id, variantId, c.req.valid('json')),
        write,
      ),
      200,
    );
  });
  for (const [route, run] of [
    [R.submitStockCount, submitStockCount],
    [R.reopenStockCount, reopenStockCount],
    [R.cancelStockCount, cancelStockCount],
  ] as const) {
    admin.openapi(route, async (c) =>
      c.json(await inStore(c, (tx) => run(tx, actor(c), c.req.valid('param').id), write), 200),
    );
  }
  admin.openapi(R.applyStockCount, async (c) => {
    const { id } = c.req.valid('param');
    const { count, queued } = await inStore(c, (tx) => applyStockCount(tx, actor(c), id), write);
    if (!queued) return c.json(count, 200);
    await queueStockCountApply(c.env, c.var.staff.client, actor(c).tenantId as string, id);
    return c.json(await inStore(c, (tx) => getStockCount(tx, actor(c), id)), 200);
  });
}
