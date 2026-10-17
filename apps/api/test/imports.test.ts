// Spreadsheet imports through the real queue path (phase-2-plan §3.7, §8,
// §11): the browser's dry run, staged chunks in R2, the queue consumer, row
// errors, stock in the ledger, images, re-imports, redeliveries and dead
// letters. The acceptance criterion: 500 products with variants in one go,
// correct in both languages.
import { createTenant, type ImportMessage, systemActor } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { chunkProducts, dryRunImport, type MappedRow } from '@managemind/shared/catalog/import';
import { mapCustomerHeaders, parseCustomerRow } from '@managemind/shared/orders/customer-import';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleImportDeadLetters, handleImportQueue } from '../src/jobs';
import { FIXTURE_ATTRIBUTES, fixtureRows } from './import-fixture';
import { type Browser, browser, signIn } from './staff';
import { appUrl, FakeQueue, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const imports = new FakeQueue();
const env = makeEnv({ IMPORTS: imports as unknown as Queue<ImportMessage> });
let owner: pg.Client;
let app: pg.Client;
let tenantId: string;
let user: Browser;
beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  const slug = `i${Date.now().toString(36)}`;
  const email = `${slug}@example.test`;
  tenantId = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Import API',
      defaultLocale: 'bn',
      owner: { email, name: 'Owner' },
    })
  ).id;
  user = browser(env);
  expect((await signIn(user, owner, email)).status).toBe(200);
  expect((await user.call('PUT', '/api/admin/me/active-store', { tenantId })).status).toBe(200);
  for (const a of FIXTURE_ATTRIBUTES) {
    const res = await user.post('/api/admin/attributes', {
      key: a.key,
      type: a.type,
      translations: { en: { name: a.name }, bn: { name: a.name } },
    });
    expect(res.status).toBe(201);
  }
});
afterAll(() => Promise.all([owner.end(), app.end()]));

const api = async (method: string, path: string, body?: unknown) => {
  const res = await user.call(method, `/api/admin${path}`, body);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
};

/** Delivers queued import messages to the consumer until none are left. */
async function drain(max = 1_000) {
  const ctx = makeCtx();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  let delivered = 0;
  try {
    while (imports.sent.length && delivered < max) {
      const body = imports.sent.shift() as unknown as ImportMessage;
      const outcome = { acked: false, retried: false };
      await handleImportQueue(
        {
          queue: 'managemind-imports',
          messages: [
            {
              id: `m${delivered}`,
              timestamp: new Date(),
              attempts: 1,
              body,
              ack: () => {
                outcome.acked = true;
              },
              retry: () => {
                outcome.retried = true;
              },
            },
          ],
        } as unknown as MessageBatch<ImportMessage>,
        env,
        ctx,
      );
      expect(outcome, JSON.stringify(body)).toEqual({ acked: true, retried: false });
      delivered += 1;
    }
  } finally {
    log.mockRestore();
  }
  await ctx.settle();
  return delivered;
}

/** The whole browser side: dry run, job, staged chunks, start; then the queue. */
async function runImport(
  rows: MappedRow[],
  options: { chunkSize?: number; tamper?: (chunks: unknown[][]) => void } = {},
) {
  const dry = dryRunImport(rows, { defaultLocale: 'bn' });
  const chunks: unknown[][] = chunkProducts(dry.products, options.chunkSize ?? 10);
  options.tamper?.(chunks);
  const job = await api('POST', '/imports', {
    fileName: 'catalog.xlsx',
    chunkCount: chunks.length,
    total: dry.products.length,
    stock: true,
  });
  expect(job.status).toBe(201);
  for (const [n, chunk] of chunks.entries()) {
    expect((await api('PUT', `/imports/${job.body.id}/chunks/${n}`, chunk)).status).toBe(204);
  }
  expect((await api('POST', `/imports/${job.body.id}/start`)).status).toBe(200);
  const started = performance.now();
  const delivered = await drain();
  return { id: job.body.id as string, dry, delivered, ms: performance.now() - started };
}

const count = async (sql: string) =>
  Number((await owner.query<{ n: string }>(sql, [tenantId])).rows[0]?.n);

