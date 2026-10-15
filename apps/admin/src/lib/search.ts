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

/** Drops the undefined entries, so the URL carries only what is set. */
export function defined<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: T[K] } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: T[K];
  };
}
