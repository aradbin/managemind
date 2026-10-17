// Themes (phase-3-plan §3.4). A theme is a folder of templates in the
// storefront plus these typed settings: design tokens, the homepage's
// sections and a few settings for the fixed page templates. Stored as
// `theme` (published) and `themeDraft` in the store's settings JSON.
import { z } from 'zod';
import { richTextDoc } from '../catalog/rich-text-schema';
import { cleanText } from '../catalog/text';
import { contrastRatio, MIN_TEXT_CONTRAST } from './contrast';

export const THEME_NAMES = ['classic'] as const;
export const THEME_PRESETS = ['fashion', 'grocery', 'general'] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];
export const MAX_SECTIONS = 12;

/** `#rrggbb`, stored lowercase. */
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'a colour like #1a2b3c')
  .transform((c) => c.toLowerCase());

/** Text in each language; the storefront falls back to the store's default language. */
const localized = (max: number) =>
  z
    .object({
      bn: z.string().transform(cleanText).pipe(z.string().max(max)).optional(),
      en: z.string().transform(cleanText).pipe(z.string().max(max)).optional(),
    })
    .strict()
    .transform((v) => ({
      ...(v.bn ? { bn: v.bn } : {}),
      ...(v.en ? { en: v.en } : {}),
    }));
export type Localized = { bn?: string; en?: string };