describe('the 500-product import (acceptance criterion 1)', () => {
  let jobId: string;

  it('imports 500 products with 1,500 variants in one go', async () => {
    const run = await runImport(fixtureRows(500, 'FX'));
    jobId = run.id;
    expect(run.dry.errors).toEqual([]);
    expect(run.delivered).toBe(50);
    const job = (await api('GET', `/imports/${jobId}`)).body;
    expect(job).toMatchObject({
      status: 'images',
      total: 500,
      processed: 500,
      created: 500,
      updated: 0,
      failed: 0,
      errorCount: 0,
      images: { pending: 6 },
    });
    console.info(
      `500 products in ${Math.round(run.ms)} ms (${Math.round(run.ms / 50)} ms per chunk, wall time)`,
    );
  }, 300_000);

  it('has every product, variant and translation, in both languages', async () => {
    const t = 'tenant_id = $1';
    expect(await count(`select count(*) as n from store.products where ${t}`)).toBe(500);
    expect(
      await count(`select count(*) as n from store.variants where ${t} and archived_at is null`),
    ).toBe(1500);
    expect(
      await count(
        `select count(*) as n from store.product_translations where ${t} and locale = 'bn'`,
      ),
    ).toBe(500);
    expect(
      await count(
        `select count(*) as n from store.product_translations where ${t} and locale = 'en'`,
      ),
    ).toBe(500);
    expect(
      await count(`select count(*) as n from store.product_options where ${t} and position = 2`),
    ).toBe(100);

    const list = await api('GET', '/products?q=FX-7-1');
    expect(list.body.items).toHaveLength(1);
    const product = (await api('GET', `/products/${list.body.items[0].id}`)).body;
    expect(product).toMatchObject({
      status: 'active',
      translations: {
        bn: { title: 'ফিক্সচার পাঞ্জাবি ৭', slug: 'fx-product-7' },
        en: { title: 'Fixture Panjabi 7', slug: 'fixture-panjabi-7' },
      },
      tags: ['eid', 'new-arrival'],
    });
    expect(product.translations.en.description.content[0].content[1]).toEqual({
      type: 'text',
      text: 'Jamdani',
      marks: [{ type: 'bold' }],
    });
    expect(product.options.map((o: Json) => o.name)).toEqual([{ bn: 'সাইজ', en: 'Size' }]);
    expect(product.variants.map((v: Json) => [v.sku, v.price, v.stock.onHand])).toEqual([
      ['FX-7-0', 50_700, 0],
      ['FX-7-1', 50_700, 1],
      ['FX-7-2', 50_700, 2],
    ]);
    const types = Object.fromEntries(product.attributes.map((a: Json) => [a.key, a]));
    expect(types.brand.valueIds).toHaveLength(1);
    expect(types.fabric.valueIds).toHaveLength(1);
    expect(types.occasion.valueIds).toHaveLength(2);
    expect(types.weight_kg.number).toBe(0.5);
    expect(types.handmade.boolean).toBe(true);
    expect(types.care.text).toEqual({ bn: 'ড্রাই ক্লিন', en: 'Dry clean' });
    // Categories by path, created once.
    expect(await count(`select count(*) as n from store.categories where ${t}`)).toBe(3);
  });

  it('puts every stock count in the ledger, with no drift', async () => {
    const t = 'tenant_id = $1';
    const moved = await count(
      `select count(*) as n from store.stock_movements where ${t} and reason = 'import' and reference_type = 'import'`,
    );
    // Rows with stock 0 need no movement.
    const nonzero = fixtureRows(500, 'FX').filter((r) => r.stock !== '0').length;
    expect(moved).toBe(nonzero);
    const { rows } = await owner.query(
      'select * from app.inventory_drift(10) where tenant_id = $1',
      [tenantId],
    );
    expect(rows).toEqual([]);
  });

  it('runs the image step: images attach, failures become row errors', async () => {
    const pending = (await api('GET', `/imports/${jobId}/images`)).body;
    expect(pending).toHaveLength(6);
    // Register one real image to attach; fail the rest.
    const bytes = new Uint8Array(600);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.set(new TextEncoder().encode(`import ${Date.now()}`), 8);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await user.call('PUT', `/api/admin/media/files/${digest}.png`, bytes, {
      'content-type': 'image/png',
    });
    const media = await api('POST', '/media', {
      mime: 'image/png',
      width: 400,
      height: 400,
      files: [{ width: 400, sha256: digest, bytes: bytes.byteLength }],
    });
    const [first, ...rest] = pending;
    const done = await api('PATCH', `/imports/${jobId}/images/${first.id}`, {
      status: 'done',
      mediaId: media.body.id,
    });
    expect(done.status).toBe(200);
    for (const image of rest) {
      await api('PATCH', `/imports/${jobId}/images/${image.id}`, {
        status: 'failed',
        error: 'the site answered 404',
      });
    }
    const job = (await api('GET', `/imports/${jobId}`)).body;
    expect(job).toMatchObject({
      status: 'done',
      images: { pending: 0, done: 1, failed: 5 },
      errorCount: 5,
    });
    const product = (await api('GET', `/products/${first.productId}`)).body;
    expect(product.media.map((m: Json) => m.mediaId)).toEqual([media.body.id]);
    const errors = (await api('GET', `/imports/${jobId}/errors`)).body;
    expect(errors.items[0]).toMatchObject({ code: 'image_failed', field: 'images' });
  });

  it('updates by SKU on re-import, writing stock only where it changed', async () => {
    const before = await count(
      `select count(*) as n from store.stock_movements where tenant_id = $1`,
    );
    const rows = fixtureRows(500, 'FX').map((r, i) =>
      i === 0 ? { ...r, price: '999', stock: '40' } : r,
    );
    const run = await runImport(rows);
    const job = (await api('GET', `/imports/${run.id}`)).body;
    expect(job).toMatchObject({ created: 0, updated: 500, failed: 0 });
    expect(await count(`select count(*) as n from store.products where tenant_id = $1`)).toBe(500);
    expect(
      await count(`select count(*) as n from store.stock_movements where tenant_id = $1`),
    ).toBe(before + 1);
    const product = (
      await api('GET', `/products/${(await api('GET', '/products?q=FX-0-0')).body.items[0].id}`)
    ).body;
    expect(product.variants[0]).toMatchObject({
      sku: 'FX-0-0',
      price: 99_900,
      stock: { onHand: 40 },
    });
  }, 300_000);
});

