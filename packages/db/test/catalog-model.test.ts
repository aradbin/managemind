// The catalog's database-level guarantees (phase-2-plan §3–§4): what the
// tables refuse on their own, whatever code writes to them.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appUrl, connect, inTenant, ownerUrl, TENANT_A, TENANT_B } from './helpers';

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  app = await connect(appUrl);
  owner = await connect(ownerUrl);
});
afterAll(async () => {
  await app.end();
  await owner.end();
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

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  (await app.query(sql, params)).rows[0] as T;

const newProduct = () =>
  one<{ id: string }>(`insert into store.products (status) values ('draft') returning id`);

describe('store defaults', () => {
  it('gives every store the built-in brand attribute, named in both languages', async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      const { rows } = await inTenant(app, tenant, () =>
        app.query(
          `select a.type, a.filterable, a.visible, a.is_system,
                  array_agg(t.name order by t.locale) as names
             from store.attributes a join store.attribute_translations t on t.attribute_id = a.id
            where a.key = 'brand' group by a.id`,
        ),
      );
      expect(rows).toEqual([
        {
          type: 'choice',
          filterable: true,
          visible: true,
          is_system: true,
          names: ['ব্র্যান্ড', 'Brand'],
        },
      ]);
    }
  });

  it('gives every store one default stock location, named in its language', async () => {
    const names = [];
    for (const tenant of [TENANT_A, TENANT_B]) {
      const { rows } = await inTenant(app, tenant, () =>
        app.query(`select name from store.stock_locations where is_default`),
      );
      names.push(rows.map((r) => r.name));
    }
    // Store A is in English, store B in Bangla (seed.ts).
    expect(names).toEqual([['Main stock'], ['প্রধান স্টক']]);
  });

  it('is idempotent', async () => {
    await inA(async () => {
      await app.query('select app.create_store_defaults()');
      const { n } = await one<{ n: string }>(
        `select (select count(*) from store.attributes where key = 'brand')
              + (select count(*) from store.stock_locations where is_default) as n`,
      );
      expect(Number(n)).toBe(2);
      await expect(
        app.query(`insert into store.stock_locations (name, is_default) values ('Second', true)`),
      ).rejects.toThrow(/stock_locations_one_default/);
    });
  });
});

describe('references stay inside their store', () => {
  it("refuses a row that points at another store's product, even for a role that bypasses RLS", async () => {
    const productA = await inTenant(owner, TENANT_A, async () => {
      const { rows } = await owner.query(`insert into store.products default values returning id`);
      return rows[0].id as string;
    });
    await expect(
      inTenant(owner, TENANT_B, () =>
        owner.query(
          `insert into store.variants (product_id, options_key, price) values ($1, '', 100)`,
          [productA],
        ),
      ),
    ).rejects.toThrow(/variants_product_fk/);
    await inTenant(owner, TENANT_A, () =>
      owner.query('delete from store.products where id = $1', [productA]),
    );
  });
});

describe('variants', () => {
  it('keeps SKUs unique per store, ignoring case, until a variant is archived', async () => {
    await inA(async () => {
      const { id } = await newProduct();
      const insert = (sku: string, key: string) =>
        app.query(
          `insert into store.variants (product_id, options_key, sku, price) values ($1, $2, $3, 100) returning id`,
          [id, key, sku],
        );
      const first = await insert('TS-001', 'a');
      await app.query('savepoint s');
      await expect(insert('ts-001', 'b')).rejects.toThrow(/variants_sku_unique/);
      await app.query('rollback to savepoint s');
      await app.query(`update store.variants set archived_at = now() where id = $1`, [
        first.rows[0].id,
      ]);
      await expect(insert('ts-001', 'b')).resolves.toBeTruthy();
    });
  });

  it('refuses negative prices and a repeated live combination', async () => {
    await inA(async () => {
      const { id } = await newProduct();
      await app.query('savepoint s');
      await expect(
        app.query(
          `insert into store.variants (product_id, options_key, price) values ($1, '', -1)`,
          [id],
        ),
      ).rejects.toThrow(/variants_amounts_non_negative/);
      await app.query('rollback to savepoint s');
      await app.query(
        `insert into store.variants (product_id, options_key, price) values ($1, 'x', 1)`,
        [id],
      );
      await expect(
        app.query(
          `insert into store.variants (product_id, options_key, price) values ($1, 'x', 1)`,
          [id],
        ),
      ).rejects.toThrow(/variants_combination_unique/);
    });
  });
});

