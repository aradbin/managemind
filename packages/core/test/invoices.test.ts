// Invoices, payments and dunning (phase-5b-plan §3.7, §3.8, Q9).
import { addDays, dhakaDate, PLACEHOLDER_PLANS } from '@managemind/shared/billing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createManualInvoice,
  createPlan,
  createTenant,
  currentPeriodStart,
  getInvoice,
  holdSubscription,
  issueInvoice,
  listInvoices,
  type Plan,
  recordInvoicePayment,
  runBilling,
  setIssuer,
  systemActor,
  transitionTenant,
  voidInvoice,
  withPlatform,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let owner: pg.Client;
let plan: Plan;
beforeAll(async () => {
  [app, owner] = await Promise.all([connectApp(), connectOwner()]);
  const starter = PLACEHOLDER_PLANS.find(
    (p) => p.code === 'starter',
  ) as (typeof PLACEHOLDER_PLANS)[0];
  plan = await withPlatform(app, (tx) =>
    createPlan(tx, systemActor, { ...starter, code: `inv-${Date.now().toString(36)}` }),
  );
  await withPlatform(app, (tx) =>
    setIssuer(tx, systemActor, {
      legalName: 'managemind Ltd',
      address: 'Dhaka',
      vatRateBp: null,
      bank: { name: 'Bank', accountName: 'managemind Ltd', accountNumber: '0001' },
      bkash: '01700000000',
    }),
  );
});
afterAll(() => Promise.all([app.end(), owner.end()]));

const today = dhakaDate(new Date());
const day = Number(today.slice(8, 10));
let seq = 0;

async function store(extra: { kind?: 'client' | 'demo' | 'test'; billingDay?: number } = {}) {
  const slug = `iv${Date.now().toString(36)}${seq++}`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: `Invoice ${slug}`,
    owner: { email: `${slug}@example.test`, name: 'Owner' },
    ...(extra.kind ? { kind: extra.kind } : {}),
    subscription: { planId: plan.id, billingDay: extra.billingDay ?? Math.min(day, 28) },
  });
  // Subscribed a while ago, so this period counts.
  await owner.query(
    `update platform.subscriptions set created_at = now() - interval '40 days' where tenant_id = $1`,
    [created.id],
  );
  return created;
}

const invoicesOf = (tenantId: string) =>
  withPlatform(app, (tx) => listInvoices(tx, systemActor, { tenantId }, today));

