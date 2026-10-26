// Purchasing in the admin (phase-8-plan §3.1–§3.3, §3.7, §6): suppliers and
// their ledger, purchase orders, receiving with or without a PO, supplier
// payments, and a variant's cost history. Costs are left out of every
// response without catalog.cost, and balances without purchasing.pay; the
// core services decide both.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  createGoodsReceipt,
  createPurchaseOrder,
  createSupplier,
  createSupplierPayment,
  deletePurchaseOrder,
  deleteSupplierPayment,
  getGoodsReceipt,
  getPurchaseOrder,
  getSupplier,
  listGoodsReceipts,
  listPurchaseOrders,
  listSupplierPayments,
  listSuppliers,
  placePurchaseOrder,
  reorderSuggestions,
  supplierLedger,
  updatePurchaseOrder,
  updateSupplier,
  updateSupplierPayment,
  variantCostHistory,
} from '@managemind/core';
import {
  COST_SOURCES,
  goodsReceiptInput,
  PURCHASE_ORDER_STATUSES,
  purchaseOrderInput,
  purchaseOrderPatch,
  SPEND_METHODS,
  supplierInput,
  supplierPatch,
  supplierPaymentInput,
  supplierPaymentPatch,
} from '@managemind/shared/back-office';
import { inStore, type StaffEnv } from './context';
import { idempotent } from './orders';

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
const IdemHeader = z.object({ 'idempotency-key': z.string().min(8).max(255).optional() });
const Money = z.number().int();
const Localized = z.object({ bn: z.string().optional(), en: z.string().optional() });
const Page = <T extends z.ZodType>(item: T, name: string) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() }).openapi(name);
const cursor = {
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
};
const day = z.iso.date();
const OtherCost = z.object({ label: z.string(), amount: Money });
const Ref = z.object({ id: z.uuid(), name: z.string() });

const Supplier = z
  .object({
    id: z.uuid(),
    name: z.string(),
    contactName: z.string().nullable(),
    phones: z.array(z.string()),
    email: z.string().nullable(),
    address: z
      .object({ line1: z.string(), line2: z.string().optional(), city: z.string().optional() })
      .nullable(),
    note: z.string().nullable(),
    archived: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    openingBalance: Money.optional().openapi({ description: 'Only with purchasing.pay' }),
    balance: Money.optional().openapi({ description: 'Only with purchasing.pay' }),
  })
  .openapi('Supplier');

const Ledger = z
  .object({
    opening: Money,
    closing: Money,
    entries: z.array(
      z.object({
        on: z.string(),
        kind: z.enum(['opening', 'receipt', 'payment']),
        id: z.uuid().nullable(),
        reference: z.string().nullable(),
        amount: Money,
        balance: Money,
      }),
    ),
  })
  .openapi('SupplierLedger');

const VariantLine = {
  variantId: z.uuid(),
  productId: z.string(),
  title: Localized,
  optionLabels: z.array(Localized),
  sku: z.string().nullable(),
};

const PurchaseOrder = z
  .object({
    id: z.uuid(),
    number: z.number().int(),
    reference: z.string(),
    supplier: Ref,
    locationId: z.uuid(),
    status: z.enum(PURCHASE_ORDER_STATUSES),
    expectedOn: z.string().nullable(),
    supplierRef: z.string().nullable(),
    note: z.string().nullable(),
    lines: z.array(
      z.object({
        id: z.uuid(),
        ...VariantLine,
        barcode: z.string().nullable(),
        quantity: z.number().int(),
        receivedQuantity: z.number().int(),
        remaining: z.number().int(),
        unitCost: Money.optional(),
      }),
    ),
    receipts: z.array(
      z.object({
        id: z.uuid(),
        number: z.number().int(),
        reference: z.string(),
        receivedOn: z.string(),
      }),
    ),
    actions: z.array(z.enum(['place', 'close', 'cancel'])),
    placedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    otherCosts: z.array(OtherCost).optional(),
    subtotal: Money.optional(),
    otherCostTotal: Money.optional(),
    total: Money.optional(),
  })
  .openapi('PurchaseOrder');

const PurchaseOrderSummary = z.object({
  id: z.uuid(),
  number: z.number().int(),
  reference: z.string(),
  status: z.enum(PURCHASE_ORDER_STATUSES),
  supplier: Ref,
  expectedOn: z.string().nullable(),
  lineCount: z.number().int(),
  ordered: z.number().int(),
  received: z.number().int(),
  createdAt: z.string(),
  total: Money.optional(),
});

const ReorderLine = z
  .object({
    ...VariantLine,
    available: z.number().int(),
    lowStockThreshold: z.number().int(),
    quantity: z.number().int(),
    unitCost: Money.nullable().optional(),
  })
  .openapi('ReorderLine');