describe('categories', () => {
  it('allows three levels, and refuses a fourth or a category as its own parent', async () => {
    await inA(async () => {
      const root = await one<{ id: string }>(
        `insert into store.categories default values returning id`,
      );
      const child = await one<{ id: string }>(
        `insert into store.categories (parent_id, depth) values ($1, 1) returning id`,
        [root.id],
      );
      const leaf = await one<{ id: string }>(
        `insert into store.categories (parent_id, depth) values ($1, 2) returning id`,
        [child.id],
      );
      await app.query('savepoint s');
      await expect(
        app.query(`insert into store.categories (parent_id, depth) values ($1, 3)`, [leaf.id]),
      ).rejects.toThrow(/categories_depth_range/);
      await app.query('rollback to savepoint s');
      await expect(
        app.query(`update store.categories set parent_id = id, depth = 1 where id = $1`, [
          child.id,
        ]),
      ).rejects.toThrow(/categories_not_own_parent/);
    });
  });

  it('refuses to delete a category with children or products', async () => {
    await inA(async () => {
      const root = await one<{ id: string }>(
        `insert into store.categories default values returning id`,
      );
      await app.query(`insert into store.categories (parent_id, depth) values ($1, 1)`, [root.id]);
      await expect(
        app.query('delete from store.categories where id = $1', [root.id]),
      ).rejects.toThrow(/categories_parent_fk/);
    });
  });
});

describe('attributes', () => {
  const brandId = async () =>
    (await one<{ id: string }>(`select id from store.attributes where key = 'brand'`)).id;

  it('never deletes, retypes or rekeys the brand; renaming it is fine', async () => {
    await inA(async () => {
      const id = await brandId();
      for (const [sql, constraint] of [
        [`delete from store.attributes where id = $1`, 'attributes_system_kept'],
        [`update store.attributes set type = 'text' where id = $1`, 'attributes_immutable'],
        [`update store.attributes set key = 'maker' where id = $1`, 'attributes_immutable'],
      ] as const) {
        await app.query('savepoint s');
        await expect(app.query(sql, [id])).rejects.toMatchObject({ constraint });
        await app.query('rollback to savepoint s');
      }
      await app.query(
        `update store.attribute_translations set name = 'Maker' where attribute_id = $1 and locale = 'en'`,
        [id],
      );
      await app.query(`update store.attributes set visible = false where id = $1`, [id]);
    });
  });

  it('refuses text filters', async () => {
    await inA(async () => {
      await expect(
        app.query(
          `insert into store.attributes (key, type, filterable) values ('notes', 'text', true)`,
        ),
      ).rejects.toThrow(/attributes_text_not_filterable/);
    });
  });

  it('keeps product values the right type and inside their attribute', async () => {
    await inA(async () => {
      const product = await newProduct();
      const fabric = await one<{ id: string }>(
        `insert into store.attributes (key, type) values ('fabric', 'choice') returning id`,
      );
      const ram = await one<{ id: string }>(
        `insert into store.attributes (key, type) values ('ram', 'number') returning id`,
      );
      const cotton = await one<{ id: string }>(
        `insert into store.attribute_values (attribute_id) values ($1) returning id`,
        [fabric.id],
      );
      const brandValue = await one<{ id: string }>(
        `insert into store.attribute_values (attribute_id) values ($1) returning id`,
        [await brandId()],
      );
      const insert = (
        attributeId: string,
        type: string,
        valueId: string | null,
        n: number | null,
      ) =>
        app.query(
          `insert into store.product_attributes (product_id, attribute_id, attribute_type, value_id, number_value)
           values ($1, $2, $3, $4, $5)`,
          [product.id, attributeId, type, valueId, n],
        );
      const refused: [string, () => Promise<unknown>][] = [
        ['product_attributes_attribute_fk', () => insert(fabric.id, 'number', null, 8)],
        ['product_attributes_value_matches_type', () => insert(fabric.id, 'choice', null, null)],
        ['product_attributes_value_fk', () => insert(fabric.id, 'choice', brandValue.id, null)],
        ['product_attributes_value_matches_type', () => insert(ram.id, 'number', null, null)],
      ];
      for (const [constraint, attempt] of refused) {
        await app.query('savepoint s');
        await expect(attempt(), constraint).rejects.toMatchObject({ constraint });
        await app.query('rollback to savepoint s');
      }
      await insert(fabric.id, 'choice', cotton.id, null);
      await insert(ram.id, 'number', null, 8);
      const silk = await one<{ id: string }>(
        `insert into store.attribute_values (attribute_id) values ($1) returning id`,
        [fabric.id],
      );
      await expect(insert(fabric.id, 'choice', silk.id, null)).rejects.toMatchObject({
        constraint: 'product_attributes_single_unique',
      });
    });
  });

  it('keeps choice labels unique per attribute and language', async () => {
    await inA(async () => {
      const id = await brandId();
      const add = async (key: string) => {
        const v = await one<{ id: string }>(
          `insert into store.attribute_values (attribute_id) values ($1) returning id`,
          [id],
        );
        return app.query(
          `insert into store.attribute_value_translations (value_id, attribute_id, locale, label, label_key)
           values ($1, $2, 'en', $3, $3)`,
          [v.id, id, key],
        );
      };
      await add('aarong');
      await expect(add('aarong')).rejects.toThrow(/attribute_value_translations_label_unique/);
    });
  });
});

