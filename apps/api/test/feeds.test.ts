// The Meta product feed (phase-9-plan §3.1.4): turned on in settings, built
// through the delayed queue a chunk a message into R2, rebuilt once after a
// catalog change, and removed when turned off.
import {
  createProduct,
  createTenant,
  type OutboxEvent,
  systemActor,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { objectKey, permissionsOf } from '@managemind/shared';
import { type FeedManifest, feedPath } from '@managemind/shared/channels';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type FeedBuildMessage, handleFeedBuilds, queueFeedBuilds } from '../src/feeds';
import { browser, signIn } from './staff';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

class Delayed {
  sent: { body: FeedBuildMessage; delaySeconds: number }[] = [];
  async send(body: FeedBuildMessage, options: { delaySeconds?: number } = {}) {
    this.sent.push({ body, delaySeconds: options.delaySeconds ?? 0 });
  }
  async sendBatch(batch: { body: FeedBuildMessage; delaySeconds?: number }[]) {
    for (const m of batch) this.sent.push({ body: m.body, delaySeconds: m.delaySeconds ?? 0 });
  }
}
const delayed = new Delayed();
const env = makeEnv({ DOMAINS: delayed as never });
const SHA = 'ab'.repeat(32);

let owner: pg.Client;
let app: pg.Client;
let store: { id: string; email: string; variant: string; product: string };

beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const slug = `fd${Date.now().toString(36)}`;
  const email = `${slug}@example.test`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: 'Feed Fashion',
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
  const made = await withTenant(app, created.id, async (tx) => {
    const p = await createProduct(tx, actor, {
      status: 'active',
      translations: { en: { title: 'Kurta, white' }, bn: { title: 'কুর্তা' } },
      variant: { price: 1_500_00, trackInventory: false },
    });
    // A product without a picture is left out and counted.
    await createProduct(tx, actor, {
      status: 'active',
      translations: { en: { title: 'No picture' } },
      variant: { price: 100_00 },
    });
    await tx.db.execute(sql`
      with m as (
        insert into store.media (sha256, mime, width, height, files)
        values (${SHA}, 'image/webp', 800, 800, ${JSON.stringify([{ width: 800, sha256: SHA, bytes: 1000 }])}::jsonb)
        returning id)
      insert into store.product_media (product_id, media_id, position) select ${p.id}, m.id, 0 from m`);
    return { product: p.id, variant: p.variants[0]?.id as string };
  });
  store = { id: created.id, email, ...made };
});
afterAll(() => Promise.all([owner.end(), app.end()]));

const message = (body: FeedBuildMessage) => ({
  body,
  attempts: 1,
  acked: false,
  ack() {
    this.acked = true;
  },
  retry() {},
});

/** Runs the build's chain of messages to the end. */
async function runBuild() {
  let guard = 0;
  while (delayed.sent.length && guard++ < 20) {
    const batch = delayed.sent.splice(0).map((m) => message(m.body));
    await handleFeedBuilds(batch as never, env, makeCtx());
    expect(batch.every((m) => m.acked)).toBe(true);
  }
}

const file = (path: string) =>
  env.FILES.objects.get(objectKey('file', store.id, path))?.body ?? null;
const text = (path: string) => {
  const body = file(path);
  return body ? new TextDecoder().decode(body) : null;
};

