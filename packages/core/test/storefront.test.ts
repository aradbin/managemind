// Static pages, the theme service and the storefront's page queries
// (phase-3-plan §3.4, §3.5, §5, §9).
import { schema } from '@managemind/db';
import { permissionsOf } from '@managemind/shared';
import { presetTheme } from '@managemind/shared/storefront';
import { listsTag, pageTag, productTag, storeTag } from '@managemind/shared/storefront/cache';
import { parseListingQuery } from '@managemind/shared/storefront/listing';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  applyThemePreset,
  createCategory,
  createPage,
  createProduct,
  createTenant,
  deletePage,
  getTheme,
  homePage,
  listPages,
  productPage,
  publishedPageBySlug,
  publishTheme,
  saveThemeDraft,
  searchPage,
  sitemapPart,
  staticPage,
  storeLayout,
  systemActor,
  type TenantTx,
  updatePage,
  updateStoreProfile,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
let other: string;
let owner: Actor;
let staff: Actor;

const actor = (role: 'owner' | 'staff', tenantId: string): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000ac',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId,
  storeRole: role,
});

beforeAll(async () => {
  app = await connectApp();
  const make = async (suffix: string) => {
    const slug = `sf${Date.now().toString(36)}${suffix}`;
    return (
      await createTenant(app, systemActor, {
        slug,
        name: `Storefront ${suffix}`,
        defaultLocale: 'bn',
        owner: { email: `${slug}@example.test`, name: 'Owner' },
      })
    ).id;
  };
  store = await make('a');
  other = await make('b');
  owner = actor('owner', store);
  staff = actor('staff', store);
});
afterAll(() => app.end());

const run = <T>(fn: (tx: TenantTx) => Promise<T>, tenantId = store) =>
  withTenant(app, tenantId, fn);
const events = <T>(fn: (tx: TenantTx) => Promise<T>) =>
  run(async (tx) => {
    await fn(tx);
    return tx.events.map((e) => ({ type: e.eventType, payload: e.payload }));
  });

