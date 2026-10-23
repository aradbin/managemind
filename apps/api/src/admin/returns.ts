// Returns and refunds for staff (phase-5a-plan §3.12, §3.13, §6.3). Moves
// and refunds take an Idempotency-Key, as order commands do; a gateway
// refund is sent to SSLCommerz after its record commits.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  closeReturnWithoutRefund,
  createRefund,
  createReturn,
  exchangeReturn,
  getOrder,
  getReturn,
  inspectReturn,
  listReturns,
  moveReturn,
  previewRefund,
  returnableLines,
  returnPhotoKey,
} from '@managemind/core';
import { AppError } from '@managemind/shared';
import {
  exchangeInput,
  inspectInput,
  REFUND_METHODS,
  RETURN_REASONS,
  RETURN_RECORD_STATUSES,
  RETURN_RESOLUTIONS,
  refundInput,
  refundPreviewInput,
  returnInput,
  returnListQuery,
  returnRejectInput,
} from '@managemind/shared/orders';
import type { Context } from 'hono';
import { sendGatewayRefund } from '../payments';
import { inStore, type StaffEnv } from './context';
import { idempotent, PlacedOrder } from './orders';

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });

const Id = z.object({ id: z.uuid() });
const IdemHeader = z.object({ 'idempotency-key': z.string().min(8).max(255).optional() });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const Localized = z.record(z.string(), z.string());

const ReturnSummary = z
  .object({
    id: z.uuid(),
    number: z.number().int(),
    displayNumber: z.string(),
    orderId: z.uuid(),
    orderNumber: z.string(),
    customerName: z.string(),
    status: z.enum(RETURN_RECORD_STATUSES),
    reason: z.enum(RETURN_REASONS),
    requestedBy: z.string(),
    units: z.number().int(),
    createdAt: z.string(),
  })
  .openapi('ReturnSummary');
const ReturnDetail = ReturnSummary.extend({
  note: z.string().nullable(),
  shopperPaysReturn: z.boolean().nullable(),
  resolution: z.enum(RETURN_RESOLUTIONS).nullable(),
  rejectReason: z.string().nullable(),
  exchangeOrderId: z.uuid().nullable(),
  lines: z.array(
    z.object({
      orderLineId: z.uuid(),
      title: Localized,
      optionLabels: z.array(Localized),
      quantity: z.number().int(),
      reason: z.enum(RETURN_REASONS).nullable(),
      restocked: z.number().int(),
      writtenOff: z.number().int(),
    }),
  ),
  photos: z.array(z.object({ id: z.uuid(), mimeType: z.string() })),
  credit: z.number().int().openapi({ description: 'What a refund would give back now' }),
  approvedAt: z.string().nullable(),
  receivedAt: z.string().nullable(),
  inspectedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
}).openapi('ReturnDetail');
const Returnable = z
  .object({
    orderLineId: z.uuid(),
    title: Localized,
    optionLabels: z.array(Localized),
    quantity: z.number().int(),
    delivered: z.number().int(),
    returnable: z.number().int(),
    excluded: z.boolean(),
  })
  .openapi('ReturnableLine');
const RefundPreview = z
  .object({
    returnId: z.uuid().nullable(),
    lines: z.array(
      z.object({
        orderLineId: z.uuid(),
        title: Localized,
        quantity: z.number().int(),
        amount: z.number().int(),
      }),
    ),
    delivery: z.number().int(),
    amount: z.number().int(),
    refundable: z.number().int(),
    gatewayPayments: z.array(
      z.object({
        id: z.uuid(),
        amount: z.number().int(),
        left: z.number().int(),
        bankTranId: z.string().nullable(),
      }),
    ),
  })
  .openapi('RefundPreview');
const Refund = z
  .object({
    id: z.uuid(),
    method: z.enum(REFUND_METHODS),
    status: z.enum(['pending', 'processing', 'succeeded', 'failed']),
    amount: z.number().int(),
    creditCode: z.string().nullable(),
  })
  .openapi('Refund');

