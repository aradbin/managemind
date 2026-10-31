// The Meta product feed (phase-9-plan §3.1.4): one CSV row per variant, as
// Commerce Manager reads a scheduled feed. `id` is the variant's ID, the same
// ID the pixel sends, and `item_group_id` the product's, so catalog ads match
// views and purchases to items. Built in chunks of rows without a header; the
// storefront writes the header and streams the chunks in order.

/** Variants per chunk: one queue message builds one chunk within the Free plan's CPU. */
export const FEED_CHUNK = 250;

export const META_FEED_COLUMNS = [
  'id',
  'item_group_id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'sale_price',
  'link',
  'image_link',
  'additional_image_link',
  'brand',
  'color',
  'size',
  'material',
  'quantity_to_sell_on_facebook',
] as const;

export interface MetaFeedItem {
  id: string;
  itemGroupId: string;
  title: string;
  description: string;
  availability: 'in stock' | 'out of stock';
  /** Poisha: the regular price. */
  price: number;
  /** Poisha, while a sale is on. */
  salePrice: number | null;
  link: string;
  imageLink: string;
  additionalImageLinks: readonly string[];
  brand: string;
  color: string | null;
  size: string | null;
  material: string | null;
  /** Null when stock isn't counted. */
  quantity: number | null;
}

/** Why a variant is left out of the feed; the settings page counts them. */
export const FEED_SKIP_REASONS = ['no_image', 'no_price'] as const;
export type FeedSkipReason = (typeof FEED_SKIP_REASONS)[number];

/** Meta's limits: a title of 200 characters, a description of 9,999. */
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 9999;

/** One CSV cell: quoted when it holds a comma, quote or line break (RFC 4180). */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** "1200.00 BDT", as Meta reads a price. */
export const feedPrice = (poisha: number): string => `${(poisha / 100).toFixed(2)} BDT`;

const cut = (text: string, max: number) => {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
};

export const metaFeedHeader = (): string => `${META_FEED_COLUMNS.join(',')}\n`;

export function metaFeedRow(item: MetaFeedItem): string {
  const cells: Record<(typeof META_FEED_COLUMNS)[number], string | number | null> = {
    id: item.id,
    item_group_id: item.itemGroupId,
    title: cut(item.title, TITLE_MAX),
    // Meta refuses an empty description: the title stands in.
    description: cut(item.description || item.title, DESCRIPTION_MAX),
    availability: item.availability,
    condition: 'new',
    price: feedPrice(item.price),
    sale_price: item.salePrice === null ? null : feedPrice(item.salePrice),
    link: item.link,
    image_link: item.imageLink,
    additional_image_link: item.additionalImageLinks.slice(0, 10).join(','),
    brand: cut(item.brand, 100),
    color: item.color,
    size: item.size,
    material: item.material,
    quantity_to_sell_on_facebook: item.quantity === null ? null : Math.max(0, item.quantity),
  };
  return `${META_FEED_COLUMNS.map((c) => csvCell(cells[c])).join(',')}\n`;
}

/** Option names Meta has columns for, in English and Bangla, normalized to lower case. */
const OPTION_FIELDS: Record<string, 'color' | 'size' | 'material'> = {
  color: 'color',
  colour: 'color',
  রং: 'color',
  রঙ: 'color',
  কালার: 'color',
  size: 'size',
  সাইজ: 'size',
  মাপ: 'size',
  material: 'material',
  fabric: 'material',
  কাপড়: 'material',
  উপাদান: 'material',
};

/** Which feed column an option goes in, by its name; null for any other option. */
export const optionField = (name: string): 'color' | 'size' | 'material' | null =>
  OPTION_FIELDS[name.normalize('NFC').trim().toLowerCase()] ?? null;

/** What the feed's manifest in R2 says, for the storefront to serve it (§3.1.4). */
export interface FeedManifest {
  key: string;
  defaultLocale: 'bn' | 'en';
  /** The build's folder: chunks are `feeds/meta/<build>/<locale>-<n>.csv`. */
  build: string;
  chunks: Partial<Record<'bn' | 'en', number>>;
  builtAt: string;
}

/** The R2 path of a feed file, under the store's prefix. */
export const feedPath = {
  manifest: 'feeds/meta/manifest.json',
  chunk: (build: string, locale: 'bn' | 'en', n: number) =>
    `feeds/meta/${build}/${locale}-${n}.csv`,
  /** The folder of every feed file; objectKey takes it without the trailing slash. */
  folder: 'feeds/meta',
} as const;