const GoodsReceipt = z
  .object({
    id: z.uuid(),
    number: z.number().int(),
    reference: z.string(),
    supplier: Ref.nullable(),
    purchaseOrder: z
      .object({ id: z.uuid(), number: z.number().int(), reference: z.string() })
      .nullable(),
    locationId: z.uuid(),
    receivedOn: z.string(),
    supplierInvoice: z.string().nullable(),
    note: z.string().nullable(),
    lines: z.array(
      z.object({
        ...VariantLine,
        quantity: z.number().int(),
        purchaseOrderLineId: z.uuid().nullable(),
        unitCost: Money.optional(),
        landedUnitCost: Money.optional(),
      }),
    ),
    receivedBy: z.string().nullable(),
    createdAt: z.string(),
    warnings: z.array(
      z.object({ variantId: z.uuid(), code: z.literal('over_received'), extra: z.number().int() }),
    ),
    otherCosts: z.array(OtherCost).optional(),
    subtotal: Money.optional(),
    otherCostTotal: Money.optional(),
    total: Money.optional(),
    payment: z
      .object({
        id: z.uuid(),
        amount: Money,
        method: z.string(),
        reference: z.string().nullable(),
      })
      .nullable()
      .optional(),
  })
  .openapi('GoodsReceipt');

const GoodsReceiptSummary = z.object({
  id: z.uuid(),
  number: z.number().int(),
  reference: z.string(),
  receivedOn: z.string(),
  supplier: Ref.nullable(),
  purchaseOrderId: z.uuid().nullable(),
  units: z.number().int(),
  total: Money.optional(),
});

