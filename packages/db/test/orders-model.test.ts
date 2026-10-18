// The Phase 4 tables' database-level guarantees (phase-4-plan §4): what the
// tables refuse on their own, whatever code writes to them.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appUrl, connect, TENANT_A } from './helpers';

let app: pg.Client;
beforeAll(async () => {
  app = await connect(appUrl);
});
afterAll(async () => {
  await app.end();
});

/** Runs `fn` as the app in store A and always rolls back. */
async function inA<T>(fn: () => Promise<T>): Promise<T> {
  await app.query('begin');
  try {
    await app.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.tenant_at', now()::text, true)",
      [TENANT_A],
    );
    return await fn();
  } finally {
    await app.query('rollback');
  }
}

/** Expects `sql` to fail with `error`, inside a savepoint so the transaction goes on. */
async function refuses(sql: string, error: RegExp, params: unknown[] = []): Promise<void> {
  await app.query('savepoint refuse');
  await expect(app.query(sql, params)).rejects.toThrow(error);
  await app.query('rollback to savepoint refuse');
}

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  (await app.query(sql, params)).rows[0] as T;

const newOrder = (number: number, extra = '') =>
  one<{ id: string }>(
    `insert into store.orders (number, source, customer_id, phone, contact, subtotal, total, locale ${extra ? `, ${extra.split('=')[0]}` : ''})
     select ${number}, 'website', id, phone, '{}', 0, 0, 'en' ${extra ? `, ${extra.split('=')[1]}` : ''}
       from store.customers order by id limit 1 returning id`,
  );

describe('payments', () => {
  it('never change once settled', async () => {
    await inA(async () => {
      const order = await newOrder(90001);
      const p = await one<{ id: string }>(
        `insert into store.payments (order_id, provider, method, amount) values ($1, 'cod', 'cod', 1000) returning id`,
        [order.id],
      );
      await app.query(`update store.payments set amount = 800 where id = $1`, [p.id]);
      await app.query(
        `update store.payments set status = 'paid', settled_at = now() where id = $1`,
        [p.id],
      );
      await expect(
        app.query(`update store.payments set amount = 1 where id = $1`, [p.id]),
      ).rejects.toThrow(/a payment that is paid cannot change/);
    });
  });

  it('settle an expired online payment late, and nothing else (phase-5a-plan §3.5)', async () => {
    await inA(async () => {
      const order = await newOrder(90010);
      const p = await one<{ id: string }>(
        `insert into store.payments (order_id, provider, method, amount, status)
         values ($1, 'sslcommerz', 'online', 1000, 'expired') returning id`,
        [order.id],
      );
      await refuses(
        `update store.payments set status = 'voided' where id = $1`,
        /a payment that is expired cannot change/,
        [p.id],
      );
      await app.query(
        `update store.payments set status = 'paid', settled_at = now(), gateway_val_id = 'v1' where id = $1`,
        [p.id],
      );
      // The same validation can't settle a second payment.
      await refuses(
        `insert into store.payments (order_id, provider, method, amount, status, gateway_val_id)
         values ($1, 'sslcommerz', 'online', 1000, 'paid', 'v1')`,
        /payments_gateway_val_id_unique/,
        [order.id],
      );
    });
  });

  it('keep online payments on the online method', async () => {
    await inA(async () => {
      const order = await newOrder(90011);
      await refuses(
        `insert into store.payments (order_id, provider, method, amount) values ($1, 'sslcommerz', 'bkash', 1)`,
        /payments_online_method/,
        [order.id],
      );
    });
  });

  it('keep COD payments on the COD method', async () => {
    await inA(async () => {
      const order = await newOrder(90002);
      await expect(
        app.query(
          `insert into store.payments (order_id, provider, method, amount) values ($1, 'cod', 'bkash', 1)`,
          [order.id],
        ),
      ).rejects.toThrow(/payments_cod_method/);
    });
  });
});

