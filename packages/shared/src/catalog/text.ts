// Normalized forms of catalog text: URL slugs, tags and the keys that let
// option labels match across products ("Red", " red " and "RED" are one key).
// Bangla stays Bangla everywhere (Q11); only cased scripts change case.
import { CATALOG_LIMITS } from './limits';

/** NFC, trimmed, inner whitespace collapsed to single spaces. */
export const cleanText = (input: string): string =>
  input.normalize('NFC').trim().replace(/\s+/gu, ' ');

/** The normalized key of an option name or value label, tag or choice label. */
export const normalizeKey = (input: string): string => cleanText(input).toLowerCase();

/** A tag as stored, or null when nothing is left or it is too long. */
export function normalizeTag(input: string): string | null {
  const tag = normalizeKey(input);
  if (!tag || [...tag].length > CATALOG_LIMITS.tagLength) return null;
  return tag;
}

/**
 * Letters (any script, with their combining marks, which Bangla needs),
 * digits and single inner hyphens. Lowercase is checked separately.
 */
const CATALOG_SLUG = /^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u;

/** Whether `slug` is a valid product, category or collection slug. */
export function isCatalogSlug(slug: string): boolean {
  return (
    CATALOG_SLUG.test(slug) &&
    slug === slug.normalize('NFC').toLowerCase() &&
    [...slug].length <= CATALOG_LIMITS.slugLength
  );
}

/**
 * A slug from a title: "লাল শাড়ি (Silk)" -> "লাল-শাড়ি-silk". Bangla is kept,
 * Latin accents are kept, anything that isn't a letter, mark or digit becomes
 * a hyphen. Returns '' when nothing usable is left; the caller then asks for
 * one or falls back to the other locale's title.
 */
export function slugify(title: string): string {
  const slug = cleanText(title)
    .toLowerCase()
    .replace(/[‌‍]/gu, '') // zero-width joiners carry no meaning in a URL
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return truncate(slug, CATALOG_LIMITS.slugLength);
}

/** The first `max` code points, never splitting a letter from its marks. */
function truncate(slug: string, max: number): string {
  const chars = [...slug];
  if (chars.length <= max) return slug;
  let end = max;
  while (end > 0 && /\p{M}/u.test(chars[end] ?? '')) end -= 1;
  return chars.slice(0, end).join('').replace(/-+$/u, '');
}

/** The next free slug: "shirt" -> "shirt-2" -> "shirt-3", within the length limit. */
export function nextSlug(slug: string, attempt: number): string {
  const suffix = `-${attempt}`;
  return `${truncate(slug, CATALOG_LIMITS.slugLength - suffix.length)}${suffix}`;
}