const SupplierPayment = z
  .object({
    id: z.uuid(),
    supplier: Ref,
    paidOn: z.string(),
    amount: Money,
    method: z.enum(SPEND_METHODS),
    reference: z.string().nullable(),
    note: z.string().nullable(),
    goodsReceiptId: z.uuid().nullable(),
    recordedBy: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('SupplierPayment');

const CostChange = z
  .object({
    id: z.uuid(),
    oldCost: Money.nullable(),
    newCost: Money.nullable(),
    onHand: z.number().int(),
    source: z.enum(COST_SOURCES),
    referenceType: z.string().nullable(),
    referenceId: z.uuid().nullable(),
    actorType: z.string(),
    actorId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('CostChange');

const flag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const PURCHASING_ROUTES = {
  suppliers: r({
    method: 'get',
    path: '/suppliers',
    summary: 'Suppliers by name, with balances for purchasing.pay (purchasing.read)',
    request: { query: z.object({ q: z.string().max(100).optional(), archived: flag }) },
    responses: json(z.object({ items: z.array(Supplier) }), 'Suppliers'),
  }),
  createSupplier: r({
    method: 'post',
    path: '/suppliers',
    summary: 'A new supplier; an opening balance needs purchasing.pay (purchasing.write)',
    request: body(supplierInput),
    responses: json(Supplier, 'Created', 201),
  }),
  supplier: r({
    method: 'get',
    path: '/suppliers/{id}',
    summary: 'One supplier (purchasing.read)',
    request: { params: Id },
    responses: json(Supplier, 'Supplier'),
  }),
  updateSupplier: r({
    method: 'patch',
    path: '/suppliers/{id}',
    summary: 'Edit or archive a supplier (purchasing.write)',
    request: { params: Id, ...body(supplierPatch) },
    responses: json(Supplier, 'Updated'),
  }),
  supplierLedger: r({
    method: 'get',
    path: '/suppliers/{id}/ledger',
    summary: "The supplier's receipts and payments with the running balance (purchasing.pay)",
    request: { params: Id, query: z.object({ from: day.optional(), to: day.optional() }) },
    responses: json(Ledger, 'Ledger'),
  }),
  purchaseOrders: r({
    method: 'get',
    path: '/purchase-orders',
    summary: 'Purchase orders, newest first (purchasing.read)',
    request: {
      query: z.object({
        status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
        supplierId: z.uuid().optional(),
        ...cursor,
      }),
    },
    responses: json(Page(PurchaseOrderSummary, 'PurchaseOrderPage'), 'Purchase orders'),
  }),
  createPurchaseOrder: r({
    method: 'post',
    path: '/purchase-orders',
    summary: 'A draft purchase order (purchasing.write, catalog.cost)',
    request: body(purchaseOrderInput),
    responses: json(PurchaseOrder, 'Created', 201),
  }),
  reorder: r({
    method: 'get',
    path: '/purchase-orders/reorder',
    summary: "The supplier's variants at or below their low-stock threshold (purchasing.write)",
    request: { query: z.object({ supplierId: z.uuid() }) },
    responses: json(z.object({ items: z.array(ReorderLine) }), 'Suggestions'),
  }),
  purchaseOrder: r({
    method: 'get',
    path: '/purchase-orders/{id}',
    summary: 'One purchase order (purchasing.read)',
    request: { params: Id },
    responses: json(PurchaseOrder, 'Purchase order'),
  }),
  updatePurchaseOrder: r({
    method: 'patch',
    path: '/purchase-orders/{id}',
    summary:
      "Edit a draft, or what isn't received of an ordered PO (purchasing.write, catalog.cost)",
    request: { params: Id, ...body(purchaseOrderPatch) },
    responses: json(PurchaseOrder, 'Updated'),
  }),
  deletePurchaseOrder: r({
    method: 'delete',
    path: '/purchase-orders/{id}',
    summary: 'Delete a draft (purchasing.write)',
    request: { params: Id },
    responses: { 204: { description: 'Deleted' } },
  }),
  placePurchaseOrder: r({
    method: 'post',
    path: '/purchase-orders/{id}/place',
    summary: 'Send the PO to the supplier (purchasing.write)',
    request: { params: Id },
    responses: json(PurchaseOrder, 'Placed'),
  }),
  closePurchaseOrder: r({
    method: 'post',
    path: '/purchase-orders/{id}/close',
    summary: "Close a partly received PO: the rest won't come (purchasing.write)",
    request: { params: Id },
    responses: json(PurchaseOrder, 'Closed'),
  }),
  cancelPurchaseOrder: r({
    method: 'post',
    path: '/purchase-orders/{id}/cancel',
    summary: 'Cancel a PO nothing was received for (purchasing.write)',
    request: { params: Id },
    responses: json(PurchaseOrder, 'Cancelled'),
  }),
  goodsReceipts: r({
    method: 'get',
    path: '/goods-receipts',
    summary: 'Goods received, newest first (purchasing.read)',
    request: {
      query: z.object({
        supplierId: z.uuid().optional(),
        purchaseOrderId: z.uuid().optional(),
        from: day.optional(),
        to: day.optional(),
        ...cursor,
      }),
    },
    responses: json(Page(GoodsReceiptSummary, 'GoodsReceiptPage'), 'Receipts'),
  }),
  createGoodsReceipt: r({
    method: 'post',
    path: '/goods-receipts',
    summary:
      "Receive goods: an ordered PO's quantities (inventory.write), or with costs or without a PO (purchasing.write, catalog.cost); paying needs purchasing.pay",
    request: { headers: IdemHeader, ...body(goodsReceiptInput) },
    responses: json(GoodsReceipt, 'Received', 201),
  }),
  goodsReceipt: r({
    method: 'get',
    path: '/goods-receipts/{id}',
    summary: 'One receipt (purchasing.read)',
    request: { params: Id },
    responses: json(GoodsReceipt, 'Receipt'),
  }),
  supplierPayments: r({
    method: 'get',
    path: '/supplier-payments',
    summary: 'Payments to suppliers, newest first (purchasing.pay)',
    request: {
      query: z.object({
        supplierId: z.uuid().optional(),
        from: day.optional(),
        to: day.optional(),
        ...cursor,
      }),
    },
    responses: json(Page(SupplierPayment, 'SupplierPaymentPage'), 'Payments'),
  }),
  createSupplierPayment: r({
    method: 'post',
    path: '/supplier-payments',
    summary: 'Record a payment to a supplier (purchasing.pay)',
    request: { headers: IdemHeader, ...body(supplierPaymentInput) },
    responses: json(SupplierPayment, 'Recorded', 201),
  }),
  updateSupplierPayment: r({
    method: 'patch',
    path: '/supplier-payments/{id}',
    summary: 'Correct a payment; audited (purchasing.pay)',
    request: { params: Id, ...body(supplierPaymentPatch) },
    responses: json(SupplierPayment, 'Updated'),
  }),
  deleteSupplierPayment: r({
    method: 'delete',
    path: '/supplier-payments/{id}',
    summary: 'Remove a payment recorded by mistake; audited (purchasing.pay)',
    request: { params: Id },
    responses: { 204: { description: 'Deleted' } },
  }),
  costHistory: r({
    method: 'get',
    path: '/variants/{id}/cost-history',
    summary: "Every change of the variant's cost, newest first (catalog.cost)",
    request: { params: Id, query: z.object(cursor) },
    responses: json(Page(CostChange, 'CostHistoryPage'), 'History'),
  }),
} as const;

export function registerPurchasing(admin: OpenAPIHono<StaffEnv>): void {
  const R = PURCHASING_ROUTES;
  const actor = (c: { var: StaffEnv['Variables'] }) => c.var.staff.actor;
  const write = { write: true };

  admin.openapi(R.suppliers, async (c) =>
    c.json(await inStore(c, (tx) => listSuppliers(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.createSupplier, async (c) =>
    c.json(await inStore(c, (tx) => createSupplier(tx, actor(c), c.req.valid('json')), write), 201),
  );
  admin.openapi(R.supplier, async (c) =>
    c.json(await inStore(c, (tx) => getSupplier(tx, actor(c), c.req.valid('param').id)), 200),
  );
  admin.openapi(R.updateSupplier, async (c) =>
    c.json(
      await inStore(
        c,
        (tx) => updateSupplier(tx, actor(c), c.req.valid('param').id, c.req.valid('json')),
        write,
      ),
      200,
    ),
  );
  admin.openapi(R.supplierLedger, async (c) =>
    c.json(
      await inStore(c, (tx) =>
        supplierLedger(tx, actor(c), c.req.valid('param').id, c.req.valid('query')),
      ),
      200,
    ),
  );
  admin.openapi(R.purchaseOrders, async (c) =>
    c.json(await inStore(c, (tx) => listPurchaseOrders(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.createPurchaseOrder, async (c) =>
    c.json(
      await inStore(c, (tx) => createPurchaseOrder(tx, actor(c), c.req.valid('json')), write),
      201,
    ),
  );
  admin.openapi(R.reorder, async (c) =>
    c.json(
      {
        items: await inStore(c, (tx) =>
          reorderSuggestions(tx, actor(c), c.req.valid('query').supplierId),
        ),
      },
      200,
    ),
  );
  admin.openapi(R.purchaseOrder, async (c) =>
    c.json(await inStore(c, (tx) => getPurchaseOrder(tx, actor(c), c.req.valid('param').id)), 200),
  );
  admin.openapi(R.updatePurchaseOrder, async (c) =>
    c.json(
      await inStore(
        c,
        (tx) => updatePurchaseOrder(tx, actor(c), c.req.valid('param').id, c.req.valid('json')),
        write,
      ),
      200,
    ),
  );
  admin.openapi(R.deletePurchaseOrder, async (c) => {
    await inStore(c, (tx) => deletePurchaseOrder(tx, actor(c), c.req.valid('param').id), write);
    return c.body(null, 204);
  });
  for (const [route, run] of [
    [R.placePurchaseOrder, placePurchaseOrder],
    [R.closePurchaseOrder, closePurchaseOrder],
    [R.cancelPurchaseOrder, cancelPurchaseOrder],
  ] as const) {
    admin.openapi(route, async (c) =>
      c.json(await inStore(c, (tx) => run(tx, actor(c), c.req.valid('param').id), write), 200),
    );
  }

  admin.openapi(R.goodsReceipts, async (c) =>
    c.json(await inStore(c, (tx) => listGoodsReceipts(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.createGoodsReceipt, async (c) => {
    const input = c.req.valid('json');
    const key = c.req.header('idempotency-key');
    const result = await inStore(
      c,
      (tx) =>
        idempotent(
          c,
          tx,
          'goods_receipt',
          input,
          () => createGoodsReceipt(tx, actor(c), input, { idempotencyKey: key }),
          201,
        ),
      write,
    );
    return c.json(result.body as never, 201);
  });
  admin.openapi(R.goodsReceipt, async (c) =>
    c.json(await inStore(c, (tx) => getGoodsReceipt(tx, actor(c), c.req.valid('param').id)), 200),
  );

  admin.openapi(R.supplierPayments, async (c) =>
    c.json(await inStore(c, (tx) => listSupplierPayments(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.createSupplierPayment, async (c) => {
    const input = c.req.valid('json');
    const result = await inStore(
      c,
      (tx) =>
        idempotent(
          c,
          tx,
          'supplier_payment',
          input,
          () => createSupplierPayment(tx, actor(c), input),
          201,
        ),
      write,
    );
    return c.json(result.body as never, 201);
  });
  admin.openapi(R.updateSupplierPayment, async (c) =>
    c.json(
      await inStore(
        c,
        (tx) => updateSupplierPayment(tx, actor(c), c.req.valid('param').id, c.req.valid('json')),
        write,
      ),
      200,
    ),
  );
  admin.openapi(R.deleteSupplierPayment, async (c) => {
    await inStore(c, (tx) => deleteSupplierPayment(tx, actor(c), c.req.valid('param').id), write);
    return c.body(null, 204);
  });

  admin.openapi(R.costHistory, async (c) =>
    c.json(
      await inStore(c, (tx) =>
        variantCostHistory(tx, actor(c), c.req.valid('param').id, c.req.valid('query')),
      ),
      200,
    ),
  );
}