describe('drafting and issuing', () => {
  it('drafts the period with the plan and the setup fee once, and issues it after review', async () => {
    const s = await store();
    await runBilling(app, today);
    await runBilling(app, today);
    const [draft, ...more] = await invoicesOf(s.id);
    expect(more).toEqual([]);
    expect(draft).toMatchObject({ status: 'draft', number: null, total: 6_500_00 });
    const full = await withPlatform(app, (tx) =>
      getInvoice(tx, systemActor, draft?.id as string, today),
    );
    expect(full.lines.map((l) => l.kind)).toEqual(['setup', 'plan']);
    expect(full.periodStart).toBe(currentPeriodStart(Math.min(day, 28), today));

    // Two days later the draft issues itself, with a number that never changes.
    const later = new Date(Date.now() + 3 * 86_400_000);
    await runBilling(app, today, later);
    const [issued] = await invoicesOf(s.id);
    expect(issued?.status).toBe('issued');
    expect(issued?.number).toMatch(new RegExp(`^INV-${today.slice(0, 4)}-\\d{4,}$`));
    expect(issued?.dueOn).toBe(addDays(today, 7));
    expect(issued?.issuer).toMatchObject({ legalName: 'managemind Ltd' });
    expect(issued?.billedTo).toMatchObject({ slug: expect.any(String) });
  });

  it('bills last month’s orders beyond the plan', async () => {
    const s = await store();
    const start = currentPeriodStart(Math.min(day, 28), today);
    const prevStart = addDays(start, -10);
    await owner.query(
      `insert into platform.usage_daily (tenant_id, day, metric, value) values ($1, $2, 'orders', 520)`,
      [s.id, prevStart],
    );
    await runBilling(app, today);
    const [draft] = await invoicesOf(s.id);
    const full = await withPlatform(app, (tx) =>
      getInvoice(tx, systemActor, draft?.id as string, today),
    );
    expect(full.lines.find((l) => l.kind === 'overage')).toMatchObject({
      quantity: 20,
      unitPrice: 5_00,
      amount: 100_00,
    });
  });

  it('never bills demo or test stores', async () => {
    const s = await store({ kind: 'test' });
    await runBilling(app, today);
    expect(await invoicesOf(s.id)).toEqual([]);
  });

  it('writes a manual invoice and voids a draft, but not one with payments', async () => {
    const s = await store();
    const id = await createManualInvoice(
      app,
      systemActor,
      s.id,
      {
        lines: [
          {
            kind: 'adjustment',
            description: { bn: 'অতিরিক্ত কাজ', en: 'Extra work' },
            unitPrice: 2_000_00,
          },
          { kind: 'adjustment', description: { bn: 'ছাড়', en: 'Discount' }, unitPrice: -500_00 },
        ],
        issueNow: true,
      },
      { today },
    );
    const inv = await withPlatform(app, (tx) => getInvoice(tx, systemActor, id, today));
    expect(inv).toMatchObject({ status: 'issued', total: 1_500_00 });
    await recordInvoicePayment(
      app,
      systemActor,
      id,
      { amount: 500_00, method: 'bkash', paidOn: today },
      today,
    );
    await expect(
      voidInvoice(app, systemActor, id, { reason: 'mistake' }, today),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});

describe('payments', () => {
  it('marks paid once covered, and refuses more than is due', async () => {
    const s = await store();
    const id = await createManualInvoice(
      app,
      systemActor,
      s.id,
      {
        lines: [{ kind: 'plan', description: { bn: 'মাস', en: 'Month' }, unitPrice: 1_000_00 }],
        issueNow: true,
      },
      { today },
    );
    await expect(
      recordInvoicePayment(
        app,
        systemActor,
        id,
        { amount: 1_000_01, method: 'bank', paidOn: today },
        today,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const half = await recordInvoicePayment(
      app,
      systemActor,
      id,
      { amount: 400_00, method: 'bank', paidOn: today },
      today,
    );
    expect(half).toMatchObject({ status: 'issued', amountDue: 600_00 });
    const paid = await recordInvoicePayment(
      app,
      systemActor,
      id,
      { amount: 600_00, method: 'nagad', reference: 'TX1', paidOn: today },
      today,
    );
    expect(paid).toMatchObject({ status: 'paid', amountDue: 0 });
    expect(paid.payments.map((p) => p.method)).toEqual(['bank', 'nagad']);
  });
});

describe('reminders and suspension (Q9)', () => {
  async function issuedInvoice() {
    const s = await store();
    const id = await createManualInvoice(
      app,
      systemActor,
      s.id,
      {
        lines: [{ kind: 'plan', description: { bn: 'মাস', en: 'Month' }, unitPrice: 1_000_00 }],
        issueNow: true,
      },
      { today },
    );
    const inv = await withPlatform(app, (tx) => getInvoice(tx, systemActor, id, today));
    return { s, id, due: inv.dueOn as string };
  }
  const steps = async (invoiceId: string) =>
    (
      await owner.query<{ step: string }>(
        'select step from platform.reminders where invoice_id = $1 order by sent_at, step',
        [invoiceId],
      )
    ).rows.map((r) => r.step);
  const tenant = async (id: string) =>
    (
      await owner.query<{ status: string; status_reason: string | null }>(
        'select status, status_reason from platform.tenants where id = $1',
        [id],
      )
    ).rows[0];

  it('reminds at −3, 0, +3 and +10 once each, and suspends at +14; paying reactivates', async () => {
    const { s, id, due } = await issuedInvoice();
    await runBilling(app, addDays(due, -3));
    await runBilling(app, addDays(due, -3));
    expect(await steps(id)).toEqual(['due_soon']);
    await runBilling(app, addDays(due, 3));
    expect(await steps(id)).toEqual(expect.arrayContaining(['due_soon', 'due_today', 'past_due']));
    const { rows } = await owner.query(
      'select status from platform.subscriptions where tenant_id = $1',
      [s.id],
    );
    expect(rows[0]?.status).toBe('past_due');
    await runBilling(app, addDays(due, 13));
    expect(await tenant(s.id)).toEqual({ status: 'active', status_reason: null });
    const run = await runBilling(app, addDays(due, 14));
    expect(run.suspended).toContain(s.id);
    expect(await tenant(s.id)).toEqual({ status: 'suspended', status_reason: 'overdue' });

    await recordInvoicePayment(
      app,
      systemActor,
      id,
      { amount: 1_000_00, method: 'cash', paidOn: today },
      addDays(due, 15),
    );
    expect(await tenant(s.id)).toEqual({ status: 'active', status_reason: null });
  });

  it('keeps any other suspension when the invoice is paid', async () => {
    const { s, id } = await issuedInvoice();
    await transitionTenant(app, systemActor, s.id, 'suspend', {
      reason: 'abuse report',
      category: 'abuse',
    });
    await recordInvoicePayment(
      app,
      systemActor,
      id,
      { amount: 1_000_00, method: 'cash', paidOn: today },
      today,
    );
    expect(await tenant(s.id)).toEqual({ status: 'suspended', status_reason: 'abuse' });
  });

  it('takes no step while held, and catches up after', async () => {
    const { s, id, due } = await issuedInvoice();
    await holdSubscription(app, systemActor, s.id, {
      until: addDays(due, 20),
      reason: 'paying next week, agreed by phone',
    });
    await runBilling(app, addDays(due, 15));
    expect(await steps(id)).toEqual([]);
    await runBilling(app, addDays(due, 21));
    expect(await steps(id)).toHaveLength(5);
  });

  it('skips issuing until a super admin issues, and voids', async () => {
    const s = await store();
    await runBilling(app, today);
    const [draft] = await invoicesOf(s.id);
    const voided = await voidInvoice(
      app,
      systemActor,
      draft?.id as string,
      { reason: 'agreed free month' },
      today,
    );
    expect(voided.status).toBe('void');
    // The voided period isn't drafted again: anything owed is billed by hand.
    await runBilling(app, today);
    const again = await invoicesOf(s.id);
    expect(again.map((x) => x.status)).toEqual(['void']);
    const manual = await createManualInvoice(
      app,
      systemActor,
      s.id,
      {
        lines: [
          { kind: 'plan', description: { bn: 'প্ল্যান', en: 'Plan, half month' }, unitPrice: 2500_00 },
        ],
      },
      { today },
    );
    const issued = await issueInvoice(app, systemActor, manual, today);
    expect(issued.status).toBe('issued');
  });
});