const addMedia = (tenantId = store) =>
  run(async (tx) => {
    const [row] = await tx.db
      .insert(schema.media)
      .values({
        sha256: `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
          .padEnd(64, '0')
          .slice(0, 64),
        mime: 'image/webp',
        width: 1600,
        height: 800,
        files: [{ width: 800, sha256: 'a'.repeat(64), bytes: 1 }],
        unusedSince: sql`now() - interval '30 days'`,
      })
      .returning({ id: schema.media.id });
    return row?.id as string;
  }, tenantId);

describe('static pages', () => {
  it('starts a store with policy drafts with suggested headings, one per kind', async () => {
    // Onboarding adds terms, privacy, returns and delivery as drafts (phase-5b-plan §3.2).
    const drafts = await run((tx) => listPages(tx, owner));
    expect(drafts.map((p) => [p.kind, p.published]).sort()).toEqual([
      ['delivery', false],
      ['privacy', false],
      ['returns', false],
      ['terms', false],
    ]);
    const draft = drafts.find((p) => p.kind === 'returns');
    expect(draft?.translations.bn?.body?.content?.[0]).toMatchObject({ type: 'heading' });
    const page = await run((tx) => updatePage(tx, owner, draft?.id as string, { published: true }));
    expect(page.translations.bn?.slug).toBe('রিটার্ন-নীতি');
    await expect(
      run((tx) =>
        createPage(tx, owner, { kind: 'returns', translations: { bn: { title: 'আবার' } } }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      run((tx) => createPage(tx, staff, { kind: 'about', translations: { bn: { title: 'x' } } })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // The store's default language is required.
    await expect(
      run((tx) =>
        createPage(tx, owner, { kind: 'custom', translations: { en: { title: 'Only English' } } }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('shows only published pages, redirects renamed slugs and purges the footer when it changes', async () => {
    const created = await events((tx) =>
      createPage(tx, owner, {
        kind: 'custom',
        translations: { bn: { title: 'সাইজ গাইড', slug: 'size-guide' } },
      }),
    );
    expect(created).toContainEqual({
      type: 'catalog.page.changed',
      payload: { change: 'created', navigation: false },
    });
    const lang = { locale: 'bn' as const, fallback: 'bn' as const };
    expect(await run((tx) => publishedPageBySlug(tx, lang, 'size-guide'))).toBeNull();

    const { rows } = await run((tx) =>
      tx.db.execute<{ id: string }>(
        sql`select page_id as id from store.page_translations where slug = 'size-guide'`,
      ),
    );
    const id = rows[0]?.id as string;
    const published = await events((tx) => updatePage(tx, owner, id, { published: true }));
    expect(published).toContainEqual({
      type: 'catalog.page.changed',
      payload: { change: 'updated', navigation: true },
    });
    expect(await run((tx) => publishedPageBySlug(tx, lang, 'size-guide'))).toMatchObject({
      found: { id, title: 'সাইজ গাইড' },
    });

    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'S, M, L' }] }],
    };
    const edited = await events((tx) =>
      updatePage(tx, owner, id, { translations: { bn: { title: 'সাইজ গাইড', body } } }),
    );
    expect(edited).toContainEqual({
      type: 'catalog.page.changed',
      payload: { change: 'updated', navigation: false },
    });

    await run((tx) =>
      updatePage(tx, owner, id, { translations: { bn: { title: 'মাপ', slug: 'sizes' } } }),
    );
    expect(await run((tx) => publishedPageBySlug(tx, lang, 'size-guide'))).toEqual({
      redirect: 'sizes',
    });
    const page = await run((tx) => staticPage(tx, lang, 'sizes'));
    expect(page.tags).toEqual([storeTag(store), pageTag(store, id)]);

    await run((tx) => deletePage(tx, owner, id));
    expect(await run((tx) => publishedPageBySlug(tx, lang, 'sizes'))).toBeNull();
    expect(await run((tx) => publishedPageBySlug(tx, lang, 'size-guide'))).toBeNull();
  });
});

describe('theme', () => {
  it('starts from the default theme and saves a draft without publishing it', async () => {
    const start = await run((tx) => getTheme(tx, staff));
    expect(start.published).toBeNull();
    const draft = { ...start.draft, announcement: { text: { bn: 'ঈদ অফার' }, link: null } };
    const saved = await events((tx) => saveThemeDraft(tx, owner, draft));
    expect(saved).toEqual([]);
    const after = await run((tx) => getTheme(tx, staff));
    expect(after.draft.announcement?.text).toEqual({ bn: 'ঈদ অফার' });
    expect(after.published).toBeNull();
    expect(after.unpublishedChanges).toBe(true);
    await expect(run((tx) => saveThemeDraft(tx, staff, draft))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('refuses colours below WCAG AA and images from another store', async () => {
    const theme = presetTheme('general');
    const pale = {
      ...theme,
      tokens: { ...theme.tokens, colors: { ...theme.tokens.colors, text: '#dddddd' } },
    };
    await expect(run((tx) => saveThemeDraft(tx, owner, pale))).rejects.toMatchObject({
      code: 'validation_failed',
      fields: expect.arrayContaining([
        expect.objectContaining({ path: 'tokens.colors.text', code: 'contrast' }),
      ]),
    });
    const foreign = await addMedia(other);
    const withForeign = { ...theme, tokens: { ...theme.tokens, logoMediaId: foreign } };
    await expect(run((tx) => saveThemeDraft(tx, owner, withForeign))).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('keeps the logo when a preset replaces the draft, and publishes with an event', async () => {
    const logo = await addMedia();
    const current = (await run((tx) => getTheme(tx, owner))).draft;
    await run((tx) =>
      saveThemeDraft(tx, owner, { ...current, tokens: { ...current.tokens, logoMediaId: logo } }),
    );
    const grocery = await run((tx) => applyThemePreset(tx, owner, 'grocery'));
    expect(grocery.draft.preset).toBe('grocery');
    expect(grocery.draft.tokens.logoMediaId).toBe(logo);
    expect(grocery.draft.sections[0]?.type).toBe('category_grid');
    await expect(run((tx) => applyThemePreset(tx, owner, 'nope'))).rejects.toMatchObject({
      code: 'not_found',
    });

    const published = await events((tx) => publishTheme(tx, owner));
    expect(published).toContainEqual({ type: 'theme.published', payload: {} });
    const state = await run((tx) => getTheme(tx, owner));
    expect(state.published?.preset).toBe('grocery');
    expect(state.unpublishedChanges).toBe(false);

    // The theme's image is in use: the weekly cleanup leaves it alone.
    const { rows } = await run((tx) =>
      tx.db.execute<{ unused_since: string | null }>(
        sql`select unused_since from store.media where id = ${logo}`,
      ),
    );
    expect(rows[0]?.unused_since).toBeNull();
    const kept = await run((tx) =>
      tx.db.execute(sql`select 1 from store.theme_media where media_id = ${logo}`),
    );
    expect(kept.rows).toHaveLength(1);
  });
});

describe('storefront settings', () => {
  it('saves through the store profile and purges the store', async () => {
    const changed = await events((tx) =>
      updateStoreProfile(tx, owner, {
        storefront: { indexing: true, chat: { whatsapp: '01712345678', show: 'product' } },
        profile: { businessName: 'Storefront Ltd.', dbid: 'DBID-1' },
      }),
    );
    expect(changed).toContainEqual({
      type: 'tenant.updated',
      payload: { fields: ['profile', 'storefront'] },
    });
    await expect(
      run((tx) => updateStoreProfile(tx, owner, { storefront: { tracking: { ga4Id: 'bad' } } })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: [expect.objectContaining({ path: 'storefront.tracking.ga4Id' })],
    });
  });
});

describe('page queries', () => {
  let productSlug: string;
  let productId: string;

  beforeAll(async () => {
    const category = await run((tx) =>
      createCategory(tx, owner, { translations: { bn: { name: 'চা', slug: `tea-${Date.now()}` } } }),
    );
    const product = await run((tx) =>
      createProduct(tx, owner, {
        status: 'active',
        translations: {
          bn: { title: 'সিলেটি চা' },
          en: { title: 'Sylhet tea', slug: `sylhet-tea-${Date.now()}` },
        },
        variant: { price: 25_000, trackInventory: false },
        categoryIds: [category.id],
      }),
    );
    productId = product.id;
    productSlug = product.translations.bn?.slug as string;
  });

  it('builds the layout with theme, menu, footer and settings, tagged with the store', async () => {
    const layout = await run((tx) => storeLayout(tx, null));
    expect(layout.lang).toEqual({ locale: 'bn', fallback: 'bn' });
    expect(layout.tags).toEqual([storeTag(store)]);
    expect(layout.data).toMatchObject({
      locale: 'bn',
      store: { defaultLocale: 'bn', profile: { businessName: 'Storefront Ltd.' } },
      theme: { preset: 'grocery' },
      storefront: { indexing: true },
    });
    expect(layout.data.categories.map((c) => c.name)).toContain('চা');
    expect(layout.data.pages.map((p) => p.kind)).toContain('returns');
    expect(Object.keys(layout.data.images)).toHaveLength(1); // the logo
    const english = await run((tx) => storeLayout(tx, 'en'));
    expect(english.lang).toEqual({ locale: 'en', fallback: 'bn' });
  });

  it('fills the homepage sections and tags their products', async () => {
    const layout = await run((tx) => storeLayout(tx, null));
    const home = await run((tx) => homePage(tx, layout.lang, layout.data.theme));
    const grid = home.data.categoryGrids.categories1;
    expect(grid?.map((c) => c.name)).toContain('চা');
    expect(home.data.productGrids.newest1?.map((p) => p.id)).toContain(productId);
    expect(home.tags).toEqual(
      expect.arrayContaining([storeTag(store), listsTag(store), productTag(store, productId)]),
    );
  });

  it('serves product pages with their tags, and redirects nothing that exists', async () => {
    const lang = { locale: 'bn' as const, fallback: 'bn' as const };
    const page = await run((tx) => productPage(tx, lang, productSlug));
    expect(page.data && 'found' in page.data && page.data.found.product.title).toBe('সিলেটি চা');
    expect(page.tags).toEqual([storeTag(store), productTag(store, productId)]);
    expect((await run((tx) => productPage(tx, lang, 'missing-product'))).data).toBeNull();
  });

  it('searches, and shows nothing for an empty query', async () => {
    const lang = { locale: 'bn' as const, fallback: 'bn' as const };
    const empty = await run((tx) =>
      searchPage(tx, lang, parseListingQuery(new URLSearchParams(), 'search')),
    );
    expect(empty.data.listing).toBeNull();
    const found = await run((tx) =>
      searchPage(tx, lang, parseListingQuery(new URLSearchParams('q=সিলেটী চা'), 'search')),
    );
    expect(found.data.listing?.items.map((i) => i.id)).toContain(productId);
  });

  it('lists sitemap entries with every language’s slug', async () => {
    const products = await run((tx) => sitemapPart(tx, 'products'));
    const entry = products.data.find((e) => e.slugs.bn === productSlug);
    expect(entry?.slugs.en).toMatch(/^sylhet-tea-/);
    expect(products.tags).toEqual([storeTag(store), listsTag(store)]);
    const pages = await run((tx) => sitemapPart(tx, 'pages'));
    expect(pages.data.map((e) => e.slugs.bn)).toContain('রিটার্ন-নীতি');
    // Another store's sitemap never lists this store's products.
    const others = await run((tx) => sitemapPart(tx, 'products'), other);
    expect(others.data.find((e) => e.slugs.bn === productSlug)).toBeUndefined();
  });
});