describe('the Meta feed', () => {
  it('builds when turned on, with one row per variant, and serves its addresses', async () => {
    const b = browser(env);
    expect((await signIn(b, owner, store.email)).status).toBe(200);
    expect((await b.call('PUT', '/api/admin/me/active-store', { tenantId: store.id })).status).toBe(
      200,
    );
    env.OUTBOX.sent.length = 0;
    const saved = await b.call('PATCH', '/api/admin/store', { meta: { feed: { enabled: true } } });
    expect(saved.status).toBe(200);
    await queueFeedBuilds(env, makeCtx(), env.OUTBOX.sent as OutboxEvent[]);
    expect(delayed.sent).toEqual([
      { body: { kind: 'feed_build', tenantId: store.id }, delaySeconds: 0 },
    ]);
    await runBuild();

    const manifest = JSON.parse(text(feedPath.manifest) as string) as FeedManifest;
    expect(manifest).toMatchObject({ defaultLocale: 'en', chunks: { en: 1, bn: 1 } });
    const en = text(feedPath.chunk(manifest.build, 'en', 0)) as string;
    const rows = en.trim().split('\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`${store.variant},${store.product},"Kurta, white"`);
    expect(rows[0]).toContain(',in stock,new,1500.00 BDT,,');
    expect(rows[0]).toContain(`.stores.example.test/products/kurta-white?v=${store.variant},`);
    expect(rows[0]).toContain(`/media/${SHA}.webp`);
    expect(rows[0]).toContain(',Feed Fashion,');
    const bn = text(feedPath.chunk(manifest.build, 'bn', 0)) as string;
    expect(bn).toContain(',কুর্তা,');

    const meta = (await (await b.get('/api/admin/channels/meta')).json()) as Json;
    expect(meta.feed).toMatchObject({ enabled: true, rows: 1, skipped: { no_image: 1 } });
    expect(meta.feed.urls.default).toContain(`/feeds/meta.csv?key=${manifest.key}`);
  });

  it('rebuilds once after catalog changes, into a new folder, and removes the old one', async () => {
    const first = JSON.parse(text(feedPath.manifest) as string) as FeedManifest;
    const change = (id: string) =>
      ({
        id,
        tenantId: store.id,
        eventType: 'catalog.product.updated',
        payload: { fields: ['prices'] },
      }) as unknown as OutboxEvent;
    await queueFeedBuilds(env, makeCtx(), [change('e1')]);
    await queueFeedBuilds(env, makeCtx(), [change('e2')]);
    // The second change rides along with the build the first one queued.
    expect(delayed.sent).toEqual([
      { body: { kind: 'feed_build', tenantId: store.id }, delaySeconds: 900 },
    ]);
    await runBuild();
    const second = JSON.parse(text(feedPath.manifest) as string) as FeedManifest;
    expect(second.build).not.toBe(first.build);
    expect(second.key).toBe(first.key);
    expect(file(feedPath.chunk(first.build, 'en', 0))).toBeNull();
    expect(file(feedPath.chunk(second.build, 'en', 0))).not.toBeNull();
  });

  it('changes the key on asking, and the next build carries it', async () => {
    const b = browser(env);
    await signIn(b, owner, store.email);
    await b.call('PUT', '/api/admin/me/active-store', { tenantId: store.id });
    const before = JSON.parse(text(feedPath.manifest) as string) as FeedManifest;
    env.OUTBOX.sent.length = 0;
    const res = await b.post('/api/admin/channels/meta/feed/key');
    const meta = (await res.json()) as Json;
    expect(res.status, JSON.stringify(meta)).toBe(200);
    expect(meta.feed.urls.default).not.toContain(before.key);
    await queueFeedBuilds(env, makeCtx(), env.OUTBOX.sent as OutboxEvent[]);
    await runBuild();
    const after = JSON.parse(text(feedPath.manifest) as string) as FeedManifest;
    expect(after.key).not.toBe(before.key);
    expect(meta.feed.urls.default).toContain(after.key);
    // The audit log never holds the key.
    const { rows } = await owner.query<{ after: unknown }>(
      `select after from store.audit_log where tenant_id = $1 and action like 'store.%'`,
      [store.id],
    );
    expect(JSON.stringify(rows)).not.toContain(after.key);
    expect(JSON.stringify(rows)).not.toContain(before.key);
  });

  it('removes the feed when turned off, and keeps its key for when it comes back', async () => {
    const b = browser(env);
    await signIn(b, owner, store.email);
    await b.call('PUT', '/api/admin/me/active-store', { tenantId: store.id });
    const { key } = JSON.parse(text(feedPath.manifest) as string) as FeedManifest;
    env.OUTBOX.sent.length = 0;
    await b.call('PATCH', '/api/admin/store', { meta: { feed: { enabled: false } } });
    await queueFeedBuilds(env, makeCtx(), env.OUTBOX.sent as OutboxEvent[]);
    await runBuild();
    expect(text(feedPath.manifest)).toBeNull();
    const meta = (await (await b.get('/api/admin/channels/meta')).json()) as Json;
    expect(meta.feed.urls).toBeNull();
    const back = (await (
      await b.call('PATCH', '/api/admin/store', { meta: { feed: { enabled: true } } })
    ).json()) as Json;
    expect(back.meta.feed.key).toBe(key);
  });
});
