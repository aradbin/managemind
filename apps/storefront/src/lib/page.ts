// What every template gets: the layout from the API, the page's language,
// translations, digits, links, and the request (phase-3-plan §3.4). Built
// once per page in pages/[...path].astro.
import type { ResolvedLink, StoreImage, StoreLayout } from '@managemind/core';
import type { Locale } from '@managemind/shared/i18n';
import type { Theme, ThemeLink } from '@managemind/shared/storefront';
import { translator } from '../i18n';
import { type Display, displayFor } from './format';
import { type LinkContext, themeHref } from './links';
import { type Localized, pick } from './text';

export interface PageContext {
  layout: StoreLayout;
  theme: Theme;
  locale: Locale;
  defaultLocale: Locale;
  t: ReturnType<typeof translator>;
  d: Display;
  link: LinkContext;
  url: URL;
  preview: boolean;
  /** The text in the page's language, else the store's default. */
  text: (value: Localized | null | undefined) => string;
  /** A theme image by media ID. */
  image: (mediaId: string | null | undefined) => StoreImage | null;
  /** A theme link's href, or null when its target isn't published. */
  themeLink: (link: ThemeLink | null | undefined) => string | null;
}

function resolve(link: ThemeLink | null | undefined, layout: StoreLayout): ResolvedLink | null {
  if (!link) return null;
  if (link.type === 'url') return { kind: 'url', url: link.url };
  if (link.type === 'search') return { kind: 'search', q: link.q };
  const slug = layout.links[link.type][link.id];
  return slug ? { kind: link.type, slug } : null;
}

export function pageContext(input: {
  layout: StoreLayout;
  url: URL;
  origin: string;
  preview: boolean;
}): PageContext {
  const { layout } = input;
  const locale = layout.locale;
  const defaultLocale = layout.store.defaultLocale;
  const link: LinkContext = { locale, defaultLocale, origin: input.origin };
  return {
    layout,
    theme: layout.theme,
    locale,
    defaultLocale,
    t: translator(locale, layout.numerals ?? undefined),
    d: displayFor(locale, layout.numerals),
    link,
    url: input.url,
    preview: input.preview,
    text: (value) => pick(value, locale, defaultLocale),
    image: (id) => (id ? (layout.images[id] ?? null) : null),
    themeLink: (l) => themeHref(link, resolve(l, layout)),
  };
}

/** srcset for an image's files (smallest first). */
export const srcset = (image: StoreImage): string =>
  image.files.map((f) => `/media/${f.file} ${f.width}w`).join(', ');

/** The smallest file at least `width` wide, else the largest. */
export const fileFor = (image: StoreImage, width: number): string => {
  const file = image.files.find((f) => f.width >= width) ?? image.files[image.files.length - 1];
  return file ? `/media/${file.file}` : '';
};
