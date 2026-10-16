// Product images (phase-2-plan §3.6, Q2, Q3). The admin resizes each photo
// in the browser to fixed widths and uploads the files through the API;
// these are the shared rules both sides check.
import { z } from 'zod';
import { CATALOG_LIMITS } from './limits';

/** Resized widths, smallest first (Q3). */
export const MEDIA_WIDTHS = [400, 800, 1200] as const;
/** Theme banners are shown full width, so they get larger files (phase-3-plan §3.4). */
export const BANNER_WIDTHS = [800, 1200, 1600] as const;
const MAX_WIDTH = BANNER_WIDTHS[BANNER_WIDTHS.length - 1] as number;
/** One resized file, as uploaded. */
export const MAX_MEDIA_FILE_BYTES = 2 * 1024 * 1024;
/** An original fetched by URL for the import's image step; it is resized in the browser. */
export const MAX_FETCH_BYTES = 15 * 1024 * 1024;

export const MEDIA_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export const MEDIA_EXTENSIONS: Record<MediaType, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** The type from the file's first bytes, never its name or a header. */
export function sniffImageType(bytes: Uint8Array): MediaType | null {
  const at = (i: number) => bytes[i] ?? -1;
  const ascii = (from: number, text: string) =>
    [...text].every((c, i) => at(from + i) === c.charCodeAt(0));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b))
    return 'image/png';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase SHA-256 in hex');

/** A stored file's name: `<sha256>.<ext>`. */
export const mediaFileName = z
  .string()
  .regex(/^[0-9a-f]{64}\.(webp|jpg|png)$/, '<sha256>.<webp|jpg|png>');

/** POST /media: an image from its uploaded files. */
export const mediaCreate = z
  .object({
    mime: z.enum(MEDIA_TYPES),
    /** The largest file's dimensions. */
    width: z.int().min(1).max(10_000),
    height: z.int().min(1).max(10_000),
    files: z
      .array(
        z.object({
          width: z.int().min(1).max(MAX_WIDTH),
          sha256: sha256Hex,
          bytes: z.int().min(1).max(MAX_MEDIA_FILE_BYTES),
        }),
      )
      .min(1)
      .max(MEDIA_WIDTHS.length)
      .refine(
        (files) => new Set(files.map((f) => f.width)).size === files.length,
        'one file per width',
      ),
    alt: z
      .object({
        bn: z.string().trim().min(1).max(250).optional(),
        en: z.string().trim().min(1).max(250).optional(),
      })
      .optional(),
  })
  .refine((m) => m.files.every((f) => f.width <= m.width), {
    message: 'files can’t be wider than the image',
    path: ['files'],
  });
export type MediaCreate = z.infer<typeof mediaCreate>;

const alt = z.string().trim().max(250);

/** PUT /products/{id}/media: the product's images in order, their alt text, and variant images. */
export const productMediaInput = z.object({
  images: z
    .array(
      z.object({
        mediaId: z.uuid(),
        /** null removes that language's alt text; left out, it stays. */
        alt: z.object({ bn: alt.nullable().optional(), en: alt.nullable().optional() }).optional(),
      }),
    )
    .max(CATALOG_LIMITS.imagesPerProduct)
    .refine((list) => new Set(list.map((i) => i.mediaId)).size === list.length, 'each image once'),
  /** A variant's own image, one of the product's images; null clears it. */
  variantImages: z
    .array(z.object({ variantId: z.uuid(), mediaId: z.uuid().nullable() }))
    .max(CATALOG_LIMITS.variantsPerProduct)
    .optional(),
});
export type ProductMediaInput = z.infer<typeof productMediaInput>;

/** POST /media/fetch: an image by URL, for the import's image step. */
export const mediaFetch = z.object({ url: z.url({ protocol: /^https?$/ }).max(2048) });
