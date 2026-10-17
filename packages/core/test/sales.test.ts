// Scheduled sale prices (phase-4-plan §3.14): a sale below the regular price
// with a window; inside it the pages, the price range and carts use the sale
// price with the regular one struck through; future edges are announced for
// the delayed queue, and applySaleEdges refreshes the range when a window
// opens or closes.
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  applySaleEdges,
  bulkUpdateVariants,
  createProduct,
  createTenant,
  type Lang,
  productCards,
  publishedProduct,
  systemActor,
  type TenantTx,
  updateVariant,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let owner: pg.Client;
let store: string;
let actor: Actor;
const en: Lang = { locale: 'en', fallback: 'en' };
const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

beforeAll(async () => {
  [app, owner] = await Promise.all([connectApp(), connectOwner()]);
  const slug = `sale${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Sales test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  actor = {
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000ee',
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: store,
    storeRole: 'owner',
  };
});
afterAll(() => Promise.all([app.end(), owner.end()]));

async function product(price: number) {
  const p = await run((tx) =>
    createProduct(tx, actor, {
      status: 'active',
      translations: { en: { title: `Sari ${price}` } },
      variant: { price },
    }),
  );
  return { productId: p.id, variantId: p.variants[0]?.id as string };
}

const range = async (id: string) =>
  (
    await owner.query<{ lo: string; hi: string }>(
      'select price_min as lo, price_max as hi from store.products where id = $1',
      [id],
    )
  ).rows[0];

describe('scheduled sale prices', () => {
  it('refuses a sale at or above the price, or without a window', async () => {
    const { variantId } = await product(100_000);
    await expect(
      run((tx) =>
        updateVariant(tx, actor, variantId, {
          salePrice: 100_000,
          saleStartsAt: hours(-1),
          saleEndsAt: hours(1),
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run((tx) =>
        updateVariant(tx, actor, variantId, { salePrice: 80_000, saleStartsAt: hours(1) }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run((tx) =>
        updateVariant(tx, actor, variantId, {
          salePrice: 80_000,
          saleStartsAt: hours(2),
          saleEndsAt: hours(1),
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('sells at the sale price inside the window, with the regular price struck through', async () => {
    const { productId, variantId } = await product(100_000);
    const v = await run((tx) =>
      updateVariant(tx, actor, variantId, {
        salePrice: 80_000,
        saleStartsAt: hours(-1),
        saleEndsAt: hours(5),
      }),
    );
    expect(v).toMatchObject({ price: 100_000, salePrice: 80_000 });
    expect(await range(productId)).toEqual({ lo: '80000', hi: '80000' });
    const [card] = await run((tx) => productCards(tx, en, [productId]));
    expect(card).toMatchObject({ priceMin: 80_000, compareAt: 100_000 });
    const page = await run((tx) => publishedProduct(tx, en, productId));
    expect(page?.variants[0]).toMatchObject({ price: 80_000, compareAtPrice: 100_000 });
    // Only the end is still ahead: one edge for the delayed queue.
    const { rows } = await owner.query<{ payload: { edges: string[] } }>(
      `select payload from store.outbox where aggregate_id = $1 and event_type = 'catalog.sale_scheduled'`,
      [productId],
    );
    expect(rows.at(-1)?.payload.edges).toHaveLength(1);
  });

  it('keeps the regular price before the window, and changes at the edge', async () => {
    const { productId, variantId } = await product(100_000);
    await run((tx) =>
      bulkUpdateVariants(tx, actor, [
        { id: variantId, salePrice: 70_000, saleStartsAt: hours(2), saleEndsAt: hours(26) },
      ]),
    );
    expect(await range(productId)).toEqual({ lo: '100000', hi: '100000' });
    const { rows } = await owner.query<{ payload: { edges: string[] } }>(
      `select payload from store.outbox where aggregate_id = $1 and event_type = 'catalog.sale_scheduled'`,
      [productId],
    );
    expect(rows[0]?.payload.edges).toHaveLength(2);

    // The window opens (moved into the past here), and the edge arrives.
    await owner.query(
      `update store.variants set sale_starts_at = now() - interval '1 minute' where id = $1`,
      [variantId],
    );
    await run((tx) => applySaleEdges(tx, [productId]));
    expect(await range(productId)).toEqual({ lo: '70000', hi: '70000' });
    const purge = await owner.query(
      `select 1 from store.outbox where aggregate_id = $1 and event_type = 'catalog.product.updated'
          and payload = '{"fields": ["prices"]}'::jsonb`,
      [productId],
    );
    expect(purge.rowCount).toBe(1);

    // Clearing the sale clears its window.
    const cleared = await run((tx) => updateVariant(tx, actor, variantId, { salePrice: null }));
    expect(cleared).toMatchObject({ salePrice: null, saleStartsAt: null, saleEndsAt: null });
    expect(await range(productId)).toEqual({ lo: '100000', hi: '100000' });
  });

  it('refuses lowering the price to the sale price', async () => {
    const { variantId } = await product(100_000);
    await run((tx) =>
      updateVariant(tx, actor, variantId, {
        salePrice: 90_000,
        saleStartsAt: hours(-1),
        saleEndsAt: hours(1),
      }),
    );
    await expect(
      run((tx) => updateVariant(tx, actor, variantId, { price: 90_000 })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
