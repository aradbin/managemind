// The storefront's page endpoints and the admin's theme and page routes
// (phase-3-plan §6, §9): the store comes only from X-Forwarded-Host, pages
// carry their cache tags and an ETag, drafts and other stores never appear,
// previews need a token, and search misses are rate-limited.
import {
  type Actor,
  createPage,
  createProduct,
  createTenant,
  systemActor,
  type TenantTx,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import { signPreviewToken } from '@managemind/shared/storefront';
import { productTag, storeTag } from '@managemind/shared/storefront/cache';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { browser, signIn } from './staff';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const env = makeEnv();
let owner: pg.Client;
let app: pg.Client;
beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
});
afterAll(() => Promise.all([owner.end(), app.end()]));

let seq = 0;
const unique = () => `s${Date.now().toString(36)}${seq++}`;

async function store(defaultLocale: 'bn' | 'en' = 'bn') {
  const slug = unique();
  const email = `${slug}@example.test`;
  const { id } = await createTenant(app, systemActor, {
    slug,
    name: `Store ${slug}`,
    defaultLocale,
    owner: { email, name: 'Owner' },
  });
  const actor: Actor = {
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000ad',
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: id,
    storeRole: 'owner',
  };
  const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, id, fn);
  return { id, slug, email, host: `${slug}.${env.STORE_DOMAIN}`, actor, run };
}

async function get(path: string, host: string, headers: Record<string, string> = {}) {
  const ctx = makeCtx();
  const res = await createApp().request(
    path,
    { headers: { 'x-forwarded-host': host, ...headers } },
    env,
    ctx,
  );
  await ctx.settle();
  return res;
}

describe('store pages', () => {
  let a: Awaited<ReturnType<typeof store>>;
  let b: Awaited<ReturnType<typeof store>>;
  let productId: string;

  beforeAll(async () => {
    a = await store('bn');
    b = await store('en');
    // Both stores have a product with the same slug.
    const make = (
      s: typeof a,
      title: string,
      status: 'active' | 'draft' = 'active',
      slug = 'shared-slug',
    ) =>
      s.run((tx) =>
        createProduct(tx, s.actor, {
          status,
          translations: { [s.id === a.id ? 'bn' : 'en']: { title, slug } },
          variant: { price: 50_000, trackInventory: false },
        }),
      );
    productId = (await make(a, 'A product')).id;
    await make(b, 'B product');
    await make(a, 'A draft', 'draft', 'a-draft');
  });

  it('serves a product page with its layout, tags and an ETag', async () => {
    const res = await get('/v1/store/pages/products/shared-slug', a.host);
    expect(res.status).toBe(200);
    const body: Json = await res.json();
    expect(body.page.product.title).toBe('A product');
    expect(body.layout.store).toMatchObject({ slug: a.slug, defaultLocale: 'bn' });
    expect(body.redirect).toBeNull();
    expect(res.headers.get('x-cache-tags')).toBe(
      `${storeTag(a.id)},${productTag(a.id, productId)}`,
    );
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const tag = res.headers.get('etag') as string;
    expect(tag).toMatch(/^W\/"[0-9a-f]{24}"$/);
    const again = await get('/v1/store/pages/products/shared-slug', a.host, {
      'if-none-match': tag,
    });
    expect(again.status).toBe(304);
  });

  it('never returns another store’s product, even with the same slug', async () => {
    const res = await get('/v1/store/pages/products/shared-slug', b.host);
    expect(((await res.json()) as Json).page.product.title).toBe('B product');
    const sitemap: Json = await (await get('/v1/store/sitemap/products', b.host)).json();
    expect(sitemap.entries).toHaveLength(1);
    expect(sitemap).toMatchObject({ defaultLocale: 'en', indexing: false });
  });

  it('answers 404 with the layout for drafts and unknown slugs, and for unknown hosts', async () => {
    const draft = await get('/v1/store/pages/products/a-draft', a.host);
    expect(draft.status).toBe(404);
    expect(((await draft.json()) as Json).layout.store.slug).toBe(a.slug);
    expect((await get('/v1/store/pages/products/nope', a.host)).status).toBe(404);
    const unknown = await get('/v1/store/pages/home', `nobody.${env.STORE_DOMAIN}`);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as Json).code).toBe('store_not_found');
  });

  it('serves the homepage, listings, search and static pages', async () => {
    const home: Json = await (await get('/v1/store/pages/home?locale=en', a.host)).json();
    expect(home.layout.locale).toBe('en');
    expect(Object.values(home.page.productGrids).flat()).toContainEqual(
      expect.objectContaining({ id: productId }),
    );

    const search = await get('/v1/store/pages/search?q=product&utm_source=x', a.host);
    expect(((await search.json()) as Json).page.listing.items.map((i: Json) => i.id)).toEqual([
      productId,
    ]);

    await a.run((tx) =>
      createPage(tx, a.actor, {
        kind: 'about',
        published: true,
        translations: { bn: { title: 'আমাদের কথা', slug: 'about' } },
      }),
    );
    const page = await get('/v1/store/pages/pages/about', a.host);
    expect(((await page.json()) as Json).page.title).toBe('আমাদের কথা');
    const layout: Json = await (await get('/v1/store/pages/layout', a.host)).json();
    expect(layout.layout.pages.map((p: Json) => p.slug)).toContain('about');
  });

  it('limits search misses to 30 a minute per shopper', async () => {
    const ip = { 'x-shopper-ip': '198.51.100.9' };
    for (let i = 0; i < 30; i++) {
      expect((await get(`/v1/store/pages/search?q=x${i}`, a.host, ip)).status).toBe(200);
    }
    const refused = await get('/v1/store/pages/search?q=again', a.host, ip);
    expect(refused.status).toBe(429);
    // Another shopper isn't affected, and an empty search costs nothing.
    expect(
      (await get('/v1/store/pages/search?q=x', a.host, { 'x-shopper-ip': '198.51.100.10' })).status,
    ).toBe(200);
    expect((await get('/v1/store/pages/search', a.host, ip)).status).toBe(200);
  });

  it('shows the draft theme only with a valid preview token for this store', async () => {
    const { token } = await signPreviewToken(a.id, env.AUTH_SECRET as string);
    const ok = await get(
      `/v1/store/preview?path=/products/shared-slug&token=${encodeURIComponent(token)}`,
      a.host,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(((await ok.json()) as Json).page.product.title).toBe('A product');
    const wrongStore = await get(
      `/v1/store/preview?path=/&token=${encodeURIComponent(token)}`,
      b.host,
    );
    expect(wrongStore.status).toBe(401);
    expect((await get('/v1/store/preview?path=/&token=bad', a.host)).status).toBe(401);
  });
});

