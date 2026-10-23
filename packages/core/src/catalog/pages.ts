// Static pages (phase-3-plan §3.5, §6.2): about, contact, the policies and
// custom pages. Staff with `settings.write` edit them; shoppers see only
// published ones. Slugs follow the catalog's rules: unique per language,
// renames leave redirects. A change emits catalog.page.changed, which purges
// the page, or the whole store when the footer changes (its title, slug or
// publication).
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import type { RichTextDoc } from '@managemind/shared/rich-text';
import {
  MAX_PAGES,
  type PageKind,
  pageCreate,
  pagePatch,
  suggestedPageBody,
} from '@managemind/shared/storefront';
import { and, asc, eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';
import {
  catalogWrite,
  type Locale,
  parseInput,
  requireDefault,
  storeCatalogContext,
  type Translated,
} from './common';
import { type Lang, resolveStoreSlug } from './published';
import { chooseSlug, dropRedirects, recordSlugChange } from './slugs';

const pg = schema.pages;
const pt = schema.pageTranslations;

export interface PageTranslation {
  title: string;
  slug: string;
  body: RichTextDoc | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface Page {
  id: string;
  kind: PageKind;
  published: boolean;
  position: number;
  translations: Translated<PageTranslation>;
  createdAt: string;
  updatedAt: string;
}

async function readPages(tx: TenantTx, id?: string): Promise<Page[]> {
  const pages = await tx.db
    .select()
    .from(pg)
    .where(id ? eq(pg.id, id) : undefined)
    .orderBy(asc(pg.position), asc(pg.createdAt));
  if (!pages.length) return [];
  const translations = await tx.db
    .select()
    .from(pt)
    .where(id ? eq(pt.pageId, id) : undefined);
  return pages.map((page) => ({
    id: page.id,
    kind: page.kind,
    published: page.published,
    position: page.position,
    translations: Object.fromEntries(
      translations
        .filter((t) => t.pageId === page.id)
        .map((t) => [
          t.locale,
          {
            title: t.title,
            slug: t.slug,
            body: (t.body as RichTextDoc | null) ?? null,
            seoTitle: t.seoTitle,
            seoDescription: t.seoDescription,
          },
        ]),
    ),
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  }));
}

export async function listPages(tx: TenantTx, actor: Actor): Promise<Page[]> {
  authorize(actor, 'settings.read');
  return readPages(tx);
}

export async function getPage(tx: TenantTx, actor: Actor, id: string): Promise<Page> {
  authorize(actor, 'settings.read');
  const [page] = await readPages(tx, id);
  if (!page) throw new AppError('not_found');
  return page;
}

type TranslationInput = {
  title: string;
  slug?: string | undefined;
  body?: RichTextDoc | null | undefined;
  seoTitle?: string | null | undefined;
  seoDescription?: string | null | undefined;
};

async function writeTranslations(
  tx: TenantTx,
  pageId: string,
  kind: PageKind,
  input: Partial<Record<Locale, TranslationInput | null>>,
  current: Translated<PageTranslation>,
  defaultLocale: Locale,
): Promise<boolean> {
  let navigation = false;
  for (const locale of ['bn', 'en'] as const) {
    const value = input[locale];
    if (value === undefined) continue;
    const before = current[locale];
    if (value === null) {
      if (locale === defaultLocale) {
        throw new AppError('validation_failed', {
          fields: [
            {
              path: `translations.${locale}`,
              code: 'required',
              message: 'the store’s default language is required',
            },
          ],
        });
      }
      if (before) {
        await tx.db.delete(pt).where(and(eq(pt.pageId, pageId), eq(pt.locale, locale)));
        navigation = true;
      }
      continue;
    }
    const slug = await chooseSlug(tx, 'page', {
      locale,
      entityId: pageId,
      requested: value.slug,
      current: before?.slug,
      title: value.title,
      fallbackTitle: input[locale === 'bn' ? 'en' : 'bn']?.title,
    });
    const row = {
      title: value.title,
      slug,
      body:
        value.body !== undefined
          ? value.body
          : before
            ? before.body
            : suggestedPageBody(kind, locale),
      seoTitle: value.seoTitle !== undefined ? value.seoTitle : (before?.seoTitle ?? null),
      seoDescription:
        value.seoDescription !== undefined
          ? value.seoDescription
          : (before?.seoDescription ?? null),
    };
    await catalogWrite(() =>
      tx.db
        .insert(pt)
        .values({ pageId, locale, ...row })
        .onConflictDoUpdate({ target: [pt.tenantId, pt.pageId, pt.locale], set: row }),
    );
    if (before?.slug !== slug)
      await recordSlugChange(tx, 'page', {
        locale,
        entityId: pageId,
        from: before?.slug,
        to: slug,
      });
    if (!before || before.title !== row.title || before.slug !== slug) navigation = true;
  }
  return navigation;
}

/** Creates a page; policy pages start with suggested headings (Q12). At most 30 pages. */
export async function createPage(tx: TenantTx, actor: Actor, input: unknown): Promise<Page> {
  authorize(actor, 'settings.write');
  const data = parseInput(pageCreate, input);
  const { defaultLocale } = await storeCatalogContext(tx);
  requireDefault(data.translations, defaultLocale);
  // The store filter as well as RLS: the CLI and preview seeding run as the
  // migration role, which bypasses RLS on Neon.
  const [count] = await tx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(pg)
    .where(eq(pg.tenantId, tx.tenantId));
  if ((count?.n ?? 0) >= MAX_PAGES) throw new AppError('limit_exceeded');

  const [row] = await catalogWrite(() =>
    tx.db
      .insert(pg)
      .values({
        kind: data.kind,
        published: data.published,
        position: data.position ?? count?.n ?? 0,
      })
      .returning({ id: pg.id }),
  );
  const id = row?.id as string;
  await writeTranslations(tx, id, data.kind, data.translations, {}, defaultLocale);
  const page = await getPage(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'page.created',
    entityType: 'page',
    entityId: id,
    after: { kind: page.kind, published: page.published, translations: page.translations },
  });
  await emit(tx, 'catalog.page.changed', {
    aggregateType: 'page',
    aggregateId: id,
    payload: { change: 'created', navigation: page.published },
  });
  return page;
}

export async function updatePage(
  tx: TenantTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Page> {
  authorize(actor, 'settings.write');
  const data = parseInput(pagePatch, input);
  const [locked] = await tx.db.select({ id: pg.id }).from(pg).where(eq(pg.id, id)).for('update');
  if (!locked) throw new AppError('not_found');
  const before = await getPage(tx, actor, id);
  const { defaultLocale } = await storeCatalogContext(tx);

  let navigation = false;
  if (data.translations) {
    navigation = await writeTranslations(
      tx,
      id,
      before.kind,
      data.translations,
      before.translations,
      defaultLocale,
    );
  }
  const set: Partial<typeof pg.$inferInsert> = {};
  if (data.published !== undefined && data.published !== before.published) {
    set.published = data.published;
    navigation = true;
  }
  if (data.position !== undefined && data.position !== before.position) {
    set.position = data.position;
    navigation = true;
  }
  await tx.db
    .update(pg)
    .set({ ...set, updatedAt: sql`now()` })
    .where(eq(pg.id, id));
  const after = await getPage(tx, actor, id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'page.updated',
    entityType: 'page',
    entityId: id,
    before: {
      published: before.published,
      position: before.position,
      translations: before.translations,
    },
    after: {
      published: after.published,
      position: after.position,
      translations: after.translations,
    },
  });
  // A draft page's edits change nothing shoppers see, except when it is unpublished now.
  if (before.published || after.published) {
    await emit(tx, 'catalog.page.changed', {
      aggregateType: 'page',
      aggregateId: id,
      payload: { change: 'updated', navigation },
    });
  }
  return after;
}

export async function deletePage(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'settings.write');
  const before = await getPage(tx, actor, id);
  await tx.db.delete(pg).where(eq(pg.id, id));
  await dropRedirects(tx, 'page', id);
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'page.deleted',
    entityType: 'page',
    entityId: id,
    before: { kind: before.kind, translations: before.translations },
  });
  if (before.published) {
    await emit(tx, 'catalog.page.changed', {
      aggregateType: 'page',
      aggregateId: id,
      payload: { change: 'deleted', navigation: true },
    });
  }
}

