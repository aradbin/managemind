// Helpers shared by the catalog services: the store's languages, validation
// errors, database errors as AppErrors, and translated rows.
import { schema } from '@managemind/db';
import { AppError, type FieldError } from '@managemind/shared';
import type { Locale } from '@managemind/shared/i18n';
import { tenantSettings } from '@managemind/shared/settings';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { TenantTx } from '../tenant';

export type { Locale };
export type Translated<T> = Partial<Record<Locale, T>>;

/** The store's default language: required on every translated row, and the fallback. */
export async function defaultLocale(tx: TenantTx): Promise<Locale> {
  return (await storeCatalogContext(tx)).defaultLocale;
}

/** What catalog writes need to know about the store: its language and VAT categories. */
export async function storeCatalogContext(
  tx: TenantTx,
): Promise<{ defaultLocale: Locale; vatCategories: string[] }> {
  const [row] = await tx.db
    .select({ locale: schema.tenants.defaultLocale, settings: schema.tenants.settings })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tx.tenantId));
  if (!row) throw new AppError('store_not_found');
  const settings = tenantSettings.parse(row.settings);
  return {
    defaultLocale: row.locale,
    vatCategories: settings.tax.categories.map((c) => c.key),
  };
}

/** Parses `input` with a shared schema, or throws validation_failed with field errors. */
export function parseInput<S extends z.ZodType>(schemaOf: S, input: unknown): z.output<S> {
  const result = schemaOf.safeParse(input);
  if (result.success) return result.data;
  throw new AppError('validation_failed', {
    fields: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    })),
  });
}

export const invalid = (path: string, message: string, code = 'invalid'): AppError =>
  new AppError('validation_failed', { fields: [{ path, code, message }] });

export const invalidFields = (fields: FieldError[]): AppError =>
  new AppError('validation_failed', { fields });

/** The Postgres error under a Drizzle error, if any. */
export function pgError(e: unknown): { code?: string; constraint?: string } {
  const err = (e as { cause?: unknown })?.cause ?? e;
  return (err ?? {}) as { code?: string; constraint?: string };
}

/**
 * Turns the catalog's unique and foreign key violations into the errors a
 * client can act on; anything else is rethrown as it is.
 */
export function mapCatalogError(e: unknown): never {
  const { code, constraint = '' } = pgError(e);
  if (code === '23505') {
    if (constraint === 'variants_sku_unique') throw new AppError('sku_taken', { cause: e });
    if (constraint.endsWith('_slug_unique')) throw new AppError('catalog_slug_taken', { cause: e });
    throw new AppError('conflict', { cause: e });
  }
  // 23503: a missing parent, or deleting one in use; 23001: deleting one under ON DELETE RESTRICT.
  if ((code === '23503' || code === '23001') && /_fk$/.test(constraint)) {
    // A reference to a row that doesn't exist in this store, or a delete of a row still in use.
    throw new AppError(
      constraint.startsWith('product_categories_category') ||
        constraint.startsWith('categories_parent') ||
        constraint.startsWith('stock_movements') ||
        constraint.startsWith('product_media_media') ||
        constraint.startsWith('variants_image')
        ? 'in_use'
        : 'not_found',
      { cause: e },
    );
  }
  throw e;
}

/** Runs `fn`, mapping catalog database errors (see mapCatalogError). */
export async function catalogWrite<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    mapCatalogError(e);
  }
}

/** Fails unless `translations` has the store's default language (phase-2-plan §3.2). */
export function requireDefault(
  translations: Translated<unknown>,
  locale: Locale,
  path = 'translations',
): void {
  if (!translations[locale]) {
    throw invalid(`${path}.${locale}`, 'the store’s default language is required', 'required');
  }
}

/** A translated value: the requested language, else the store's default. */
export function pick<T>(values: Translated<T>, locale: Locale, fallback: Locale): T | undefined {
  return values[locale] ?? values[fallback];
}
