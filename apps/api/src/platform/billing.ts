// Platform → Billing (phase-5b-plan §3.7, §5): our invoices to the stores,
// payments recorded by hand, and our own invoice details (Q8). Reading is for
// any platform role; creating, issuing, voiding and recording payments are
// for super admins (§4).
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createManualInvoice,
  getInvoice,
  getIssuer,
  type Invoice,
  issueInvoice,
  issuerInput,
  listInvoices,
  recordInvoicePayment,
  setIssuer,
  voidInvoice,
  withPlatform,
} from '@managemind/core';
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { BILLING_PAYMENT_METHODS, dhakaDate, INVOICE_STATUSES } from '@managemind/shared/billing';
import { eq } from 'drizzle-orm';
import { relayTo, type StaffEnv } from '../admin/context';

const Id = z.object({ id: z.uuid() });
const json = <T extends z.ZodType>(schema: T, description: string, status = 200) => ({
  [status]: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/platform${config.path}`, tags: ['platform'] } as C & {
    tags: string[];
  });

const Localized = z.object({ bn: z.string(), en: z.string() });
const LineKind = z.enum(['setup', 'plan', 'overage', 'adjustment', 'vat']);
// Rebuilt with this file's z, which carries .openapi().
const Issuer = z.object(issuerInput.shape).strict().openapi('InvoiceIssuer');
const InvoiceSummary = z
  .object({
    id: z.uuid(),
    number: z.string().nullable(),
    tenantId: z.uuid(),
    storeName: z.string(),
    status: z.enum(INVOICE_STATUSES),
    overdue: z.boolean(),
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable(),
    /** A draft is issued by the daily job after this, unless acted on first. */
    issueAfter: z.date().nullable(),
    issuedOn: z.string().nullable(),
    dueOn: z.string().nullable(),
    total: z.number().int(),
    amountPaid: z.number().int(),
    amountDue: z.number().int(),
    createdAt: z.date(),
  })
  .openapi('PlatformInvoiceSummary');
const InvoiceDetail = InvoiceSummary.extend({
  subtotal: z.number().int(),
  vat: z.number().int(),
  paidAt: z.date().nullable(),
  voidedAt: z.date().nullable(),
  voidReason: z.string().nullable(),
  issuer: z.record(z.string(), z.unknown()).nullable(),
  billedTo: z.record(z.string(), z.unknown()).nullable(),
  lines: z.array(
    z.object({
      kind: LineKind,
      description: Localized,
      quantity: z.number().int(),
      unitPrice: z.number().int(),
      amount: z.number().int(),
      metric: z.string().nullable(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.uuid(),
      amount: z.number().int(),
      method: z.enum(BILLING_PAYMENT_METHODS),
      reference: z.string().nullable(),
      paidOn: z.string(),
      createdAt: z.date(),
    }),
  ),
}).openapi('PlatformInvoice');

export const PLATFORM_BILLING_ROUTES = {
  invoices: r({
    method: 'get',
    path: '/invoices',
    summary: 'Our invoices, newest first, with filters (support)',
    request: {
      query: z.object({
        status: z.enum(INVOICE_STATUSES).optional(),
        tenantId: z.uuid().optional(),
        /** overdue: issued and past due; week: issued and due within 7 days. */
        due: z.enum(['overdue', 'week']).optional(),
        before: z.iso.datetime().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
    },
    responses: json(
      z.object({ items: z.array(InvoiceSummary), next: z.string().nullable() }),
      'Invoices',
    ),
  }),
  invoice: r({
    method: 'get',
    path: '/invoices/{id}',
    summary: 'One invoice with its lines and payments (support)',
    request: { params: Id },
    responses: json(InvoiceDetail, 'Invoice'),
  }),
  createInvoice: r({
    method: 'post',
    path: '/tenants/{id}/invoices',
    summary: 'A manual invoice: a one-off charge or a credit (super_admin)',
    request: {
      params: Id,
      ...body(
        z.object({
          lines: z
            .array(
              z.object({
                kind: z.enum(['setup', 'plan', 'overage', 'adjustment']),
                description: Localized,
                quantity: z.number().int().min(1),
                unitPrice: z.number().int(),
              }),
            )
            .min(1)
            .max(50),
          issueNow: z.boolean().optional(),
        }),
      ),
    },
    responses: json(InvoiceDetail, 'Created', 201),
  }),
  issueInvoice: r({
    method: 'post',
    path: '/invoices/{id}/issue',
    summary: 'Issue a draft now: it gets its number and the owners are emailed (super_admin)',
    request: { params: Id },
    responses: json(InvoiceDetail, 'Issued'),
  }),
  voidInvoice: r({
    method: 'post',
    path: '/invoices/{id}/void',
    summary: 'Void a draft or an unpaid invoice; its number is kept (super_admin)',
    request: { params: Id, ...body(z.object({ reason: z.string().trim().min(3).max(500) })) },
    responses: json(InvoiceDetail, 'Voided'),
  }),
  recordPayment: r({
    method: 'post',
    path: '/invoices/{id}/payments',
    summary: 'Record a bank, bKash, Nagad or cash payment (super_admin)',
    request: {
      params: Id,
      ...body(
        z.object({
          amount: z.number().int().min(1),
          method: z.enum(['bank', 'bkash', 'nagad', 'cash']),
          reference: z.string().trim().max(100).optional(),
          paidOn: z.iso.date(),
        }),
      ),
    },
    responses: json(InvoiceDetail, 'Recorded'),
  }),
  issuer: r({
    method: 'get',
    path: '/billing/issuer',
    summary: 'Our invoice details: name, address, VAT, how to pay (support)',
    responses: json(z.union([Issuer, z.null()]), 'Invoice details'),
  }),
  setIssuer: r({
    method: 'put',
    path: '/billing/issuer',
    summary: 'Set our invoice details; new invoices carry them (super_admin)',
    request: body(z.record(z.string(), z.unknown())),
    responses: json(Issuer, 'Saved'),
  }),
} as const;

/** Registered by registerPlatform, after its session and two-factor checks. */
export function registerPlatformBilling(platform: OpenAPIHono<StaffEnv>): void {
  const R = PLATFORM_BILLING_ROUTES;
  const today = () => dhakaDate(new Date());

  platform.openapi(R.invoices, async (c) => {
    const { status, tenantId, due, before, limit = 50 } = c.req.valid('query');
    if (!c.var.staff.actor.platformRole) throw new AppError('forbidden');
    const items = await withPlatform(c.var.staff.client, (tx) =>
      listInvoices(
        tx,
        c.var.staff.actor,
        {
          limit,
          ...(status ? { status } : {}),
          ...(tenantId ? { tenantId } : {}),
          ...(due === 'overdue' ? { overdue: true } : {}),
          ...(due === 'week' ? { dueThisWeek: true } : {}),
          ...(before ? { before } : {}),
        },
        today(),
      ),
    );
    return c.json(
      {
        items: items.map((x) => ({ ...summaryOut(x), storeName: x.storeName })),
        next: items.length === limit ? (items.at(-1)?.createdAt.toISOString() ?? null) : null,
      },
      200,
    );
  });
  platform.openapi(R.invoice, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await detailOut(c.var.staff.client, c.var.staff.actor, id), 200);
  });
  platform.openapi(R.createInvoice, async (c) => {
    const { id } = c.req.valid('param');
    const invoiceId = await createManualInvoice(
      c.var.staff.client,
      c.var.staff.actor,
      id,
      c.req.valid('json'),
      { today: today(), requestId: c.var.requestId, afterCommit: relayTo(c) },
    );
    return c.json(await detailOut(c.var.staff.client, c.var.staff.actor, invoiceId), 201);
  });
  platform.openapi(R.issueInvoice, async (c) => {
    const { id } = c.req.valid('param');
    await issueInvoice(c.var.staff.client, c.var.staff.actor, id, today(), {
      requestId: c.var.requestId,
      afterCommit: relayTo(c),
    });
    return c.json(await detailOut(c.var.staff.client, c.var.staff.actor, id), 200);
  });
  platform.openapi(R.voidInvoice, async (c) => {
    const { id } = c.req.valid('param');
    await voidInvoice(c.var.staff.client, c.var.staff.actor, id, c.req.valid('json'), today(), {
      requestId: c.var.requestId,
      afterCommit: relayTo(c),
    });
    return c.json(await detailOut(c.var.staff.client, c.var.staff.actor, id), 200);
  });
  platform.openapi(R.recordPayment, async (c) => {
    const { id } = c.req.valid('param');
    await recordInvoicePayment(
      c.var.staff.client,
      c.var.staff.actor,
      id,
      c.req.valid('json'),
      today(),
      { requestId: c.var.requestId, afterCommit: relayTo(c) },
    );
    return c.json(await detailOut(c.var.staff.client, c.var.staff.actor, id), 200);
  });
  platform.openapi(R.issuer, async (c) => {
    if (!c.var.staff.actor.platformRole) throw new AppError('forbidden');
    return c.json(await withPlatform(c.var.staff.client, (tx) => getIssuer(tx)), 200);
  });
  platform.openapi(R.setIssuer, async (c) => {
    const saved = await withPlatform(
      c.var.staff.client,
      (tx) => setIssuer(tx, c.var.staff.actor, c.req.valid('json')),
      { requestId: c.var.requestId },
    );
    return c.json(saved, 200);
  });
}

async function detailOut(
  client: StaffEnv['Variables']['staff']['client'],
  actor: StaffEnv['Variables']['staff']['actor'],
  id: string,
) {
  const inv = await withPlatform(client, async (tx) => {
    const invoice = await getInvoice(tx, actor, id, dhakaDate(new Date()));
    const [store] = await tx.db
      .select({ name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, invoice.tenantId));
    return { ...invoice, storeName: store?.name ?? '' };
  });
  return {
    ...summaryOut(inv),
    storeName: inv.storeName,
    subtotal: inv.subtotal,
    vat: inv.vat,
    paidAt: inv.paidAt,
    voidedAt: inv.voidedAt,
    voidReason: inv.voidReason,
    issuer: inv.issuer as Record<string, unknown> | null,
    billedTo: inv.billedTo as Record<string, unknown> | null,
    lines: inv.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
      metric: l.metric ?? null,
    })),
    payments: inv.payments,
  };
}

function summaryOut(i: Omit<Invoice, 'lines' | 'payments'>) {
  return {
    id: i.id,
    number: i.number,
    tenantId: i.tenantId,
    storeName: '',
    status: i.status,
    overdue: i.overdue,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    issueAfter: i.issueAfter,
    issuedOn: i.issuedOn,
    dueOn: i.dueOn,
    total: i.total,
    amountPaid: i.amountPaid,
    amountDue: i.amountDue,
    createdAt: i.createdAt,
  };
}
