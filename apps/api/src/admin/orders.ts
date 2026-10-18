// Orders, shipments, payments, customers, delivery zones, the blocklist and
// the dashboard under /v1/admin (phase-4-plan §6.2). Request bodies use the
// shared schemas the services validate again; each service checks its own
// permission. Every command that changes an order or a payment accepts an
// Idempotency-Key (PLAN.md), which the admin sends. Another store's IDs
// answer 404, and every route with an ID is in the isolation suite.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  addAddress,
  addOrderNote,
  blockPhone,
  cancelOrder,
  confirmOrder,
  createCustomer,
  createManualOrder,
  createPaymentLink,
  createShipment,
  createZone,
  dashboard,
  deleteAddress,
  deleteCustomer,
  deleteShipment,
  deleteZone,
  deliverShipment,
  editOrder,
  failShipment,
  getCustomer,
  getOrder,
  listBlockedPhones,
  listCustomers,
  listOrders,
  listZones,
  ordersForPrint,
  previewManualOrder,
  quoteDelivery,
  recordPayment,
  returnShipment,
  runIdempotent,
  setOrderTags,
  shipShipment,
  startProcessing,
  type TenantTx,
  unblockPhone,
  updateAddress,
  updateCustomer,
  updateZone,
} from '@managemind/core';
import { AppError } from '@managemind/shared';
import { GEO_VERSION, geoFilePath } from '@managemind/shared/geo';
import {
  addressInput,
  customerInput,
  customerPatch,
  deliverInput,
  deliveryZoneInput,
  failInput,
  manualOrderInput,
  manualPaymentInput,
  manualQuoteInput,
  noteInput,
  ORDER_TOKEN_TTL_SECONDS,
  orderEditInput,
  orderListQuery,
  orderTagsInput,
  reasonInput,
  shipmentInput,
  signOrderToken,
} from '@managemind/shared/orders';
import type { Context } from 'hono';
import { gatewayFor } from '../payments';
import { inStore, type StaffEnv } from './context';
import { storeUrlsFor } from './store-urls';

const Id = z.object({ id: z.uuid() });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const created = <T extends z.ZodType>(schema: T, description: string) => ({
  201: { content: { 'application/json': { schema } }, description },
});
const ok = (description: string) => ({ 204: { description } });
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const IdemHeader = z.object({ 'idempotency-key': z.string().min(8).max(255).optional() });

// ---- Response shapes -----------------------------------------------------------------

const Localized = z.object({ bn: z.string().optional(), en: z.string().optional() });
const Image = z
  .object({
    width: z.number(),
    height: z.number(),
    files: z.array(z.object({ width: z.number(), file: z.string() })),
    alt: z.string().nullable(),
  })
  .nullable();
const Address = z.object({
  divisionId: z.number().int(),
  districtId: z.number().int(),
  areaId: z.number().int(),
  line: z.string(),
  names: z.object({ division: Localized, district: Localized, area: Localized }),
});
const OrderSummary = z
  .object({
    id: z.uuid(),
    number: z.number().int(),
    displayNumber: z.string(),
    status: z.string(),
    paymentStatus: z.string(),
    deliveryStatus: z.string(),
    source: z.string(),
    name: z.string(),
    phone: z.string().openapi({ description: 'Masked without customers.read' }),
    area: Localized.nullable(),
    zoneName: Localized.nullable(),
    total: z.number().int(),
    itemCount: z.number().int(),
    tags: z.array(z.string()),
    cancelledBy: z.string().nullable(),
    placedAt: z.string(),
  })
  .openapi('OrderSummary');
