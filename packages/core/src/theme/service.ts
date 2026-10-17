// The store's theme (phase-3-plan §3.4, §6.2): a draft the editor saves, the
// presets that replace it, and publishing, which copies the draft to the
// live theme and purges the store's pages. Both live in the store's settings
// JSON. Saving refuses colour pairs below WCAG AA and images from another
// store, and keeps store.theme_media in step so the image cleanup never
// deletes an image a theme shows.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { tenantSettings } from '@managemind/shared/settings';
import {
  contrastIssues,
  defaultTheme,
  presetTheme,
  THEME_PRESETS,
  type Theme,
  type ThemePreset,
  themeMediaIds,
  themeSchema,
} from '@managemind/shared/storefront';
import { eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import { refreshUsage } from '../catalog/media';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';

export interface ThemeState {
  draft: Theme;
  /** Null until the first publish; the storefront then shows the default theme. */
  published: Theme | null;
  /** Whether the draft differs from what shoppers see. */
  unpublishedChanges: boolean;
}

async function loadSettings(tx: TenantTx, forUpdate: boolean) {
  const t = schema.tenants;
  const query = tx.db
    .select({ status: t.status, settings: t.settings })
    .from(t)
    .where(eq(t.id, tx.tenantId));
  const [row] = await (forUpdate ? query.for('update') : query);
  if (!row) throw new AppError('store_not_found');
  return { status: row.status, settings: tenantSettings.parse(row.settings) };
}

const state = (settings: ReturnType<typeof tenantSettings.parse>): ThemeState => {
  const published = settings.theme ?? null;
  const draft = settings.themeDraft ?? published ?? defaultTheme();
  return {
    draft,
    published,
    unpublishedChanges: JSON.stringify(draft) !== JSON.stringify(published ?? defaultTheme()),
  };
};

/** The draft and the published theme (`settings.read`). */
export async function getTheme(tx: TenantTx, actor: Actor): Promise<ThemeState> {
  authorize(actor, 'settings.read');
  return state((await loadSettings(tx, false)).settings);
}

/** The theme shoppers see, or the draft for a preview, from parsed settings. */
export function themeOf(
  settings: ReturnType<typeof tenantSettings.parse>,
  which: 'published' | 'draft',
): Theme {
  const s = state(settings);
  return which === 'draft' ? s.draft : (s.published ?? defaultTheme());
}

function checkContrast(theme: Theme): void {
  const issues = contrastIssues(theme.tokens.colors);
  if (!issues.length) return;
  throw new AppError('validation_failed', {
    fields: issues.map((i) => ({
      path: `tokens.colors.${i.fg === 'white' ? i.bg : i.fg}`,
      code: 'contrast',
      message: `${i.use}: contrast ${i.ratio}:1, needs at least 4.5:1`,
    })),
  });
}

async function checkMedia(tx: TenantTx, theme: Theme): Promise<void> {
  const ids = themeMediaIds(theme);
  if (!ids.length) return;
  const { rows } = await tx.db.execute<{ id: string }>(
    sql`select id from store.media where id = any(${sql.param(ids)}::uuid[])`,
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new AppError('validation_failed', {
      fields: missing.map((id) => ({
        path: 'mediaId',
        code: 'not_found',
        message: `no image ${id}`,
      })),
    });
  }
}

/** Rewrites store.theme_media for the draft and published themes; marks freed images unused. */
async function syncThemeMedia(tx: TenantTx, themes: (Theme | undefined)[]): Promise<void> {
  const ids = [...new Set(themes.flatMap((t) => (t ? themeMediaIds(t) : [])))];
  const { rows: removed } = await tx.db.execute<{ media_id: string }>(sql`
    delete from store.theme_media where not (media_id = any(${sql.param(ids)}::uuid[]))
    returning media_id`);
  if (ids.length) {
    await tx.db.execute(sql`
      insert into store.theme_media (media_id)
      select unnest(${sql.param(ids)}::uuid[]) on conflict do nothing`);
  }
  await refreshUsage(tx, [...ids, ...removed.map((r) => r.media_id)]);
}

async function writeSettings(
  tx: TenantTx,
  settings: ReturnType<typeof tenantSettings.parse>,
): Promise<void> {
  await tx.db.update(schema.tenants).set({ settings }).where(eq(schema.tenants.id, tx.tenantId));
  await syncThemeMedia(tx, [settings.theme, settings.themeDraft]);
}

async function editable(tx: TenantTx) {
  const loaded = await loadSettings(tx, true);
  if (loaded.status !== 'active') throw new AppError('tenant_suspended');
  return loaded.settings;
}

/**
 * Saves the editor's draft (`settings.write`). Shoppers don't see it until
 * it is published, so it emits nothing; the preview shows it.
 */
export async function saveThemeDraft(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<ThemeState> {
  authorize(actor, 'settings.write');
  const theme = parseInput(themeSchema, input);
  checkContrast(theme);
  await checkMedia(tx, theme);
  const settings = await editable(tx);
  await writeSettings(tx, { ...settings, themeDraft: theme });
  return state({ ...settings, themeDraft: theme });
}

/**
 * Replaces the draft with a preset's sections and tokens, keeping the
 * store's logo and favicon (they belong to the store, not the preset).
 */
export async function applyThemePreset(
  tx: TenantTx,
  actor: Actor,
  preset: string,
): Promise<ThemeState> {
  authorize(actor, 'settings.write');
  if (!THEME_PRESETS.includes(preset as ThemePreset)) throw new AppError('not_found');
  const settings = await editable(tx);
  const current = state(settings).draft;
  const fresh = presetTheme(preset as ThemePreset);
  const theme: Theme = {
    ...fresh,
    tokens: {
      ...fresh.tokens,
      logoMediaId: current.tokens.logoMediaId,
      faviconMediaId: current.tokens.faviconMediaId,
    },
  };
  await writeSettings(tx, { ...settings, themeDraft: theme });
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'theme.preset_applied',
    entityType: 'tenant',
    entityId: tx.tenantId,
    after: { preset },
  });
  return state({ ...settings, themeDraft: theme });
}

/** Publishes the draft: shoppers see it once the store's pages are purged (`settings.write`). */
export async function publishTheme(tx: TenantTx, actor: Actor): Promise<ThemeState> {
  authorize(actor, 'settings.write');
  const settings = await editable(tx);
  const { draft, published } = state(settings);
  // A draft saved under an older rule must pass today's checks too.
  checkContrast(draft);
  await checkMedia(tx, draft);
  await writeSettings(tx, { ...settings, theme: draft, themeDraft: draft });
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'theme.published',
    entityType: 'tenant',
    entityId: tx.tenantId,
    before: published ? { preset: published.preset, tokens: published.tokens } : null,
    after: {
      preset: draft.preset,
      tokens: draft.tokens,
      sections: draft.sections.map((s) => s.type),
    },
  });
  await emit(tx, 'theme.published', {
    aggregateType: 'tenant',
    aggregateId: tx.tenantId,
    payload: {},
  });
  return state({ ...settings, theme: draft, themeDraft: draft });
}
