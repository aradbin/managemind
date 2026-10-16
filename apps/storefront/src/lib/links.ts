// Links between store pages, in the page's language (phase-3-plan §3.3), and
// absolute URLs on the store's primary host for canonical links, hreflang,
// Open Graph and sitemaps.
import type { ResolvedLink } from '@managemind/core';
import type { Locale } from '@managemind/shared/i18n';
import { type StoreRoute, storePath } from '@managemind/shared/storefront/urls';

export interface LinkContext {
  locale: Locale;
  defaultLocale: Locale;
  /** `https://<primary host>` in production; the request's origin on previews. */
  origin: string;
}

export const href = (ctx: LinkContext, route: StoreRoute): string =>
  storePath(route, ctx.locale, ctx.defaultLocale);

export const absolute = (ctx: LinkContext, path: string): string => `${ctx.origin}${path}`;

/** A theme link's href; null when its target isn't published. */
export function themeHref(ctx: LinkContext, link: ResolvedLink | null): string | null {
  if (!link) return null;
  if (link.kind === 'url') return link.url;
  if (link.kind === 'search')
    return `${href(ctx, { kind: 'search' })}?q=${encodeURIComponent(link.q)}`;
  return href(ctx, { kind: link.kind, slug: link.slug });
}

/** The page in each language, for hreflang: only languages with a slug. */
export function alternates(
  ctx: LinkContext,
  route: (slug: string | null) => StoreRoute | null,
  slugs: Partial<Record<Locale, string>> | null,
): { locale: Locale | 'x-default'; url: string }[] {
  const out: { locale: Locale | 'x-default'; url: string }[] = [];
  for (const locale of ['bn', 'en'] as const) {
    const r = route(slugs ? (slugs[locale] ?? slugs[ctx.defaultLocale] ?? null) : null);
    if (!r) continue;
    out.push({ locale, url: absolute(ctx, storePath(r, locale, ctx.defaultLocale)) });
  }
  const fallback = out.find((a) => a.locale === ctx.defaultLocale);
  if (fallback) out.push({ locale: 'x-default', url: fallback.url });
  return out;
}