// ---- Shopper reads -------------------------------------------------------------------

export type StorePageLink = {
  id: string;
  kind: PageKind;
  slug: string;
  title: string;
};

export type StorePage = StorePageLink & {
  slugs: Partial<Record<Locale, string>>;
  body: RichTextDoc | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
};

/** Published pages in footer order, in the shopper's language (else the default's). */
export async function storePageLinks(tx: TenantTx, lang: Lang): Promise<StorePageLink[]> {
  const { rows } = await tx.db.execute<StorePageLink>(sql`
    select pg.id, pg.kind, coalesce(tl.slug, td.slug) as slug, coalesce(tl.title, td.title) as title
      from store.pages pg
      left join store.page_translations tl on tl.page_id = pg.id and tl.locale = ${lang.locale}
      left join store.page_translations td on td.page_id = pg.id and td.locale = ${lang.fallback}
     where pg.published and coalesce(tl.slug, td.slug) is not null
     order by pg.position, pg.created_at`);
  return rows;
}

/** A published page by slug, or a redirect for an old slug. */
export async function publishedPageBySlug(
  tx: TenantTx,
  lang: Lang,
  slug: string,
): Promise<{ found: StorePage } | { redirect: string } | null> {
  const isPublished = async (id: string) => {
    const [row] = await tx.db
      .select({ id: pg.id })
      .from(pg)
      .where(and(eq(pg.id, id), eq(pg.published, true)));
    return Boolean(row);
  };
  const hit = await resolveStoreSlug(tx, 'page', lang, slug, isPublished);
  if (!hit || 'redirect' in hit) return hit;
  const [page] = await readPages(tx, hit.found);
  if (!page) return null;
  const t = page.translations[lang.locale] ?? page.translations[lang.fallback];
  if (!t) return null;
  return {
    found: {
      id: page.id,
      kind: page.kind,
      slug: t.slug,
      title: t.title,
      slugs: Object.fromEntries(Object.entries(page.translations).map(([l, v]) => [l, v?.slug])),
      body: t.body,
      seoTitle: t.seoTitle,
      seoDescription: t.seoDescription,
      updatedAt: page.updatedAt,
    },
  };
}
