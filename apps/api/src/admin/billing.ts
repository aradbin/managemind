// Settings → Plan and billing for owners and managers (phase-5b-plan §3.7,
// billing.read): the plan, this period's use against it, our invoices to
// view and print, how to pay, and the SSLCommerz link once our merchant
// account exists. Paying works before the terms are accepted.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  authorize,
  currentPeriodStart,
  getIssuer,
  getStoreInvoice,
  getSubscription,
  listStoreInvoices,
  storeEntitlements,
  usageBetween,
} from '@managemind/core';
import { AppError } from '@managemind/shared';
import {
  addDays,
  billingPeriod,
  dhakaDate,
  type LimitName,
  usageLevel,
} from '@managemind/shared/billing';
import { adminOrigin } from '../auth/routes';
import { platformGateway, startInvoicePayment } from '../billing';
import { inStore, type StaffEnv } from './context';

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const Id = z.object({ id: z.uuid() });
const Localized = z.object({ bn: z.string(), en: z.string() });

const InvoiceSummary = z
  .object({
    id: z.uuid(),
    number: z.string().nullable(),
    status: z.enum(['draft', 'issued', 'paid', 'void']),
    overdue: z.boolean(),
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable(),
    issuedOn: z.string().nullable(),
    dueOn: z.string().nullable(),
    total: z.number().int(),
    amountPaid: z.number().int(),
    amountDue: z.number().int(),
  })
  .openapi('StoreInvoiceSummary');
const InvoiceDetail = InvoiceSummary.extend({
  subtotal: z.number().int(),
  vat: z.number().int(),
  paidAt: z.date().nullable(),
  voidReason: z.string().nullable(),
  issuer: z.record(z.string(), z.unknown()).nullable(),
  billedTo: z.record(z.string(), z.unknown()).nullable(),
  lines: z.array(
    z.object({
      kind: z.enum(['setup', 'plan', 'overage', 'adjustment', 'vat']),
      description: Localized,
      quantity: z.number().int(),
      unitPrice: z.number().int(),
      amount: z.number().int(),
    }),
  ),
  payments: z.array(
    z.object({
      amount: z.number().int(),
      method: z.enum(['bank', 'bkash', 'nagad', 'cash', 'sslcommerz']),
      reference: z.string().nullable(),
      paidOn: z.string(),
    }),
  ),
}).openapi('StoreInvoice');

const METERS: {
  name: LimitName;
  metric: 'orders' | 'emails' | 'products' | 'staff' | 'storage_bytes' | 'custom_domains';
}[] = [
  { name: 'ordersPerMonth', metric: 'orders' },
  { name: 'emailsPerMonth', metric: 'emails' },
  { name: 'products', metric: 'products' },
  { name: 'staff', metric: 'staff' },
  { name: 'storageMb', metric: 'storage_bytes' },
  { name: 'customDomains', metric: 'custom_domains' },
];

export const BILLING_ROUTES = {
  billing: r({
    method: 'get',
    path: '/billing',
    summary:
      "The store's plan, this period's use against it, invoices and how to pay (billing.read)",
    responses: json(
      z.object({
        plan: z
          .object({
            code: z.string(),
            name: Localized,
            monthlyPrice: z.number().int(),
            status: z.enum(['trialing', 'active', 'past_due', 'cancelled']),
            trialEndsOn: z.string().nullable(),
            billingDay: z.number().int(),
          })
          .nullable(),
        period: z.object({ start: z.string(), end: z.string() }),
        /** Each limit's use; level warns at 80% and 100% (§7). */
        meters: z.array(
          z.object({
            name: z.enum([
              'products',
              'staff',
              'ordersPerMonth',
              'emailsPerMonth',
              'storageMb',
              'customDomains',
            ]),
            used: z.number(),
            limit: z.number().nullable(),
            level: z.enum(['ok', 'warn', 'over']),
          }),
        ),
        invoices: z.array(InvoiceSummary),
        payTo: z
          .object({
            legalName: z.string(),
            bank: z.record(z.string(), z.string()).nullable(),
            bkash: z.string().nullable(),
            nagad: z.string().nullable(),
          })
          .nullable(),
        /** The SSLCommerz link is on (our merchant account exists). */
        payOnline: z.boolean(),
      }),
      'Billing',
    ),
  }),
  invoice: r({
    method: 'get',
    path: '/billing/invoices/{id}',
    summary: 'One of our invoices to the store, to view and print (billing.read)',
    request: { params: Id },
    responses: json(InvoiceDetail, 'Invoice'),
  }),
  payInvoice: r({
    method: 'post',
    path: '/billing/invoices/{id}/pay',
    summary: 'An SSLCommerz page to pay what is due on the invoice (billing.read)',
    request: { params: Id },
    responses: json(z.object({ url: z.string() }), 'Payment page'),
  }),
} as const;

