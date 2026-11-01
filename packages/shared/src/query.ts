// Query parameters shared by the API's list endpoints.
import { z } from 'zod';

/**
 * A list filter that takes one value or several, comma-separated
 * ("paid,partially_paid"), or as a list once parsed: records match any of
 * them. One value still works as before. At most 20 values.
 */
export function oneOrMany<T extends z.ZodType<string, string>>(item: T) {
  const list = z.array(item).min(1).max(20);
  return z
    .union([
      list,
      z
        .string()
        .max(2000)
        .transform((v) =>
          v
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        )
        .pipe(list),
    ])
    .optional();
}

/** A filter's one value or several, as a list (empty when unset). */
export const asList = <T extends string>(value: T | readonly T[] | undefined): T[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : [...value];