const Money = z.number().int();
const OrderTotals = z.object({
  subtotal: Money,
  discountTotal: Money,
  deliveryFee: Money,
  deliveryDiscount: Money,
  vatTotal: Money,
  vatIncluded: z.boolean(),
  rounding: Money,
  total: Money,
  paidTotal: Money,
  codDue: Money,
  refundDue: Money,
  refundedTotal: Money,
});
export const OrderDetail = z
  .object({
    id: z.uuid(),
    number: z.number().int(),
    displayNumber: z.string(),
    status: z.string(),
    paymentStatus: z.string(),
    deliveryStatus: z.string(),
    returnStatus: z.string(),
    source: z.string(),
    locale: z.string(),
    customer: z.object({
      id: z.uuid(),
      name: z.string(),
      phone: z.string(),
      email: z.string().nullable(),
      orderCount: z.number().int(),
    }),
    contact: z.object({ name: z.string(), phone: z.string(), email: z.string().optional() }),
    address: Address.nullable(),
    zone: z.object({ id: z.uuid().nullable(), name: Localized.nullable() }),
    lines: z.array(
      z.object({
        id: z.uuid(),
        variantId: z.uuid(),
        productId: z.uuid(),
        title: Localized,
        optionLabels: z.array(Localized),
        sku: z.string().nullable(),
        image: Image,
        unitPrice: Money,
        compareAtPrice: Money.nullable(),
        costPrice: Money.nullable().optional().openapi({ description: 'Only with catalog.cost' }),
        quantity: z.number().int(),
        shippedQuantity: z.number().int(),
        subtotal: Money,
        discount: Money,
        vatRateBp: z.number().int(),
        vat: Money,
        total: Money,
        weightGrams: z.number().int().nullable(),
      }),
    ),
    adjustments: z.array(
      z.object({
        id: z.uuid(),
        kind: z.string(),
        target: z.string(),
        title: Localized,
        code: z.string().nullable(),
        amount: Money,
        reason: z.string().nullable(),
      }),
    ),
    totals: OrderTotals,
    flags: z.array(z.string()).openapi({ description: 'payment_risk, late_payment' }),
    payments: z.array(
      z.object({
        id: z.uuid(),
        provider: z.string(),
        method: z.string(),
        status: z.string(),
        amount: Money,
        reference: z.string().nullable(),
        settledAt: z.string().nullable(),
        createdAt: z.string(),
        gateway: z
          .object({
            valId: z.string().nullable(),
            bankTranId: z.string().nullable(),
            risky: z.boolean(),
            cardType: z.string().nullable(),
            link: z.boolean(),
          })
          .nullable()
          .openapi({ description: 'SSLCommerz details, with payments.read' }),
      }),
    ),
    shipments: z.array(
      z.object({
        id: z.uuid(),
        status: z.string(),
        carrier: z.string().nullable(),
        trackingNumber: z.string().nullable(),
        trackingUrl: z.string().nullable(),
        shippedAt: z.string().nullable(),
        deliveredAt: z.string().nullable(),
        failedReason: z.string().nullable(),
        lines: z.array(z.object({ orderLineId: z.uuid(), quantity: z.number().int() })),
      }),
    ),
    timeline: z.array(
      z.object({
        kind: z.enum(['history', 'note']),
        id: z.uuid(),
        machine: z.string().optional(),
        from: z.string().nullable().optional(),
        to: z.string().nullable().optional(),
        event: z.string().optional(),
        reason: z.string().nullable().optional(),
        body: z.string().optional(),
        actorType: z.string().optional(),
        actorId: z.uuid().nullable(),
        data: z.unknown().optional(),
        createdAt: z.string(),
      }),
    ),
    customerNote: z.string().nullable(),
    tags: z.array(z.string()),
    metadata: z.record(z.string(), z.unknown()),
    cancelReason: z.string().nullable(),
    cancelledBy: z.string().nullable(),
    placedAt: z.string(),
    confirmedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    actions: z.array(z.string()),
  })
  .openapi('OrderDetail');
const OrderState = z
  .object({
    id: z.uuid(),
    number: z.number().int(),
    status: z.string(),
    paymentStatus: z.string(),
    deliveryStatus: z.string(),
  })
  .openapi('OrderState');
