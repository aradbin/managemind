// URL search params for list screens. Hand-written rather than zod so that
// route files, which load before sign-in, keep zod out of the first bundle
// (phase-1-plan §7.3's 150 KiB budget). Anything malformed is dropped.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const searchText = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max ? value : undefined;

export const searchUuid = (value: unknown) =>
  typeof value === 'string' && UUID.test(value) ? value : undefined;

export const searchFlag = (value: unknown) => (value === true ? true : undefined);

export const searchOneOf = <T extends string>(value: unknown, allowed: readonly T[]) =>
  allowed.includes(value as T) ? (value as T) : undefined;

/**
 * A filter of one value or several, comma-separated ("paid,unpaid"): the
 * allowed ones, in order; nothing when none is.
 */
export const searchSomeOf = (value: unknown, allowed: readonly string[]) => {
  if (typeof value !== 'string' || value.length > 2000) return undefined;
  const kept = value.split(',').filter((v) => allowed.includes(v));
  return kept.length ? [...new Set(kept)].slice(0, 20).join(',') : undefined;
};

/** Ids, comma-separated, as `searchSomeOf` reads values. */
export const searchUuids = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2000) return undefined;
  const kept = value.split(',').filter((v) => UUID.test(v));
  return kept.length ? [...new Set(kept)].slice(0, 20).join(',') : undefined;
};

/** A list's page from 2 on; page 1 stays out of the address. */
export const searchPage = (value: unknown) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 1 && n <= 10_000 ? n : undefined;
};

/** Drops the undefined entries, so the URL carries only what is set. */
export function defined<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: T[K] } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: T[K];
  };
}