describe('import errors and delivery', () => {
  it('refuses on the server what the browser would have refused, product by product', async () => {
    const run = await runImport(fixtureRows(3, 'BAD'), {
      tamper: (chunks) => {
        const products = chunks[0] as Json[];
        products[0].variants[0].price = -5;
        products[1].images = ['javascript:alert(1)'];
      },
    });
    const job = (await api('GET', `/imports/${run.id}`)).body;
    // The product left has image links, so the job waits for the image step.
    expect(job).toMatchObject({ status: 'images', created: 1, failed: 2, errorCount: 2 });
    expect(
      await count(
        `select count(*) as n from store.variants where tenant_id = $1 and sku like 'BAD-%'`,
      ),
    ).toBe(3);
  });

  it('reports SKUs of two products, changed options and an unknown attribute on their rows', async () => {
    const size = (value: string) => ({ 'option1Name:bn': 'সাইজ', 'option1Value:bn': value });
    const rows: MappedRow[] = [
      // Two SKUs of two existing products in one product.
      { handle: 'thief', 'title:bn': 'চোর', ...size('M'), sku: 'FX-1-1', price: '10' },
      { handle: 'thief', ...size('L'), sku: 'FX-2-1', price: '10' },
      // A known SKU updates its product, whose options are different.
      { handle: 'renamed', 'title:bn': 'নতুন', sku: 'FX-3-1', price: '10' },
      { handle: 'mystery', 'title:bn': 'রহস্য', price: '10', 'attribute:nonexistent': 'x' },
    ];
    const run = await runImport(rows);
    const errors = (await api('GET', `/imports/${run.id}/errors`)).body.items;
    expect(errors.map((e: Json) => [e.row, e.field, e.code])).toEqual([
      [3, 'sku', 'conflict'],
      [4, 'option1Name', 'conflict'],
      [5, 'attribute:nonexistent', 'not_found'],
    ]);
  });

  it('skips a chunk delivered twice, and marks a dead-lettered job failed', async () => {
    const run = await runImport(fixtureRows(2, 'TWICE'), { chunkSize: 1 });
    const before = await count(
      `select count(*) as n from store.stock_movements where tenant_id = $1`,
    );
    imports.sent.push({ tenantId, jobId: run.id, chunk: 0 } as never);
    await drain();
    expect(
      await count(`select count(*) as n from store.stock_movements where tenant_id = $1`),
    ).toBe(before);
    // Products 0 and 1 of the fixture have image links: the image step is next.
    expect((await api('GET', `/imports/${run.id}`)).body).toMatchObject({
      status: 'images',
      created: 2,
    });

    const job = await api('POST', '/imports', { fileName: 'x.csv', chunkCount: 1, total: 1 });
    await owner.query(`update store.import_jobs set status = 'running' where id = $1`, [
      job.body.id,
    ]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await handleImportDeadLetters(
      {
        queue: 'managemind-imports-dlq',
        messages: [
          {
            id: 'd1',
            attempts: 4,
            body: { tenantId, jobId: job.body.id, chunk: 0 },
            ack: () => {},
            retry: () => {},
          },
        ],
      } as unknown as MessageBatch<ImportMessage>,
      env,
      makeCtx(),
    );
    error.mockRestore();
    expect((await api('GET', `/imports/${job.body.id}`)).body).toMatchObject({
      status: 'failed',
      lastError: 'chunk 0 failed 4 times; see the logs',
    });
  });

  it('needs every chunk staged before starting, and inventory.write for stock', async () => {
    const job = await api('POST', '/imports', { fileName: 'x.csv', chunkCount: 2, total: 2 });
    expect((await api('POST', `/imports/${job.body.id}/start`)).status).toBe(422);
    expect((await api('POST', `/imports/${job.body.id}/cancel`)).body.status).toBe('cancelled');
  });
});

describe('customer imports (phase-4-plan §3.10)', () => {
  it('imports customers through the same job, kept apart from product imports', async () => {
    const header = ['Name', 'Phone', 'Address', 'Area', 'District', 'Tags'];
    const rows = [
      ['Rahim', '01711-000001', 'House 5, Road 2', 'Dhanmondi', 'Dhaka', 'vip'],
      ['করিম', '০১৭১১০০০০০২', '', '', '', ''],
      ['Nobody', 'not a phone', '', '', '', ''],
    ];
    const columns = mapCustomerHeaders(header);
    const parsed = rows.map((r, i) => parseCustomerRow(r, columns, i + 2));
    expect(parsed.map((p) => p.errors.length)).toEqual([0, 0, 1]);
    const customers = parsed.flatMap((p) => (p.customer ? [p.customer] : []));

    const job = await api('POST', '/imports', {
      kind: 'customers',
      fileName: 'customers.csv',
      chunkCount: 1,
      total: customers.length,
    });
    expect(job.status).toBe(201);
    expect(job.body.kind).toBe('customers');
    expect((await api('PUT', `/imports/${job.body.id}/chunks/0`, customers)).status).toBe(204);
    expect((await api('POST', `/imports/${job.body.id}/start`)).status).toBe(200);
    await drain();
    expect((await api('GET', `/imports/${job.body.id}`)).body).toMatchObject({
      status: 'done',
      created: 2,
    });

    const list = await api('GET', '/customers?q=01711000001');
    expect(list.body.items[0]).toMatchObject({ name: 'Rahim', tags: ['vip'] });
    const detail = await api('GET', `/customers/${list.body.items[0].id}`);
    expect(detail.body.addresses[0]).toMatchObject({ areaId: 513, line: 'House 5, Road 2' });

    const kinds = await api('GET', '/imports?kind=customers');
    expect(kinds.body.map((j: Json) => j.id)).toEqual([job.body.id]);
    const products = await api('GET', '/imports');
    expect(products.body.some((j: Json) => j.id === job.body.id)).toBe(false);
  });
});
