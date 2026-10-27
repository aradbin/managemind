// Stock counts over HTTP (phase-8-plan §3.5, §7): a count of 501 lines is
// applied through the delayed-work queue, 500 lines a message, with the next
// message sent by the first; staff never see what's expected while counting.
import { createProduct, createTenant, systemActor, withTenant } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleStockCountMessages, type StockCountMessage } from '../src/stock-counts';
import { browser, signIn } from './staff';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

class Delayed {
  sent: StockCountMessage[] = [];
  async send(body: StockCountMessage) {
    this.sent.push(body);
  }
  async sendBatch(batch: { body: StockCountMessage }[]) {
    for (const m of batch) this.sent.push(m.body);
  }
}
const delayed = new Delayed();
const env = makeEnv({ DOMAINS: delayed as never });

let owner: pg.Client;
let app: pg.Client;
let store: { id: string; email: string; variant: string };

beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const slug = `sc${Date.now().toString(36)}`;
  const email = `${slug}@example.test`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: 'Counts',
    defaultLocale: 'en',
    owner: { email, name: 'Owner' },
  });
  const actor = {
    kind: 'user' as const,
    userId: created.ownerUserId,
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: created.id,
    storeRole: 'owner' as const,
  };
  const variant = await withTenant(app, created.id, async (tx) => {
    const p = await createProduct(tx, actor, {
      status: 'active',
      translations: { en: { title: 'Saree' } },
      variant: { price: 1_000_00, costPrice: 10 },
    });
    return p.variants[0]?.id as string;
  });
  store = { id: created.id, email, variant };
});
afterAll(() => Promise.all([owner.end(), app.end()]));

const message = (body: StockCountMessage) => ({
  body,
  attempts: 1,
  acked: false,
  ack() {
    this.acked = true;
  },
  retry() {},
});

describe('stock counts over HTTP', () => {
  it('applies a count of 501 lines through the queue', async () => {
    const b = browser(env);
    expect((await signIn(b, owner, store.email)).status).toBe(200);
    expect((await b.call('PUT', '/api/admin/me/active-store', { tenantId: store.id })).status).toBe(
      200,
    );
    // 500 more variants of the same product, straight into the table.
    const { rows } = await owner.query<{ id: string }>(
      `insert into store.variants (tenant_id, product_id, options_key, price, cost_price)
       select v.tenant_id, v.product_id, gen_random_uuid()::text, 100, 10
         from store.variants v, generate_series(1, 500) where v.id = $1
       returning id`,
      [store.variant],
    );
    const ids = [store.variant, ...rows.map((r) => r.id)];
    const started = await b.post('/api/admin/stock-counts', {
      scope: { kind: 'variants', variantIds: ids },
    });
    expect(started.status).toBe(201);
    const count = (await started.json()) as Json;
    expect(count.lineCount).toBe(501);

    const line = await b.call('PUT', `/api/admin/stock-counts/${count.id}/lines/${store.variant}`, {
      counted: 3,
    });
    expect(line.status).toBe(200);
    const blind = (await (await b.get(`/api/admin/stock-counts/${count.id}`)).json()) as Json;
    expect(blind.lines.some((l: Json) => 'expected' in l)).toBe(false);
    await owner.query(
      `update store.stock_count_lines set counted = 1, counted_at = now() where stock_count_id = $1 and counted is null`,
      [count.id],
    );
    expect((await b.post(`/api/admin/stock-counts/${count.id}/submit`)).status).toBe(200);

    const applying = (await (
      await b.post(`/api/admin/stock-counts/${count.id}/apply`)
    ).json()) as Json;
    expect(applying.status).toBe('applying');
    expect(delayed.sent).toEqual([
      { kind: 'stock_count_apply', tenantId: store.id, countId: count.id },
    ]);

    // The first message applies 500 lines and sends the next; the second finishes.
    const first = message(delayed.sent[0] as StockCountMessage);
    await handleStockCountMessages([first as never], env, makeCtx());
    expect(first.acked).toBe(true);
    expect(delayed.sent).toHaveLength(2);
    await handleStockCountMessages(
      [message(delayed.sent[1] as StockCountMessage) as never],
      env,
      makeCtx(),
    );
    expect(delayed.sent).toHaveLength(2);

    const done = (await (await b.get(`/api/admin/stock-counts/${count.id}`)).json()) as Json;
    expect(done).toMatchObject({ status: 'applied', differences: { lines: 501, units: 503 } });
    const { rows: moved } = await owner.query<{ n: string }>(
      `select count(*) as n from store.stock_movements where reference_id = $1`,
      [count.id],
    );
    expect(Number(moved[0]?.n)).toBe(501);

    // A malformed message is dropped, not retried.
    const bad = message({ kind: 'stock_count_apply', tenantId: 'x', countId: count.id });
    await handleStockCountMessages([bad as never], env, makeCtx());
    expect(bad.acked).toBe(true);
    expect(delayed.sent).toHaveLength(2);
  });
});