/** Where a button or banner goes: a store page by ID (its slug can change), or a URL. */
export const themeLink = z.discriminatedUnion('type', [
  z.object({ type: z.literal('category'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('collection'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('product'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('page'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('search'), q: z.string().trim().min(1).max(100) }).strict(),
  z
    .object({
      type: z.literal('url'),
      url: z.url({ protocol: /^https$/ }).max(2048),
    })
    .strict(),
]);
export type ThemeLink = z.infer<typeof themeLink>;

const button = z.object({ label: localized(40), link: themeLink }).strict();

export const COLOR_KEYS = [
  'primary',
  'onPrimary',
  'background',
  'surface',
  'text',
  'accent',
  'sale',
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

/**
 * Colour pairs that carry text, each checked against WCAG AA (4.5:1):
 * body text on the page and on cards, button labels, links and prices on
 * the page, and the sale badge's label (white on the sale colour).
 */
export const CONTRAST_PAIRS: readonly { fg: ColorKey | 'white'; bg: ColorKey; use: string }[] = [
  { fg: 'text', bg: 'background', use: 'text on the page' },
  { fg: 'text', bg: 'surface', use: 'text on cards' },
  { fg: 'onPrimary', bg: 'primary', use: 'button labels' },
  { fg: 'primary', bg: 'background', use: 'links' },
  { fg: 'sale', bg: 'background', use: 'sale prices' },
  { fg: 'white', bg: 'sale', use: 'the sale badge' },
];

export const FONTS = ['system', 'hind-siliguri'] as const;
export const RADII = ['none', 'small', 'large'] as const;
export const IMAGE_RATIOS = ['1:1', '3:4'] as const;

export const themeTokens = z
  .object({
    colors: z
      .object({
        primary: color,
        onPrimary: color,
        background: color,
        surface: color,
        text: color,
        accent: color,
        sale: color,
      })
      .strict() satisfies z.ZodType<Record<ColorKey, string>>,
    /**
     * `system` is the phone's own font (Android ships Noto Sans Bengali), so
     * it costs no download (Q5). Hind Siliguri covers Bangla and Latin and is
     * self-hosted, loaded only when chosen.
     */
    font: z.enum(FONTS),
    radius: z.enum(RADII),
    logoMediaId: z.uuid().nullable(),
    faviconMediaId: z.uuid().nullable(),
    card: z
      .object({
        imageRatio: z.enum(IMAGE_RATIOS),
        showCompareAt: z.boolean(),
        showBrand: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type ThemeTokens = z.infer<typeof themeTokens>;

/** Short section IDs, so the editor can key and reorder sections. */
export const sectionId = z.string().regex(/^[a-z0-9]{4,16}$/);

const heroSlide = z
  .object({
    /** Null shows the primary colour behind the heading. */
    mediaId: z.uuid().nullable(),
    heading: localized(80),
    subheading: localized(160),
    button: button.nullable(),
  })
  .strict();

export const TRUST_ICONS = ['cod', 'delivery', 'returns', 'secure', 'support'] as const;

export const themeSection = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('hero'),
      id: sectionId,
      size: z.enum(['large', 'compact']),
      slides: z.array(heroSlide).min(1).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal('category_grid'),
      id: sectionId,
      heading: localized(80),
      /** Empty shows the top-level categories. */
      categoryIds: z.array(z.uuid()).max(12),
    })
    .strict(),
  z
    .object({
      type: z.literal('collection_carousel'),
      id: sectionId,
      heading: localized(80),
      /** Empty shows the published collections, newest first. */
      collectionIds: z.array(z.uuid()).max(12),
    })
    .strict(),
  z
    .object({
      type: z.literal('product_grid'),
      id: sectionId,
      heading: localized(80),
      /** Null shows the newest products. */
      collectionId: z.uuid().nullable(),
      limit: z.int().min(2).max(24),
      layout: z.enum(['grid', 'carousel']),
    })
    .strict(),
  z
    .object({
      type: z.literal('image_with_text'),
      id: sectionId,
      mediaId: z.uuid().nullable(),
      heading: localized(80),
      text: localized(600),
      button: button.nullable(),
      imagePosition: z.enum(['start', 'end']),
    })
    .strict(),
  z
    .object({
      type: z.literal('rich_text'),
      id: sectionId,
      heading: localized(80),
      body: z.object({ bn: richTextDoc.optional(), en: richTextDoc.optional() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('trust_badges'),
      id: sectionId,
      items: z
        .array(
          z
            .object({ icon: z.enum(TRUST_ICONS), title: localized(40), text: localized(120) })
            .strict(),
        )
        .min(1)
        .max(4),
    })
    .strict(),
]);
export type ThemeSection = z.infer<typeof themeSection>;
export type SectionType = ThemeSection['type'];
export const SECTION_TYPES = themeSection.options.map(
  (o) => o.shape.type.value,
) as readonly SectionType[];

export const themeSchema = z
  .object({
    /** Bumped when the shape changes; older settings are migrated in code. */
    version: z.literal(1),
    name: z.enum(THEME_NAMES),
    /** The preset the theme started from. */
    preset: z.enum(THEME_PRESETS),
    tokens: themeTokens,
    /** Shown on every page; holiday mode takes the slot during its dates (§3.8). */
    announcement: z
      .object({ text: localized(140), link: themeLink.nullable() })
      .strict()
      .nullable(),
    sections: z
      .array(themeSection)
      .max(MAX_SECTIONS)
      .refine((list) => new Set(list.map((s) => s.id)).size === list.length, 'section IDs differ'),
    /** Settings of the fixed page templates. */
    pages: z
      .object({
        product: z
          .object({ showRelated: z.boolean(), specifications: z.enum(['table', 'list']) })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type Theme = z.infer<typeof themeSchema>;

export interface ContrastIssue {
  fg: ColorKey | 'white';
  bg: ColorKey;
  use: string;
  ratio: number;
}

/** Colour pairs below WCAG AA, with their ratio rounded to two decimals. */
export function contrastIssues(colors: Record<ColorKey, string>): ContrastIssue[] {
  return CONTRAST_PAIRS.flatMap((pair) => {
    const fg = pair.fg === 'white' ? '#ffffff' : colors[pair.fg];
    const ratio = contrastRatio(fg, colors[pair.bg]);
    return ratio < MIN_TEXT_CONTRAST ? [{ ...pair, ratio: Math.round(ratio * 100) / 100 }] : [];
  });
}

/** Every media ID a theme refers to: logo, favicon and section images. */
export function themeMediaIds(theme: Theme): string[] {
  const ids = [theme.tokens.logoMediaId, theme.tokens.faviconMediaId];
  for (const s of theme.sections) {
    if (s.type === 'hero') ids.push(...s.slides.map((slide) => slide.mediaId));
    if (s.type === 'image_with_text') ids.push(s.mediaId);
  }
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

/** Every store record a theme links to, by kind, for the page API to resolve. */
export function themeLinkTargets(
  theme: Theme,
): Record<'category' | 'collection' | 'product' | 'page', string[]> {
  const out = {
    category: new Set<string>(),
    collection: new Set<string>(),
    product: new Set<string>(),
    page: new Set<string>(),
  };
  const add = (link: ThemeLink | null | undefined) => {
    if (link && link.type !== 'url' && link.type !== 'search') out[link.type].add(link.id);
  };
  add(theme.announcement?.link);
  for (const s of theme.sections) {
    if (s.type === 'hero') for (const slide of s.slides) add(slide.button?.link);
    if (s.type === 'image_with_text') add(s.button?.link);
    if (s.type === 'category_grid') for (const id of s.categoryIds) out.category.add(id);
    if (s.type === 'collection_carousel') for (const id of s.collectionIds) out.collection.add(id);
    if (s.type === 'product_grid' && s.collectionId) out.collection.add(s.collectionId);
  }
  return {
    category: [...out.category],
    collection: [...out.collection],
    product: [...out.product],
    page: [...out.page],
  };
}