export const RETURN_ROUTES = {
  returns: r({
    method: 'get',
    path: '/returns',
    summary: 'Returns, newest first (orders.read)',
    request: { query: returnListQuery },
    responses: json(z.array(ReturnSummary), 'Returns'),
  }),
  createReturn: r({
    method: 'post',
    path: '/returns',
    summary: 'A return staff decided on: approved at once (orders.write)',
    request: { headers: IdemHeader, ...body(returnInput) },
    responses: {
      201: { content: { 'application/json': { schema: ReturnDetail } }, description: 'Created' },
    },
  }),
  getReturn: r({
    method: 'get',
    path: '/returns/{id}',
    summary: 'One return (orders.read)',
    request: { params: Id },
    responses: json(ReturnDetail, 'Return'),
  }),
  approveReturn: r({
    method: 'post',
    path: '/returns/{id}/approve',
    summary: "Approve a shopper's request (orders.write)",
    request: { params: Id, headers: IdemHeader },
    responses: json(ReturnDetail, 'Approved'),
  }),
  rejectReturn: r({
    method: 'post',
    path: '/returns/{id}/reject',
    summary: 'Refuse a request, with a reason the shopper is told (orders.write)',
    request: { params: Id, headers: IdemHeader, ...body(returnRejectInput) },
    responses: json(ReturnDetail, 'Rejected'),
  }),
  sendReturn: r({
    method: 'post',
    path: '/returns/{id}/send',
    summary: 'The goods are on their way back (orders.write)',
    request: { params: Id, headers: IdemHeader },
    responses: json(ReturnDetail, 'In transit'),
  }),
  receiveReturn: r({
    method: 'post',
    path: '/returns/{id}/receive',
    summary: 'The goods are back in the store (orders.write)',
    request: { params: Id, headers: IdemHeader },
    responses: json(ReturnDetail, 'Received'),
  }),
  inspectReturn: r({
    method: 'post',
    path: '/returns/{id}/inspect',
    summary: 'Each unit sellable or damaged: restocks, and writes damaged units off (orders.write)',
    request: { params: Id, headers: IdemHeader, ...body(inspectInput) },
    responses: json(ReturnDetail, 'Inspected'),
  }),
  closeReturn: r({
    method: 'post',
    path: '/returns/{id}/close',
    summary: 'Close an inspected return with nothing given back, and why (orders.write)',
    request: { params: Id, headers: IdemHeader, ...body(returnRejectInput) },
    responses: json(ReturnDetail, 'Closed'),
  }),
  exchangeReturn: r({
    method: 'post',
    path: '/returns/{id}/exchange',
    summary: 'A replacement order, with the returned units as credit (orders.write)',
    request: { params: Id, headers: IdemHeader, ...body(exchangeInput) },
    responses: json(
      z.object({
        order: PlacedOrder,
        credit: z.number().int(),
        applied: z.number().int(),
        refundDue: z.number().int(),
      }),
      'Exchanged',
    ),
  }),
  returnPhoto: r({
    method: 'get',
    path: '/returns/{id}/photos/{photo}',
    summary: "A shopper's photo, for staff only (orders.read)",
    request: { params: z.object({ id: z.uuid(), photo: z.uuid() }) },
    responses: { 200: { description: 'The image' } },
  }),
  returnable: r({
    method: 'get',
    path: '/orders/{id}/returnable',
    summary: 'What can still be returned, per line (orders.read)',
    request: { params: Id },
    responses: json(z.array(Returnable), 'Lines'),
  }),
  refundPreview: r({
    method: 'post',
    path: '/orders/{id}/refunds/preview',
    summary: 'What a refund would give back (payments.refund)',
    request: { params: Id, ...body(refundPreviewInput) },
    responses: json(RefundPreview, 'Preview'),
  }),
  createRefund: r({
    method: 'post',
    path: '/orders/{id}/refunds',
    summary: 'Refund: by the gateway, by hand, or as store credit (payments.refund)',
    request: { params: Id, headers: IdemHeader, ...body(refundInput) },
    responses: {
      201: { content: { 'application/json': { schema: Refund } }, description: 'Refunded' },
    },
  }),
} as const;