describe('orders', () => {
  it('keep their numbers unique per store', async () => {
    await inA(async () => {
      await newOrder(90003);
      await expect(newOrder(90003)).rejects.toThrow(/orders_number_unique/);
    });
  });

  it('keep tenant_id when a referenced shopper or zone is deleted', async () => {
    await inA(async () => {
      const zone = await one<{ id: string }>(
        `insert into store.delivery_zones (name, fee) values ('{"en":"Z"}', 0) returning id`,
      );
      const shopper = await one<{ id: string }>(
        `insert into store.shopper_users (name, email) values ('S', 's-${Date.now()}@example.test') returning id`,
      );
      const order = await newOrder(90004);
      await app.query(`update store.orders set zone_id = $2, shopper_user_id = $3 where id = $1`, [
        order.id,
        zone.id,
        shopper.id,
      ]);
      await app.query(`delete from store.delivery_zones where id = $1`, [zone.id]);
      await app.query(`delete from store.shopper_users where id = $1`, [shopper.id]);
      expect(
        await one(`select tenant_id, zone_id, shopper_user_id from store.orders where id = $1`, [
          order.id,
        ]),
      ).toEqual({ tenant_id: TENANT_A, zone_id: null, shopper_user_id: null });
    });
  });

  it('keep the history append-only', async () => {
    await inA(async () => {
      await refuses(`update store.order_history set reason = 'x'`, /permission denied/);
      await refuses(`delete from store.order_history`, /permission denied/);
    });
  });
});

describe('delivery zones', () => {
  it('cover a district or an area, each once per store, with one fallback', async () => {
    await inA(async () => {
      const zone = await one<{ id: string }>(
        `insert into store.delivery_zones (name, fee) values ('{"en":"Z"}', 0) returning id`,
      );
      await refuses(
        `insert into store.delivery_zone_areas (zone_id, district_id, area_id) values ($1, 47, 1)`,
        /delivery_zone_areas_one_place/,
        [zone.id],
      );
      // The fixture zone covers district 1.
      await refuses(
        `insert into store.delivery_zone_areas (zone_id, district_id) values ($1, 1)`,
        /delivery_zone_areas_district_unique/,
        [zone.id],
      );
      // Every store starts with its fallback zone, "Outside Dhaka" (migration 0023).
      await refuses(
        `insert into store.delivery_zones (name, fee, is_fallback) values ('{"en":"B"}', 0, true)`,
        /delivery_zones_one_fallback/,
      );
    });
  });

  it('refuse an address whose area is in another district', async () => {
    await inA(async () => {
      await expect(
        app.query(
          `insert into store.customer_addresses (customer_id, name, phone, division_id, district_id, area_id, line)
           select id, 'X', phone, 6, 41, (select id from ref.areas where code = 'dhaka.dhanmondi'), 'L'
             from store.customers limit 1`,
        ),
      ).rejects.toThrow(/customer_addresses_area_fk/);
    });
  });
});

describe('sale prices', () => {
  it('must be below the price, inside a window that ends after it starts', async () => {
    await inA(async () => {
      const v = await one<{ id: string }>(`select id from store.variants order by id limit 1`);
      const set = (price: number, starts: string, ends: string) =>
        app.query(
          `update store.variants set sale_price = $2, sale_starts_at = $3, sale_ends_at = $4 where id = $1`,
          [v.id, price, starts, ends],
        );
      await app.query('savepoint s');
      await expect(set(100_000, '2026-10-01', '2026-10-02')).rejects.toThrow(/variants_sale_valid/);
      await app.query('rollback to savepoint s');
      await expect(set(50_000, '2026-10-02', '2026-10-01')).rejects.toThrow(/variants_sale_valid/);
      await app.query('rollback to savepoint s');
      await set(50_000, '2026-10-01', '2026-10-02');
    });
  });
});

describe('customers', () => {
  it('are one per phone, and a deleted customer frees the phone', async () => {
    await inA(async () => {
      await expect(
        app.query(`insert into store.customers (phone, name) values ('+8801700000001', 'Dup')`),
      ).rejects.toThrow(/customers_phone_unique/);
    });
    await inA(async () => {
      await app.query(
        `update store.customers set deleted_at = now() where phone = '+8801700000001'`,
      );
      await app.query(`insert into store.customers (phone, name) values ('+8801700000001', 'New')`);
      await expect(
        app.query(`insert into store.customers (phone, name) values ('01700000001', 'Bad')`),
      ).rejects.toThrow(/customers_phone_format/);
    });
  });
});

describe('store defaults', () => {
  it('give every store the three default delivery zones', async () => {
    const zones = await inA(() =>
      app.query(
        `select z.name->>'en' as name, z.fee::int, z.is_fallback as fallback,
                (select count(*)::int from store.delivery_zone_areas a where a.zone_id = z.id) as areas
           from store.delivery_zones z where z.name->>'en' <> 'Fixture' order by z.position`,
      ),
    );
    expect(zones.rows).toEqual([
      { name: 'Inside Dhaka', fee: 7000, fallback: false, areas: 50 },
      { name: 'Dhaka suburbs', fee: 10000, fallback: false, areas: 4 },
      { name: 'Outside Dhaka', fee: 13000, fallback: true, areas: 0 },
    ]);
  });
});