describe('text checks', () => {
  it('keeps slugs lowercase without spaces or stray hyphens', async () => {
    await inA(async () => {
      const { id } = await newProduct();
      for (const slug of ['Red', 'red saree', '-red', 'red-', 'red--saree', 'a/b']) {
        await app.query('savepoint s');
        await expect(
          app.query(
            `insert into store.product_translations (product_id, locale, title, slug) values ($1, 'en', 'x', $2)`,
            [id, slug],
          ),
          slug,
        ).rejects.toThrow(/product_translations_slug_format/);
        await app.query('rollback to savepoint s');
      }
      await app.query(
        `insert into store.product_translations (product_id, locale, title, slug) values ($1, 'bn', 'লাল শাড়ি', 'লাল-শাড়ি')`,
        [id],
      );
    });
  });

  it('stores tags normalized', async () => {
    await inA(async () => {
      const { id } = await newProduct();
      await expect(
        app.query(`insert into store.product_tags (product_id, tag) values ($1, 'Eid Sale')`, [id]),
      ).rejects.toThrow(/product_tags_tag_normalized/);
    });
  });

  it('ties collection rules to rule collections', async () => {
    await inA(async () => {
      await app.query('savepoint s');
      await expect(
        app.query(`insert into store.collections (kind, rules) values ('manual', '{}')`),
      ).rejects.toThrow(/collections_rules_match_kind/);
      await app.query('rollback to savepoint s');
      await expect(
        app.query(
          `insert into store.collections (kind, rules, sort) values ('rule', '{}', 'manual')`,
        ),
      ).rejects.toThrow(/collections_rules_match_kind/);
    });
  });
});

describe('stock ledger', () => {
  const setup = async () => {
    const { id: productId } = await newProduct();
    const variant = await one<{ id: string }>(
      `insert into store.variants (product_id, options_key, price) values ($1, '', 100) returning id`,
      [productId],
    );
    const location = await one<{ id: string }>(
      `select id from store.stock_locations where is_default`,
    );
    const move = (type: string, quantity: number, key: string | null = null) =>
      app.query(
        `insert into store.stock_movements (variant_id, location_id, type, quantity, reason, actor_type, idempotency_key)
         values ($1, $2, $3, $4, 'test', 'system', $5)`,
        [variant.id, location.id, type, quantity, key],
      );
    return { variant, move };
  };

  it('ties each movement type to its sign', async () => {
    await inA(async () => {
      const { move } = await setup();
      const refused: [string, number][] = [
        ['receive', -1],
        ['return', 0],
        ['sale', 2],
        ['reservation', -1],
        ['release', 1],
        ['adjustment', 0],
        ['theft', -1],
      ];
      for (const [type, quantity] of refused) {
        await app.query('savepoint s');
        await expect(move(type, quantity), `${type} ${quantity}`).rejects.toThrow(
          /stock_movements_type_sign/,
        );
        await app.query('rollback to savepoint s');
      }
      for (const [type, quantity] of [
        ['receive', 5],
        ['sale', -1],
        ['reservation', 2],
        ['release', -2],
        ['adjustment', -1],
        ['return', 1],
      ] as const) {
        await move(type, quantity);
      }
    });
  });

  it('writes a repeated idempotency key only once', async () => {
    await inA(async () => {
      const { move } = await setup();
      await move('receive', 5, 'import:job:2');
      await expect(move('receive', 5, 'import:job:2')).rejects.toThrow(
        /stock_movements_idempotency_unique/,
      );
    });
  });

  it('is append-only for the app, and keeps a variant with history from being deleted', async () => {
    await inA(async () => {
      const { variant, move } = await setup();
      await move('receive', 5);
      for (const sql of [
        'update store.stock_movements set quantity = 50',
        'delete from store.stock_movements',
      ]) {
        await app.query('savepoint s');
        await expect(app.query(sql)).rejects.toThrow(/permission denied/);
        await app.query('rollback to savepoint s');
      }
      await expect(
        app.query('delete from store.variants where id = $1', [variant.id]),
      ).rejects.toThrow(/stock_movements_variant_fk/);
    });
  });
});

describe('media', () => {
  it('keeps one row per image and refuses a malformed hash or type', async () => {
    await inA(async () => {
      const insert = (sha: string, mime = 'image/webp') =>
        app.query(
          `insert into store.media (sha256, mime, width, height, files) values ($1, $2, 800, 600, '[]')`,
          [sha, mime],
        );
      const sha = 'a'.repeat(64);
      await insert(sha);
      const refused: [string, string, string][] = [
        [sha, 'image/webp', 'media_sha256_unique'],
        ['A'.repeat(64), 'image/webp', 'media_sha256_format'],
        ['b'.repeat(64), 'image/svg+xml', 'media_mime_valid'],
      ];
      for (const [hash, mime, constraint] of refused) {
        await app.query('savepoint s');
        await expect(insert(hash, mime)).rejects.toMatchObject({ constraint });
        await app.query('rollback to savepoint s');
      }
    });
  });
});