describe('admin theme and pages', () => {
  it('edits, previews and publishes the theme, and manages pages', async () => {
    const s = await store('bn');
    const user = browser(makeEnv({ STOREFRONT_ORIGIN: 'https://storefront.example.test' }));
    expect((await signIn(user, owner, s.email)).status).toBe(200);
    expect((await user.call('PUT', '/api/admin/me/active-store', { tenantId: s.id })).status).toBe(
      200,
    );

    const theme: Json = await (await user.get('/api/admin/theme')).json();
    expect(theme.published).toBeNull();
    const pale = structuredClone(theme.draft);
    pale.tokens.colors.text = '#eeeeee';
    const refused = await user.call('PUT', '/api/admin/theme/draft', pale);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as Json).errors[0]).toMatchObject({
      path: 'tokens.colors.text',
      code: 'contrast',
    });

    const preset: Json = await (await user.post('/api/admin/theme/presets/fashion')).json();
    expect(preset.draft.preset).toBe('fashion');
    const published: Json = await (await user.post('/api/admin/theme/publish')).json();
    expect(published.published.preset).toBe('fashion');

    const token: Json = await (await user.post('/api/admin/theme/preview-token')).json();
    expect(token.url).toMatch(
      new RegExp(`^https://storefront\\.example\\.test/__preview\\?store=${s.slug}&token=`),
    );

    const profile: Json = await (await user.get('/api/admin/store')).json();
    expect(profile.storeUrl).toBe(`https://storefront.example.test/?store=${s.slug}`);
    expect(profile.storefront.indexing).toBe(false);
    const saved = await user.call('PATCH', '/api/admin/store', {
      storefront: { ...profile.storefront, indexing: true },
      display: { numerals: 'latin' },
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as Json).display).toEqual({ numerals: 'latin' });

    const created = await user.post('/api/admin/pages', {
      kind: 'privacy',
      translations: { bn: { title: 'গোপনীয়তা' } },
    });
    expect(created.status).toBe(201);
    const page: Json = await created.json();
    expect(page.translations.bn.body.content[0].type).toBe('heading');
    const updated = await user.call('PATCH', `/api/admin/pages/${page.id}`, { published: true });
    expect(((await updated.json()) as Json).published).toBe(true);
    expect(
      ((await (await user.get('/api/admin/pages')).json()) as Json[]).map((p) => p.id),
    ).toEqual([page.id]);
    expect((await user.call('DELETE', `/api/admin/pages/${page.id}`)).status).toBe(204);
  });
});