export function registerBilling(admin: OpenAPIHono<StaffEnv>): void {
  const R = BILLING_ROUTES;
  admin.openapi(R.billing, async (c) => {
    const today = dhakaDate(new Date());
    const out = await inStore(c, async (tx) => {
      authorize(c.var.staff.actor, 'billing.read');
      const sub = await getSubscription(tx, tx.tenantId);
      const period = sub
        ? billingPeriod(currentPeriodStart(sub.billingDay, today))
        : { start: `${today.slice(0, 8)}01`, end: today };
      // Flows through yesterday (the last rollup); levels as of that day.
      const used = await usageBetween(tx, tx.tenantId, period.start, addDays(today, -1));
      const e = await storeEntitlements(tx);
      const meters = METERS.map(({ name, metric }) => {
        const value = metric === 'storage_bytes' ? used[metric] / 2 ** 20 : used[metric];
        const limit = e.limits[name];
        return { name, used: Math.round(value * 10) / 10, limit, level: usageLevel(value, limit) };
      });
      const issuer = await getIssuer(tx);
      return {
        plan: sub
          ? {
              code: sub.plan.code,
              name: sub.plan.name,
              monthlyPrice: sub.priceOverride ?? sub.plan.monthlyPrice,
              status: sub.status,
              trialEndsOn: sub.trialEndsOn,
              billingDay: sub.billingDay,
            }
          : null,
        period,
        meters,
        invoices: (await listStoreInvoices(tx, today)).map(summaryOut),
        payTo: issuer
          ? {
              legalName: issuer.legalName,
              bank: (issuer.bank as Record<string, string> | undefined) ?? null,
              bkash: issuer.bkash ?? null,
              nagad: issuer.nagad ?? null,
            }
          : null,
        payOnline: platformGateway(c.env) !== null,
      };
    });
    return c.json(out, 200);
  });
  admin.openapi(R.invoice, async (c) => {
    const { id } = c.req.valid('param');
    const today = dhakaDate(new Date());
    const inv = await inStore(c, (tx) => {
      authorize(c.var.staff.actor, 'billing.read');
      return getStoreInvoice(tx, id, today);
    });
    return c.json(
      {
        ...summaryOut(inv),
        subtotal: inv.subtotal,
        vat: inv.vat,
        paidAt: inv.paidAt,
        voidReason: inv.voidReason,
        issuer: inv.issuer as Record<string, unknown> | null,
        billedTo: inv.billedTo as Record<string, unknown> | null,
        lines: inv.lines.map((l) => ({
          kind: l.kind,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          amount: l.amount,
        })),
        payments: inv.payments.map((p) => ({
          amount: p.amount,
          method: p.method,
          reference: p.reference,
          paidOn: p.paidOn,
        })),
      },
      200,
    );
  });
  admin.openapi(R.payInvoice, async (c) => {
    const { id } = c.req.valid('param');
    const { actor, client } = c.var.staff;
    authorize(actor, 'billing.read');
    if (!actor.tenantId) throw new AppError('forbidden', { detail: 'no active store' });
    const admin = adminOrigin(c as unknown as Parameters<typeof adminOrigin>[0]);
    const api = `https://api.${c.var.config.PLATFORM_DOMAIN}`;
    return c.json(
      await startInvoicePayment(c.env, client, actor.tenantId, id, { api, admin }),
      200,
    );
  });
}

function summaryOut(i: {
  id: string;
  number: string | null;
  status: 'draft' | 'issued' | 'paid' | 'void';
  overdue: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  total: number;
  amountPaid: number;
  amountDue: number;
}) {
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    overdue: i.overdue,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    issuedOn: i.issuedOn,
    dueOn: i.dueOn,
    total: i.total,
    amountPaid: i.amountPaid,
    amountDue: i.amountDue,
  };
}