export function registerReturns(admin: OpenAPIHono<StaffEnv>): void {
  const R = RETURN_ROUTES;
  const actor = (c: Context<StaffEnv>) => c.var.staff.actor;
  const id = (c: Context<StaffEnv>) => c.req.param('id') as string;
  const write = { write: true } as const;

  admin.openapi(R.returns, async (c) =>
    c.json(await inStore(c, (tx) => listReturns(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.getReturn, async (c) =>
    c.json(await inStore(c, (tx) => getReturn(tx, actor(c), id(c))), 200),
  );
  admin.openapi(R.createReturn, async (c) => {
    const input = c.req.valid('json');
    const result = await inStore(
      c,
      (tx) =>
        idempotent(
          c,
          tx,
          'create_return',
          input,
          async () => getReturn(tx, actor(c), (await createReturn(tx, actor(c), input)).id),
          201,
        ),
      write,
    );
    return c.json(result.body as never, 201);
  });

  const command = (
    route: Parameters<typeof admin.openapi>[0],
    scope: string,
    run: (c: Context<StaffEnv>, input: unknown) => Parameters<typeof inStore>[1],
  ) =>
    admin.openapi(route, (async (c: Context<StaffEnv>) => {
      const input = c.req.header('content-type')?.includes('json') ? await c.req.json() : {};
      const result = await inStore(
        c,
        (tx) => idempotent(c, tx, scope, { id: id(c), input }, () => run(c, input)(tx)),
        write,
      );
      return c.json(result.body as never, 200);
    }) as never);

  command(
    R.approveReturn,
    'return_approve',
    (c) => (tx) => moveReturn(tx, actor(c), id(c), 'approve'),
  );
  command(
    R.rejectReturn,
    'return_reject',
    (c, input) => (tx) => moveReturn(tx, actor(c), id(c), 'reject', input),
  );
  command(R.sendReturn, 'return_send', (c) => (tx) => moveReturn(tx, actor(c), id(c), 'send'));
  command(
    R.receiveReturn,
    'return_receive',
    (c) => (tx) => moveReturn(tx, actor(c), id(c), 'receive'),
  );
  command(
    R.inspectReturn,
    'return_inspect',
    (c, input) => (tx) => inspectReturn(tx, actor(c), id(c), input),
  );
  command(
    R.closeReturn,
    'return_close',
    (c, input) => (tx) => closeReturnWithoutRefund(tx, actor(c), id(c), input),
  );
  command(
    R.exchangeReturn,
    'return_exchange',
    (c, input) => (tx) => exchangeReturn(tx, actor(c), id(c), input),
  );

  admin.openapi(R.returnPhoto, async (c) => {
    const { id: returnId, photo } = c.req.valid('param');
    const found = await inStore(c, (tx) => returnPhotoKey(tx, actor(c), returnId, photo));
    const object = await c.env.FILES.get(found.objectKey);
    if (!object) throw new AppError('not_found');
    // Shoppers' photos: never cached by anything shared (§3.12).
    return new Response(object.body, {
      headers: {
        'content-type': found.mimeType,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  });

  admin.openapi(R.returnable, async (c) => {
    const lines = await inStore(c, async (tx) => {
      await getOrder(tx, actor(c), id(c));
      return returnableLines(tx, id(c));
    });
    return c.json(
      lines.map((l) => ({
        orderLineId: l.orderLineId,
        title: l.title,
        optionLabels: l.optionLabels,
        quantity: l.quantity,
        delivered: l.delivered,
        returnable: l.returnable,
        excluded: l.excluded,
      })),
      200,
    );
  });
  admin.openapi(R.refundPreview, async (c) =>
    c.json(
      await inStore(c, async (tx) => {
        await getOrder(tx, actor(c), id(c));
        return previewRefund(tx, actor(c), id(c), c.req.valid('json'));
      }),
      200,
    ),
  );
  admin.openapi(R.createRefund, async (c) => {
    const input = c.req.valid('json');
    const result = await inStore(
      c,
      (tx) =>
        idempotent(
          c,
          tx,
          'refund',
          { id: id(c), input },
          () => createRefund(tx, actor(c), id(c), input),
          201,
        ),
      write,
    );
    const refund = result.body as Awaited<ReturnType<typeof createRefund>>;
    // A gateway refund goes to SSLCommerz once its record is committed.
    const status =
      refund.method === 'gateway' && refund.status === 'pending'
        ? await sendGatewayRefund(
            c.env,
            c.executionCtx,
            c.var.staff.actor.tenantId as string,
            actor(c),
            refund,
          )
        : refund.status;
    return c.json(
      {
        id: refund.id,
        method: refund.method,
        status,
        amount: refund.amount,
        creditCode: refund.creditCode,
      },
      201,
    );
  });
}