export const QuoteView = z
  .object({
    lines: z.array(
      z.object({
        key: z.string(),
        variantId: z.uuid(),
        title: Localized,
        optionLabels: z.array(Localized),
        sku: z.string().nullable(),
        image: Image,
        unitPrice: Money,
        quantity: z.number().int(),
        subtotal: Money,
        discount: Money,
        total: Money,
        maxQuantity: z.number().int().nullable(),
        problem: z.string().nullable(),
      }),
    ),
    zone: z.object({ id: z.uuid(), name: Localized, estimate: Localized }).nullable(),
    weightGrams: z.number().int(),
    totals: z.object({
      subtotal: Money,
      discountTotal: Money,
      deliveryFee: Money,
      deliveryDiscount: Money,
      vatTotal: Money,
      vatIncluded: z.boolean(),
      rounding: Money,
      total: Money,
    }),
    promotions: z.array(
      z.object({
        promotionId: z.uuid(),
        title: Localized,
        amount: Money,
        target: z.string(),
        code: z.string().optional(),
      }),
    ),
    code: z.object({ code: z.string(), status: z.string() }).nullable(),
    manualDiscount: z.object({ amount: Money, reason: z.string() }).nullable(),
  })
  .openapi('OrderQuote');
const PlacedOrder = z
  .object({
    id: z.uuid(),
    number: z.number().int(),
    displayNumber: z.string(),
    status: z.string(),
    total: Money,
    codAmount: Money,
    phone: z.string(),
    locale: z.string(),
    placedAt: z.string(),
  })
  .openapi('ManualOrderPlaced');
const Customer = z
  .object({
    id: z.uuid(),
    phone: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    tags: z.array(z.string()),
    note: z.string().nullable(),
    orderCount: z.number().int(),
    totalSpent: Money,
    firstOrderAt: z.string().nullable(),
    lastOrderAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Customer');
const CustomerAddress = z
  .object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string(),
    divisionId: z.number().int(),
    districtId: z.number().int(),
    areaId: z.number().int(),
    line: z.string(),
    label: z.string().nullable(),
    isDefault: z.boolean(),
  })
  .openapi('CustomerAddress');
const CustomerDetail = Customer.extend({
  addresses: z.array(CustomerAddress),
  orders: z.array(
    z.object({
      id: z.uuid(),
      number: z.number().int(),
      status: z.string(),
      paymentStatus: z.string(),
      deliveryStatus: z.string(),
      total: Money,
      placedAt: z.string(),
    }),
  ),
}).openapi('CustomerDetail');
const Zone = z
  .object({
    id: z.uuid(),
    name: Localized,
    fee: Money,
    freeWeightGrams: z.number().int().nullable(),
    feePerExtraKg: Money.nullable(),
    estimate: Localized,
    isFallback: z.boolean(),
    position: z.number().int(),
    active: z.boolean(),
    districtIds: z.array(z.number().int()),
    areaIds: z.array(z.number().int()),
  })
  .openapi('DeliveryZone');
const BlockedPhone = z
  .object({
    phone: z.string(),
    reason: z.string(),
    createdBy: z.uuid().nullable(),
    createdAt: z.string(),
  })
  .openapi('BlockedPhone');
const DashboardView = z
  .object({
    counts: z.object({
      awaitingConfirmation: z.number().int(),
      toShip: z.number().int(),
      cancelledByShopper7d: z.number().int(),
      lowStock: z.number().int(),
    }),
    sales: z
      .object({
        today: z.object({ orders: z.number().int(), total: Money }),
        month: z.object({ orders: z.number().int(), total: Money }),
        days: z.array(z.object({ date: z.string(), orders: z.number().int(), total: Money })),
      })
      .nullable()
      .openapi({ description: 'Only with reports.read' }),
  })
  .openapi('Dashboard');
const PrintData = z
  .object({
    store: z.object({
      name: z.string(),
      profile: z.record(z.string(), z.unknown()),
      tax: z.record(z.string(), z.unknown()),
    }),
    orders: z.array(OrderDetail),
  })
  .openapi('OrderPrint');

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });

