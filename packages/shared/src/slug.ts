// Store slugs: the `{slug}` in `{slug}.<STORE_DOMAIN>`. The pattern matches
// the CHECK constraint on platform.tenants; the reserved list is data, so
// adding a name needs no migration (PLAN.md, domains and routing).

/** 3–32 characters: lowercase letters, digits and inner hyphens. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

/** Hosts we use ourselves, or keep for later (PLAN.md's list plus our sending and support names). */
const SYSTEM = [
  'admin',
  'api',
  'www',
  'media',
  'status',
  'mail',
  'help',
  'stores',
  'app',
  'cdn',
  'auth',
  'notify',
  'support',
  'abuse',
  'billing',
  'security',
  'login',
  'account',
  'dashboard',
  'docs',
  'blog',
  'static',
  'assets',
  'preview',
  'test',
  'demo',
];

/** Names that would look like us, a payment provider or a big marketplace. */
const BRAND_CONFUSING = [
  'managemind',
  'official',
  'bkash',
  'nagad',
  'rocket',
  'upay',
  'sslcommerz',
  'daraz',
  'facebook',
  'meta',
  'instagram',
  'whatsapp',
  'google',
  'pathao',
  'steadfast',
  'redx',
];

const RESERVED = new Set([...SYSTEM, ...BRAND_CONFUSING]);

export type SlugCheck = { ok: true; slug: string } | { ok: false; code: 'invalid' | 'reserved' };

/** Normalizes (trim, lowercase) and checks a proposed slug. */
export function checkSlug(input: string): SlugCheck {
  const slug = input.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug) || slug.includes('--')) return { ok: false, code: 'invalid' };
  if (RESERVED.has(slug)) return { ok: false, code: 'reserved' };
  return { ok: true, slug };
}

export const isReservedSlug = (slug: string): boolean => RESERVED.has(slug);
