// A shopper's deletion request (phase-5b-plan §3.13, §10): exactly the
// listed fields change, order totals and the stock ledger stay, another
// customer is untouched, and only owners and managers may do it.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  ANONYMIZED_NAME,
  addToCart,
  anonymizeCustomer,
  blockPhone,
  createProduct,
  createTenant,
  issueStoreCredit,
  placeOrder,
  receive,
  setCartArea,
  shopperActor,
  systemActor,
  type TenantTx,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let owner: pg.Client;
let store: string;
const as = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000cd',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
const one = async (q: string, params: unknown[] = []) => (await owner.query(q, params)).rows[0];

beforeAll(async () => {
  [app, owner] = await Promise.all([connectApp(), connectOwner()]);
  const slug = `anon${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Anon Store',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
});
afterAll(() => Promise.all([app.end(), owner.end()]));

async function order(phone: string, name: string, email?: string) {
  const p = await run((tx) =>
    createProduct(tx, as('owner'), {
      status: 'active',
      translations: { en: { title: `Thing ${Date.now()}${Math.random()}` } },
      variant: { price: 60_000 },
    }),
  );
  const variantId = p.variants[0]?.id as string;
  await run((tx) => receive(tx, as('owner'), { variantId, quantity: 5, reason: 'received' }));
  const { token } = await run((tx) => addToCart(tx, null, { variantId, quantity: 1 }, 'en'));
  const cart = await run((tx) => setCartArea(tx, token ?? null, { areaId: 513 }));
  return run((tx) =>
    placeOrder(tx, shopperActor(), {
      channel: 'storefront',
      source: 'website',
      cartToken: token ?? null,
      contact: { name, phone, ...(email ? { email } : {}) },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1, Road 2' },
      payment: { kind: 'cod' },
      expectedTotal: cart.quote.totals.total,
      locale: 'en',
    }),
  );
}

describe('anonymizing a customer', () => {
  it('removes who and where, and keeps the sales', async () => {
    const phone = '+8801712345678';
    const placed = await order(phone, 'Rina Akter', 'rina@example.test');
    const other = await order('+8801812345678', 'Someone Else');
    const { rows } = await owner.query<{ customer_id: string; total: string; address: unknown }>(
      'select customer_id, total, address from store.orders where id = $1',
      [placed.id],
    );
    const customerId = rows[0]?.customer_id as string;
    const totalBefore = rows[0]?.total;
    // Their shopper account, a delivery log row, store credit and a block.
    await owner.query(
      `insert into store.shopper_users (tenant_id, name, email, phone_number, phone_number_verified)
       values ($1, 'Rina', 'rina@example.test', $2, true)`,
      [store, phone],
    );
    await owner.query(
      `insert into store.messages (tenant_id, idempotency_key, event, channel, recipient_type, recipient, order_id, locale)
       values ($1, 'k-' || gen_random_uuid(), 'order_placed', 'sms', 'shopper', $2, $3, 'en')`,
      [store, phone, placed.id],
    );
    const credit = await run((tx) => issueStoreCredit(tx, placed.id, 10_000));
    await run((tx) => blockPhone(tx, as('owner'), { phone, reason: 'fake orders' }));
    const ledger = await one(
      'select count(*)::int as n, sum(quantity)::int as q from store.stock_movements where tenant_id = $1',
      [store],
    );

    await expect(run((tx) => anonymizeCustomer(tx, as('staff'), customerId))).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    );
    const result = await run((tx) => anonymizeCustomer(tx, as('manager'), customerId));
    expect(result.orders).toBe(1);

    expect(
      await one(
        'select name, phone, email, deleted_at is not null as gone from store.customers where id = $1',
        [customerId],
      ),
    ).toEqual({
      name: ANONYMIZED_NAME,
      phone: '+8801000000000',
      email: null,
      gone: true,
    });
    const anonymized = await one(
      'select phone, contact, address, total from store.orders where id = $1',
      [placed.id],
    );
    expect(anonymized?.phone).toBe('+8801000000000');
    expect(anonymized?.contact).toEqual({ name: ANONYMIZED_NAME, phone: '+8801000000000' });
    expect(anonymized?.address).toMatchObject({ districtId: 47, areaId: 513, line: '—' });
    expect(anonymized?.total).toBe(totalBefore);
    expect(
      await one('select count(*)::int as n from store.customer_addresses where customer_id = $1', [
        customerId,
      ]),
    ).toEqual({ n: 0 });
    expect(
      await one(
        'select count(*)::int as n from store.shopper_users where tenant_id = $1 and phone_number = $2',
        [store, phone],
      ),
    ).toEqual({ n: 0 });
    expect(
      await one('select count(*)::int as n from store.messages where order_id = $1', [placed.id]),
    ).toEqual({ n: 0 });
    const promo = await one(
      `select p.status, p.conditions from store.promotions p join store.promotion_codes c on c.promotion_id = p.id where c.id = $1`,
      [credit.id],
    );
    expect(promo).toEqual({ status: 'ended', conditions: { customerPhones: [] } });
    // Kept: the block, the stock ledger, and the other customer's order.
    expect(
      await one(
        'select count(*)::int as n from store.blocked_phones where tenant_id = $1 and phone = $2',
        [store, phone],
      ),
    ).toEqual({ n: 1 });
    expect(
      await one(
        'select count(*)::int as n, sum(quantity)::int as q from store.stock_movements where tenant_id = $1',
        [store],
      ),
    ).toEqual(ledger);
    expect(
      (await one('select contact from store.orders where id = $1', [other.id]))?.contact,
    ).toMatchObject({ name: 'Someone Else' });
    // The audit entry holds no old values.
    const audit = await one(
      `select before, after from store.audit_log where tenant_id = $1 and action = 'customer.anonymized'`,
      [store],
    );
    expect(audit).toEqual({ before: null, after: { orders: 1 } });
  });
});
