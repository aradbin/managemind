// What a product card shows (design/storefront-redesign: ProductCard), worked
// out once for the card component and for the copy a product page keeps for
// Recently viewed (scripts/recent.ts), so both cards read the same.
import type { CardOption, ProductCard } from '@managemind/core';
import { normalizeKey } from '@managemind/shared/catalog';
import { price, priceRange } from './format';
import { href } from './links';
import type { PageContext } from './page';
import { swatch } from './swatches';

export interface CardView {
  id: string;
  href: string;
  title: string;
  brand: string | null;
  /** The smallest photo file at least 400 px wide, and every file for srcset. */
  image: { src: string; srcset: string; width: number; height: number } | null;
  /** "−17%", or null. */
  off: string | null;
  soldOut: boolean;
  options: string;
  dots: string[];
  price: string | null;
  sale: boolean;
  compare: string | null;
  /** add: Add to cart here; choose: a link to the product page; null: sold out. */
  action: 'add' | 'choose' | null;
  variantId: string | null;
  /** Poisha, for the ad tags' add-to-cart event. */
  amount: number;
}

const SIZE = new Set(['size', 'সাইজ', 'মাপ']);
const COLOUR = new Set(['colour', 'color', 'রং', 'রঙ']);
const is = (o: CardOption, names: Set<string>) => o.keys.some((k) => names.has(k));

export function cardView(ctx: PageContext, product: ProductCard): CardView {
  const { t, d } = ctx;
  const tokens = ctx.theme.tokens.card;
  const { priceMin, priceMax, compareAt } = product;
  const sale =
    tokens.showCompareAt && compareAt !== null && priceMin !== null && compareAt > priceMin;
  const percent =
    sale && compareAt && priceMin !== null
      ? Math.round(((compareAt - priceMin) / compareAt) * 100)
      : 0;
  const ranged = priceMax !== null && priceMin !== null && priceMax !== priceMin;
  const many = (product.options ?? []).filter((o) => o.values.length > 1);
  const colour = many.find((o) => is(o, COLOUR));
  const image = product.image;
  const file = image?.files.find((f) => f.width >= 400) ?? image?.files.at(-1);
  return {
    id: product.id,
    href: href(ctx.link, { kind: 'product', slug: product.slug }),
    title: product.title,
    brand: tokens.showBrand ? product.brand : null,
    image:
      image && file
        ? {
            src: `/media/${file.file}`,
            srcset: image.files.map((f) => `/media/${f.file} ${f.width}w`).join(', '),
            width: image.width,
            height: image.height,
          }
        : null,
    off: product.available && percent > 0 ? t('card.off', { percent }) : null,
    soldOut: !product.available,
    options: many
      .map((o) =>
        t(is(o, SIZE) ? 'card.sizes' : is(o, COLOUR) ? 'card.colours' : 'card.options', {
          count: o.values.length,
        }),
      )
      .join(' · '),
    dots: (colour?.values ?? [])
      .map(swatch)
      .filter((c): c is string => c !== null)
      .slice(0, 4),
    price:
      priceMin === null
        ? null
        : ranged
          ? t('product.from', { price: price(priceMin, d) })
          : priceRange(priceMin, priceMax, d),
    sale,
    compare: sale && compareAt !== null ? price(compareAt, d) : null,
    action: !product.available ? null : product.variantId ? 'add' : 'choose',
    variantId: product.variantId,
    amount: priceMin ?? 0,
  };
}

/** A product page's product as a card, for Recently viewed. */
export function productAsCard(product: {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  options: { name: string; values: { label: string }[] }[];
  variants: { id: string; price: number; compareAtPrice: number | null; available: boolean }[];
  media: ProductCard['image'][];
}): ProductCard {
  const prices = product.variants.map((v) => v.price);
  const cheapest = [...product.variants].sort((a, b) => a.price - b.price)[0];
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    compareAt: cheapest?.compareAtPrice ?? null,
    available: product.variants.some((v) => v.available),
    brand: product.brand,
    image: product.media[0] ?? null,
    variantId: product.variants.length === 1 ? (product.variants[0]?.id ?? null) : null,
    options: product.options.map((o) => ({
      name: o.name,
      keys: [normalizeKey(o.name)],
      values: o.values.map((v) => normalizeKey(v.label)),
    })),
  };
}