const customerQuery = z.object({
  q: z.string().trim().max(100).optional(),
  tag: z.string().max(50).optional(),
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const AddressParams = z.object({ id: z.uuid(), addressId: z.uuid() });

export const ORDER_ROUTES = {
  orders: r({
    method: 'get',
    path: '/orders',
    summary: 'Orders, newest first, with filters and search (orders.read)',
    request: { query: orderListQuery },
    responses: json(
      z.object({ items: z.array(OrderSummary), nextCursor: z.string().nullable() }),
      'Orders',
    ),
  }),
  order: r({
    method: 'get',
    path: '/orders/{id}',
    summary: 'An order with lines, payments, shipments and its timeline (orders.read)',
    request: { params: Id },
    responses: json(OrderDetail, 'Order'),
  }),
  createOrder: r({
    method: 'post',
    path: '/orders',
    summary: 'A manual order: Facebook, phone or walk-in (orders.write; accepts Idempotency-Key)',
    request: { headers: IdemHeader, ...body(manualOrderInput) },
    responses: created(PlacedOrder, 'Placed'),
  }),
  quoteOrder: r({
    method: 'post',
    path: '/orders/quote',
    summary: 'Prices a manual order before it is saved, and warns about a blocked phone',
    request: body(manualQuoteInput),
    responses: json(
      z.object({ quote: QuoteView, blocked: z.boolean(), firstOrder: z.boolean() }),
      'Quote',
    ),
  }),
  print: r({
    method: 'get',
    path: '/orders/print',
    summary: 'Selected orders for invoices and packing slips, with the business details',
    request: { query: z.object({ ids: z.string().max(4000) }) },
    responses: json(PrintData, 'Orders'),
  }),
  confirm: r({
    method: 'post',
    path: '/orders/{id}/confirm',
    summary: 'Confirm (orders.write; accepts Idempotency-Key)',
    request: { params: Id, headers: IdemHeader },
    responses: json(OrderState, 'Confirmed'),
  }),
  process: r({
    method: 'post',
    path: '/orders/{id}/process',
    summary: 'Start processing (orders.write)',
    request: { params: Id, headers: IdemHeader },
    responses: json(OrderState, 'Processing'),
  }),
  cancel: r({
    method: 'post',
    path: '/orders/{id}/cancel',
    summary: 'Cancel with a reason while nothing is shipped (orders.write)',
    request: { params: Id, headers: IdemHeader, ...body(reasonInput) },
    responses: json(OrderState, 'Cancelled'),
  }),
  editPreview: r({
    method: 'post',
    path: '/orders/{id}/edit/preview',
    summary: 'The new totals of an edit, without saving it',
    request: { params: Id, ...body(orderEditInput) },
    responses: json(
      z.object({
        quote: QuoteView,
        dropped: z.array(z.object({ promotionId: z.uuid(), title: Localized })),
        refundDue: Money,
      }),
      'Preview',
    ),
  }),
  edit: r({
    method: 'post',
    path: '/orders/{id}/edit',
    summary: 'Edit before anything ships (orders.write; accepts Idempotency-Key)',
    request: { params: Id, headers: IdemHeader, ...body(orderEditInput) },
    responses: json(OrderDetail, 'Edited'),
  }),
  note: r({
    method: 'post',
    path: '/orders/{id}/notes',
    summary: 'An internal note (orders.write)',
    request: { params: Id, ...body(noteInput) },
    responses: created(z.object({ id: z.uuid() }), 'Added'),
  }),
  tags: r({
    method: 'patch',
    path: '/orders/{id}',
    summary: 'Set the order’s tags (orders.write)',
    request: { params: Id, ...body(orderTagsInput) },
    responses: json(z.object({ tags: z.array(z.string()) }), 'Tags'),
  }),
  payment: r({
    method: 'post',
    path: '/orders/{id}/payments',
    summary: 'Record a payment already received (orders.write; accepts Idempotency-Key)',
    request: { params: Id, headers: IdemHeader, ...body(manualPaymentInput) },
    responses: json(OrderState, 'Recorded'),
  }),
  paymentLink: r({
    method: 'post',
    path: '/orders/{id}/payment-link',
    summary:
      'A link the shopper pays the unpaid amount from, online (payments.read, orders.write; reuses one waiting)',
    request: { params: Id },
    responses: json(
      z.object({ url: z.string(), amount: Money, expiresAt: z.string() }),
      'The link',
    ),
  }),
  createShipment: r({
    method: 'post',
    path: '/orders/{id}/shipments',
    summary: 'A shipment of chosen lines (orders.write; accepts Idempotency-Key)',
    request: { params: Id, headers: IdemHeader, ...body(shipmentInput) },
    responses: created(z.object({ id: z.uuid() }), 'Created'),
  }),
  ship: r({
    method: 'post',
    path: '/shipments/{id}/ship',
    summary: 'Mark shipped: the stock is sold from the reservation',
    request: { params: Id, headers: IdemHeader },
    responses: json(OrderState, 'Shipped'),
  }),
  deliver: r({
    method: 'post',
    path: '/shipments/{id}/deliver',
    summary: 'Mark delivered, with "cash collected" (default true)',
    request: { params: Id, headers: IdemHeader, ...body(deliverInput) },
    responses: json(OrderState, 'Delivered'),
  }),
  fail: r({
    method: 'post',
    path: '/shipments/{id}/fail',
    summary: 'The courier couldn’t deliver',
    request: { params: Id, headers: IdemHeader, ...body(failInput) },
    responses: json(OrderState, 'Failed'),
  }),
  return: r({
    method: 'post',
    path: '/shipments/{id}/return',
    summary: 'A failed shipment came back: back in stock',
    request: { params: Id, headers: IdemHeader },
    responses: json(OrderState, 'Returned'),
  }),
  deleteShipment: r({
    method: 'delete',
    path: '/shipments/{id}',
    summary: 'Delete a shipment not yet shipped',
    request: { params: Id },
    responses: ok('Deleted'),
  }),
  customers: r({
    method: 'get',
    path: '/customers',
    summary: 'Customers, searched by phone or name, filtered by tag (customers.read)',
    request: { query: customerQuery },
    responses: json(
      z.object({ items: z.array(Customer), nextCursor: z.string().nullable() }),
      'Customers',
    ),
  }),
  createCustomer: r({
    method: 'post',
    path: '/customers',
    summary: 'Add a customer (customers.write)',
    request: body(customerInput),
    responses: created(Customer, 'Created'),
  }),
  customer: r({
    method: 'get',
    path: '/customers/{id}',
    summary: 'A customer with addresses and orders (customers.read)',
    request: { params: Id },
    responses: json(CustomerDetail, 'Customer'),
  }),
  updateCustomer: r({
    method: 'patch',
    path: '/customers/{id}',
    summary: 'Edit a customer (customers.write)',
    request: { params: Id, ...body(customerPatch) },
    responses: json(Customer, 'Updated'),
  }),
  deleteCustomer: r({
    method: 'delete',
    path: '/customers/{id}',
    summary: 'Delete a customer; past orders keep their details (customers.write)',
    request: { params: Id },
    responses: ok('Deleted'),
  }),
  addAddress: r({
    method: 'post',
    path: '/customers/{id}/addresses',
    summary: 'Add an address (customers.write; at most 10)',
    request: { params: Id, ...body(addressInput) },
    responses: created(CustomerAddress, 'Added'),
  }),
  updateAddress: r({
    method: 'patch',
    path: '/customers/{id}/addresses/{addressId}',
    summary: 'Edit an address',
    request: { params: AddressParams, ...body(z.record(z.string(), z.unknown())) },
    responses: json(CustomerAddress, 'Updated'),
  }),
  deleteAddress: r({
    method: 'delete',
    path: '/customers/{id}/addresses/{addressId}',
    summary: 'Delete an address',
    request: { params: AddressParams },
    responses: ok('Deleted'),
  }),
  geoVersion: r({
    method: 'get',
    path: '/geo/version',
    summary: 'The geography file’s version and path (the admin loads it from the store host)',
    responses: json(z.object({ version: z.string(), path: z.string() }), 'Version'),
  }),
  zones: r({
    method: 'get',
    path: '/delivery-zones',
    summary: 'Delivery zones (settings.read)',
    responses: json(z.array(Zone), 'Zones'),
  }),
  createZone: r({
    method: 'post',
    path: '/delivery-zones',
    summary: 'Add a zone (settings.write; at most 20)',
    request: body(deliveryZoneInput),
    responses: created(Zone, 'Created'),
  }),
  updateZone: r({
    method: 'patch',
    path: '/delivery-zones/{id}',
    summary: 'Edit a zone (settings.write)',
    request: { params: Id, ...body(z.record(z.string(), z.unknown())) },
    responses: json(Zone, 'Updated'),
  }),
  deleteZone: r({
    method: 'delete',
    path: '/delivery-zones/{id}',
    summary: 'Delete a zone; past orders keep its name and fee (settings.write)',
    request: { params: Id },
    responses: ok('Deleted'),
  }),
  quoteZone: r({
    method: 'post',
    path: '/delivery-zones/quote',
    summary: 'The fee for an area and weight',
    request: body(
      z.object({
        areaId: z.number().int().min(1),
        weightGrams: z.number().int().min(0).max(1_000_000),
      }),
    ),
    responses: json(z.object({ zone: Zone.nullable(), fee: Money.nullable() }), 'Fee'),
  }),
  blocked: r({
    method: 'get',
    path: '/blocked-phones',
    summary: 'The phone blocklist (settings.read)',
    responses: json(z.array(BlockedPhone), 'Blocked phones'),
  }),
  block: r({
    method: 'post',
    path: '/blocked-phones',
    summary: 'Block a phone with a reason (settings.write)',
    request: body(z.object({ phone: z.string().max(32), reason: z.string().max(300) })),
    responses: created(BlockedPhone, 'Blocked'),
  }),
  unblock: r({
    method: 'delete',
    path: '/blocked-phones/{phone}',
    summary: 'Unblock a phone (settings.write)',
    request: { params: z.object({ phone: z.string().max(32) }) },
    responses: ok('Unblocked'),
  }),
  dashboard: r({
    method: 'get',
    path: '/dashboard',
    summary: 'Today’s and this month’s orders and sales, and what is waiting',
    responses: json(DashboardView, 'Dashboard'),
  }),
} as const;

const actor = (c: Context<StaffEnv>) => c.var.staff.actor;
const write = { write: true } as const;

/** Runs a command under the request's Idempotency-Key, when it has one. */
function idempotent<T>(
  c: Context<StaffEnv>,
  tx: TenantTx,
  scope: string,
  request: unknown,
  fn: () => Promise<T>,
  status = 200,
): Promise<{ body: unknown; status: number }> {
  const key = c.req.header('idempotency-key');
  if (!key) return fn().then((body) => ({ body, status }));
  return runIdempotent(tx, { scope: `admin.${scope}`, key, request }, async () => ({
    status,
    body: await fn(),
  }));
}

const state = (o: {
  id: string;
  number: number;
  status: string;
  paymentStatus: string;
  deliveryStatus: string;
}) => ({
  id: o.id,
  number: o.number,
  status: o.status,
  paymentStatus: o.paymentStatus,
  deliveryStatus: o.deliveryStatus,
});

/** A quote without the engine's internals. */
export const quoteView = (q: Awaited<ReturnType<typeof previewManualOrder>>['quote']) => ({
  lines: q.lines.map((l) => ({
    key: l.key,
    variantId: l.variantId,
    title: l.title,
    optionLabels: l.optionLabels,
    sku: l.sku,
    image: l.image,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    subtotal: l.subtotal,
    discount: l.discount,
    total: l.total,
    maxQuantity: l.maxQuantity,
    problem: l.problem,
  })),
  zone: q.zone,
  weightGrams: q.weightGrams,
  totals: {
    subtotal: q.totals.subtotal,
    discountTotal: q.totals.discountTotal,
    deliveryFee: q.totals.deliveryFee,
    deliveryDiscount: q.totals.deliveryDiscount,
    vatTotal: q.totals.vatTotal,
    vatIncluded: q.totals.vatIncluded,
    rounding: q.totals.rounding,
    total: q.totals.total,
  },
  promotions: q.promotions.map((p) => ({
    promotionId: p.promotionId,
    title: p.title,
    amount: p.amount,
    target: p.target,
    ...(p.code ? { code: p.code } : {}),
  })),
  code: q.code,
  manualDiscount: q.manualDiscount,
});

export function registerOrders(admin: OpenAPIHono<StaffEnv>): void {
  const R = ORDER_ROUTES;
  const id = (c: Context<StaffEnv>) => c.req.param('id') as string;

  admin.openapi(R.orders, async (c) =>
    c.json(await inStore(c, (tx) => listOrders(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.quoteOrder, async (c) => {
    const input = c.req.valid('json');
    const result = await inStore(c, (tx) => previewManualOrder(tx, actor(c), input));
    return c.json({ ...result, quote: quoteView(result.quote) }, 200);
  });
  admin.openapi(R.print, async (c) => {
    const ids = c.req.valid('query').ids.split(',').filter(Boolean);
    if (ids.some((x) => !/^[0-9a-f-]{36}$/.test(x))) throw new AppError('validation_failed');
    return c.json((await inStore(c, (tx) => ordersForPrint(tx, actor(c), ids))) as never, 200);
  });
  admin.openapi(R.order, async (c) =>
    c.json(await inStore(c, (tx) => getOrder(tx, actor(c), id(c))), 200),
  );
  admin.openapi(R.createOrder, async (c) => {
    const input = c.req.valid('json');
    const result = await inStore(
      c,
      (tx) =>
        idempotent(c, tx, 'create_order', input, () => createManualOrder(tx, actor(c), input), 201),
      write,
    );
    return c.json(result.body as never, 201);
  });

  const command = <B>(
    route: Parameters<typeof admin.openapi>[0],
    scope: string,
    run: (tx: TenantTx, c: Context<StaffEnv>, input: B) => Promise<unknown>,
    shape: (out: never) => unknown = (o) => o,
    status: 200 | 201 = 200,
  ) =>
    admin.openapi(route, (async (c: Context<StaffEnv>) => {
      const input = (c.req.header('content-type')?.includes('json') ? await c.req.json() : {}) as B;
      const result = await inStore(
        c,
        (tx) =>
          idempotent(
            c,
            tx,
            scope,
            { id: id(c), input },
            async () => shape((await run(tx, c, input)) as never),
            status,
          ),
        write,
      );
      return c.json(result.body as never, status);
    }) as never);

  command(R.confirm, 'confirm', (tx, c) => confirmOrder(tx, actor(c), id(c)), state);
  command(R.process, 'process', (tx, c) => startProcessing(tx, actor(c), id(c)), state);
  command<{ reason: string }>(
    R.cancel,
    'cancel',
    (tx, c, input) => cancelOrder(tx, actor(c), id(c), reasonInput.parse(input)),
    state,
  );
  command(R.edit, 'edit', async (tx, c, input) => {
    await editOrder(tx, actor(c), id(c), input);
    return getOrder(tx, actor(c), id(c));
  });
  command(R.payment, 'payment', (tx, c, input) => recordPayment(tx, actor(c), id(c), input), state);
  admin.openapi(R.paymentLink, async (c) => {
    const tenantId = c.var.staff.actor.tenantId as string;
    const now = new Date();
    const link = await inStore(
      c,
      async (tx) => {
        // The order first, so another store's ID is a 404; a refusal after rolls it back.
        const { amount } = await createPaymentLink(tx, actor(c), id(c));
        if (!(await gatewayFor(tx, c.env))) {
          throw new AppError('conflict', { detail: 'Connect SSLCommerz first' });
        }
        return { amount, track: (await storeUrlsFor(c.var.config, tx)).page('track') };
      },
      { write: true },
    );
    const token = await signOrderToken('pay', tenantId, id(c), c.var.config.AUTH_SECRET, now);
    const expiresAt = new Date(now.getTime() + ORDER_TOKEN_TTL_SECONDS.pay * 1000).toISOString();
    return c.json({ url: `${link.track}#${token}`, amount: link.amount, expiresAt }, 200);
  });
  command(
    R.createShipment,
    'shipment',
    (tx, c, input) => createShipment(tx, actor(c), id(c), input),
    (o) => o,
    201,
  );
  command(R.ship, 'ship', (tx, c) => shipShipment(tx, actor(c), id(c)), state);
  command(
    R.deliver,
    'deliver',
    (tx, c, input) => deliverShipment(tx, actor(c), id(c), input),
    state,
  );
  command(R.fail, 'fail', (tx, c, input) => failShipment(tx, actor(c), id(c), input), state);
  command(R.return, 'return', (tx, c) => returnShipment(tx, actor(c), id(c)), state);

  admin.openapi(R.editPreview, async (c) => {
    const input = c.req.valid('json');
    const result = await inStore(c, (tx) =>
      editOrder(tx, actor(c), id(c), input, { preview: true }),
    );
    return c.json(
      {
        quote: quoteView(result.quote),
        dropped: result.dropped as { promotionId: string; title: { bn?: string; en?: string } }[],
        refundDue: result.refundDue,
      },
      200,
    );
  });
  admin.openapi(R.note, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => addOrderNote(tx, actor(c), id(c), input), write), 201);
  });
  admin.openapi(R.tags, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => setOrderTags(tx, actor(c), id(c), input), write), 200);
  });
  admin.openapi(R.deleteShipment, async (c) => {
    await inStore(c, (tx) => deleteShipment(tx, actor(c), id(c)), write);
    return c.body(null, 204);
  });

  // ---- Customers
  admin.openapi(R.customers, async (c) =>
    c.json(await inStore(c, (tx) => listCustomers(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.createCustomer, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => createCustomer(tx, actor(c), input), write), 201);
  });
  admin.openapi(R.customer, async (c) =>
    c.json(await inStore(c, (tx) => getCustomer(tx, actor(c), id(c))), 200),
  );
  admin.openapi(R.updateCustomer, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => updateCustomer(tx, actor(c), id(c), input), write), 200);
  });
  admin.openapi(R.deleteCustomer, async (c) => {
    await inStore(c, (tx) => deleteCustomer(tx, actor(c), id(c)), write);
    return c.body(null, 204);
  });
  admin.openapi(R.addAddress, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => addAddress(tx, actor(c), id(c), input), write), 201);
  });
  admin.openapi(R.updateAddress, async (c) => {
    const input = c.req.valid('json');
    const { addressId } = c.req.valid('param');
    return c.json(
      await inStore(c, (tx) => updateAddress(tx, actor(c), id(c), addressId, input), write),
      200,
    );
  });
  admin.openapi(R.deleteAddress, async (c) => {
    const { addressId } = c.req.valid('param');
    await inStore(c, (tx) => deleteAddress(tx, actor(c), id(c), addressId), write);
    return c.body(null, 204);
  });

  // ---- Delivery and the blocklist
  admin.openapi(R.geoVersion, async (c) =>
    c.json({ version: GEO_VERSION, path: geoFilePath() }, 200),
  );
  admin.openapi(R.zones, async (c) =>
    c.json(await inStore(c, (tx) => listZones(tx, actor(c))), 200),
  );
  admin.openapi(R.createZone, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => createZone(tx, actor(c), input), write), 201);
  });
  admin.openapi(R.updateZone, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => updateZone(tx, actor(c), id(c), input), write), 200);
  });
  admin.openapi(R.deleteZone, async (c) => {
    await inStore(c, (tx) => deleteZone(tx, actor(c), id(c)), write);
    return c.body(null, 204);
  });
  admin.openapi(R.quoteZone, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => quoteDelivery(tx, actor(c), input)), 200);
  });
  admin.openapi(R.blocked, async (c) =>
    c.json(await inStore(c, (tx) => listBlockedPhones(tx, actor(c))), 200),
  );
  admin.openapi(R.block, async (c) => {
    const input = c.req.valid('json');
    return c.json(await inStore(c, (tx) => blockPhone(tx, actor(c), input), write), 201);
  });
  admin.openapi(R.unblock, async (c) => {
    const { phone } = c.req.valid('param');
    await inStore(c, (tx) => unblockPhone(tx, actor(c), decodeURIComponent(phone)), write);
    return c.body(null, 204);
  });

  admin.openapi(R.dashboard, async (c) => {
    const d = await inStore(c, (tx) => dashboard(tx, actor(c)));
    c.header('Cache-Control', 'private, max-age=60');
    return c.json(d, 200);
  });
}
