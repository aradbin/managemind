// Promotions under /v1/admin (phase-4-plan §3.13, §6.2): the campaign list,
// the builder's create and edit, code batches and their list, and the test
// cart. Each service checks its own permission; another store's IDs answer
// 404, and every route with an ID is in the isolation suite.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createPromotion,
  generateCodes,
  getPromotion,
  listCodes,
  listPromotions,
  testCart,
  updatePromotion,
} from '@managemind/core';
import { codeBatchInput, promotionInput } from '@managemind/shared/orders';
import type { Context } from 'hono';
import { inStore, type StaffEnv } from './context';
import { QuoteView, quoteView } from './orders';

const Id = z.object({ id: z.uuid() });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const created = <T extends z.ZodType>(schema: T, description: string) => ({
  201: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});

const Localized = z.object({ bn: z.string().optional(), en: z.string().optional() });
const Money = z.number().int();

export const Promotion = z
  .object({
    id: z.uuid(),
    title: Localized,
    kind: z.enum(['automatic', 'code']),
    status: z.enum(['draft', 'active', 'paused', 'ended']),
    state: z.enum(['draft', 'scheduled', 'live', 'paused', 'ended']),
    startsAt: z.string().nullable(),
    endsAt: z.string().nullable(),
    priority: z.number().int(),
    exclusive: z.boolean(),
    maxDiscount: Money.nullable(),
    usageLimit: z.number().int().nullable(),
    usageCount: z.number().int(),
    perCustomerLimit: z.number().int().nullable(),
    conditions: z.record(z.string(), z.unknown()).openapi({
      description: 'promotionConditions (shared/orders/promotions.ts)',
    }),
    action: z
      .object({ type: z.string() })
      .loose()
      .openapi({ description: 'promotionAction (shared/orders/promotions.ts)' }),
    code: z.string().nullable().openapi({ description: 'The shared code, if any' }),
    codeCount: z.number().int(),
    orders: z.number().int(),
    discountTotal: Money,
    sales: Money,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Promotion');

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });

const testCartBody = z.object({
  lines: z
    .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(1000) }))
    .min(1)
    .max(50),
  areaId: z.number().int().min(1).nullable().optional(),
  paymentMethod: z.enum(['cod', 'manual']).optional(),
  phone: z.string().max(32).optional(),
  code: z.string().max(32).optional(),
  draft: z.record(z.string(), z.unknown()).optional().openapi({
    description: 'The promotion being built (promotionInput), tried as if live',
  }),
  promotionId: z.uuid().optional(),
});

export const PROMOTION_ROUTES = {
  promotions: r({
    method: 'get',
    path: '/promotions',
    summary: 'The campaign list with uses, orders, discounts and sales (promotions.read)',
    request: {
      query: z.object({
        state: z.enum(['draft', 'scheduled', 'live', 'paused', 'ended']).optional(),
        kind: z.enum(['automatic', 'code']).optional(),
        q: z.string().max(100).optional(),
      }),
    },
    responses: json(z.array(Promotion), 'Promotions'),
  }),
  createPromotion: r({
    method: 'post',
    path: '/promotions',
    summary: 'Create a promotion (promotions.write)',
    request: body(promotionInput),
    responses: created(Promotion, 'Created'),
  }),
  promotion: r({
    method: 'get',
    path: '/promotions/{id}',
    summary: 'A promotion (promotions.read)',
    request: { params: Id },
    responses: json(Promotion, 'Promotion'),
  }),
  updatePromotion: r({
    method: 'patch',
    path: '/promotions/{id}',
    summary: 'Edit a promotion, or end it with status "ended" (promotions.write)',
    request: { params: Id, ...body(z.record(z.string(), z.unknown())) },
    responses: json(Promotion, 'Updated'),
  }),
  generateCodes: r({
    method: 'post',
    path: '/promotions/{id}/codes',
    summary: 'Generate a batch of unique codes, up to 5,000 (promotions.write)',
    request: { params: Id, ...body(codeBatchInput) },
    responses: created(
      z.object({ created: z.number().int(), codes: z.array(z.string()) }),
      'Codes',
    ),
  }),
  codes: r({
    method: 'get',
    path: '/promotions/{id}/codes',
    summary: 'A promotion’s codes and their uses (promotions.read)',
    request: {
      params: Id,
      query: z.object({
        after: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(1000).optional(),
      }),
    },
    responses: json(
      z.object({
        items: z.array(
          z.object({
            id: z.uuid(),
            code: z.string(),
            usageLimit: z.number().int().nullable(),
            usageCount: z.number().int(),
            createdAt: z.string(),
          }),
        ),
        nextCursor: z.string().nullable(),
      }),
      'Codes',
    ),
  }),
  testCart: r({
    method: 'post',
    path: '/promotions/test',
    summary: 'The test cart: which promotions apply to a cart, and why the others don’t',
    request: body(testCartBody),
    responses: json(
      z.object({
        quote: QuoteView,
        results: z.array(
          z.object({
            promotionId: z.uuid(),
            title: Localized,
            applied: z.boolean(),
            amount: Money,
            reason: z.string().nullable(),
          }),
        ),
      }),
      'Result',
    ),
  }),
} as const;

const actor = (c: Context<StaffEnv>) => c.var.staff.actor;
const write = { write: true } as const;

export function registerPromotions(admin: OpenAPIHono<StaffEnv>): void {
  const R = PROMOTION_ROUTES;
  admin.openapi(R.promotions, async (c) =>
    c.json(
      (await inStore(c, (tx) => listPromotions(tx, actor(c), c.req.valid('query')))) as never,
      200,
    ),
  );
  admin.openapi(R.testCart, async (c) => {
    const input = c.req.valid('json');
    const result = await inStore(c, (tx) => testCart(tx, actor(c), input));
    return c.json({ results: result.results, quote: quoteView(result.quote) }, 200);
  });
  admin.openapi(R.createPromotion, async (c) => {
    const input = c.req.valid('json');
    return c.json(
      (await inStore(c, (tx) => createPromotion(tx, actor(c), input), write)) as never,
      201,
    );
  });
  admin.openapi(R.promotion, async (c) =>
    c.json(
      (await inStore(c, (tx) => getPromotion(tx, actor(c), c.req.valid('param').id))) as never,
      200,
    ),
  );
  admin.openapi(R.updatePromotion, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(
      (await inStore(c, (tx) => updatePromotion(tx, actor(c), id, input), write)) as never,
      200,
    );
  });
  admin.openapi(R.generateCodes, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => generateCodes(tx, actor(c), id, input), write), 201);
  });
  admin.openapi(R.codes, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await inStore(c, (tx) => listCodes(tx, actor(c), id, c.req.valid('query'))), 200);
  });
}
