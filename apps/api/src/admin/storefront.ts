// Online store routes under /v1/admin (phase-3-plan §6.2): the theme editor
// and static pages. Each service checks `settings.read` or `settings.write`
// (Owner and Manager write, Q10). Another store's page IDs answer 404, and
// every route with an ID is in the isolation suite.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  applyThemePreset,
  authorize,
  createPage,
  deletePage,
  getPage,
  getTheme,
  listPages,
  publishTheme,
  saveThemeDraft,
  updatePage,
} from '@managemind/core';
import {
  pageCreate,
  pagePatch,
  signPreviewToken,
  themeSchema,
} from '@managemind/shared/storefront';
import type { Context } from 'hono';
import { inStore, type StaffEnv } from './context';
import { storeUrls } from './store-urls';

const Id = z.object({ id: z.uuid() });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const created = <T extends z.ZodType>(schema: T, description: string) => ({
  201: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});

const Theme = themeSchema.meta({ id: 'Theme' });
const ThemeState = z
  .object({
    draft: Theme,
    published: Theme.nullable(),
    unpublishedChanges: z.boolean(),
  })
  .openapi('ThemeState');
const PageTranslation = z.object({
  title: z.string(),
  slug: z.string(),
  body: z.unknown().openapi({ description: 'ProseMirror JSON (the description whitelist)' }),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
});
const Page = z
  .object({
    id: z.uuid(),
    kind: z.enum(['about', 'contact', 'privacy', 'returns', 'delivery', 'terms', 'custom']),
    published: z.boolean(),
    position: z.number().int(),
    translations: z.object({ bn: PageTranslation.optional(), en: PageTranslation.optional() }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('StorePageAdmin');

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });

export const STOREFRONT_ROUTES = {
  theme: r({
    method: 'get',
    path: '/theme',
    summary: 'The draft and published theme (settings.read)',
    responses: json(ThemeState, 'Theme'),
  }),
  saveThemeDraft: r({
    method: 'put',
    path: '/theme/draft',
    summary: 'Save the theme editor’s draft (settings.write); refuses contrast below WCAG AA',
    request: body(themeSchema),
    responses: json(ThemeState, 'Saved'),
  }),
  applyThemePreset: r({
    method: 'post',
    path: '/theme/presets/{name}',
    summary: 'Replace the draft with a preset, keeping the logo and favicon (settings.write)',
    request: { params: z.object({ name: z.enum(['fashion', 'grocery', 'general']) }) },
    responses: json(ThemeState, 'The new draft'),
  }),
  publishTheme: r({
    method: 'post',
    path: '/theme/publish',
    summary: 'Publish the draft (settings.write); the store shows it within a minute',
    responses: json(ThemeState, 'Published'),
  }),
  themePreviewToken: r({
    method: 'post',
    path: '/theme/preview-token',
    summary: 'A 15-minute token and URL for the live preview (settings.read)',
    responses: json(
      z.object({ token: z.string(), expiresAt: z.string(), url: z.string() }),
      'Token',
    ),
  }),
  pages: r({
    method: 'get',
    path: '/pages',
    summary: 'Static pages (settings.read)',
    responses: json(z.array(Page), 'Pages'),
  }),
  createPage: r({
    method: 'post',
    path: '/pages',
    summary: 'Add a page (settings.write); policy pages start with suggested headings',
    request: body(pageCreate),
    responses: created(Page, 'Created'),
  }),
  page: r({
    method: 'get',
    path: '/pages/{id}',
    summary: 'A page (settings.read)',
    request: { params: Id },
    responses: json(Page, 'Page'),
  }),
  updatePage: r({
    method: 'patch',
    path: '/pages/{id}',
    summary: 'Edit a page (settings.write)',
    request: { params: Id, ...body(pagePatch) },
    responses: json(Page, 'Page'),
  }),
  deletePage: r({
    method: 'delete',
    path: '/pages/{id}',
    summary: 'Delete a page (settings.write); its address stops working',
    request: { params: Id },
    responses: { 204: { description: 'Deleted' } },
  }),
} as const;

export function registerStorefrontAdmin(admin: OpenAPIHono<StaffEnv>): void {
  const R = STOREFRONT_ROUTES;
  const actor = (c: Context<StaffEnv>) => c.var.staff.actor;
  const write = { write: true };

  admin.openapi(R.theme, async (c) =>
    c.json((await inStore(c, (tx) => getTheme(tx, actor(c)))) as never, 200),
  );
  admin.openapi(R.saveThemeDraft, async (c) => {
    const input = c.req.valid('json');
    return c.json(
      (await inStore(c, (tx) => saveThemeDraft(tx, actor(c), input), write)) as never,
      200,
    );
  });
  admin.openapi(R.applyThemePreset, async (c) => {
    const { name } = c.req.valid('param');
    return c.json(
      (await inStore(c, (tx) => applyThemePreset(tx, actor(c), name), write)) as never,
      200,
    );
  });
  admin.openapi(R.publishTheme, async (c) =>
    c.json((await inStore(c, (tx) => publishTheme(tx, actor(c)), write)) as never, 200),
  );
  admin.openapi(R.themePreviewToken, async (c) => {
    authorize(actor(c), 'settings.read');
    const tenantId = actor(c).tenantId as string;
    const urls = await inStore(c, (tx) => storeUrls(c, tx));
    const { token, expiresAt } = await signPreviewToken(tenantId, c.var.config.AUTH_SECRET);
    return c.json({ token, expiresAt, url: urls.preview(token) }, 200);
  });

  admin.openapi(R.pages, async (c) =>
    c.json((await inStore(c, (tx) => listPages(tx, actor(c)))) as never, 200),
  );
  admin.openapi(R.createPage, async (c) => {
    const input = c.req.valid('json');
    return c.json((await inStore(c, (tx) => createPage(tx, actor(c), input), write)) as never, 201);
  });
  admin.openapi(R.page, async (c) => {
    const { id } = c.req.valid('param');
    return c.json((await inStore(c, (tx) => getPage(tx, actor(c), id))) as never, 200);
  });
  admin.openapi(R.updatePage, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(
      (await inStore(c, (tx) => updatePage(tx, actor(c), id, input), write)) as never,
      200,
    );
  });
  admin.openapi(R.deletePage, async (c) => {
    const { id } = c.req.valid('param');
    await inStore(c, (tx) => deletePage(tx, actor(c), id), write);
    return c.body(null, 204);
  });
}
