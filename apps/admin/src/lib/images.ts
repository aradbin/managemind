// Photos resized in the browser (phase-2-plan §3.6, ADR 0016): fixed widths
// of 400, 800 and 1200 px, the photo's orientation applied and its EXIF
// (GPS included) dropped, WebP where the browser can encode it and JPEG
// otherwise (iPhones: Safari silently returns PNG for WebP, Q2). Each file
// goes up through the API, named by its SHA-256, then one request
// registers the image.
import { MAX_MEDIA_FILE_BYTES, MEDIA_WIDTHS } from '@managemind/shared/catalog';
import { api, unwrap } from './api';
import type { Media } from './catalog';

/** Originals are read on the phone only; they never upload. */
export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
const QUALITY = 0.82;

export class ImageError extends Error {
  constructor(readonly reason: 'too_large' | 'unreadable' | 'upload_failed') {
    super(reason);
  }
}

export interface PreparedImage {
  mime: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  files: { width: number; blob: Blob; sha256: string }[];
}

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function encode(
  bitmap: ImageBitmap,
  width: number,
  mime: string,
  quality: number,
): Promise<Blob> {
  const height = Math.round((bitmap.height * width) / bitmap.width);
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageError('unreadable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: mime, quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('unreadable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageError('unreadable'))),
      mime,
      quality,
    ),
  );
}

/**
 * Resizes a photo (a File, or a Blob fetched by URL) into the files to
 * upload: product widths by default, BANNER_WIDTHS for theme banners.
 */
export async function prepareImage(
  source: Blob,
  sizes: readonly number[] = MEDIA_WIDTHS,
): Promise<PreparedImage> {
  if (source.size > MAX_ORIGINAL_BYTES) throw new ImageError('too_large');
  let bitmap: ImageBitmap;
  try {
    // The EXIF orientation is applied; drawing to a canvas leaves every other tag behind.
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageError('unreadable');
  }
  try {
    const widths: number[] = sizes.filter((w) => w <= bitmap.width);
    if (!widths.length) widths.push(bitmap.width);
    // Safari can't encode WebP and quietly hands back a PNG: JPEG it is, then.
    const probe = await encode(bitmap, widths[0] as number, 'image/webp', QUALITY);
    return await prepareAs(
      bitmap,
      widths,
      probe.type === 'image/webp' ? 'image/webp' : 'image/jpeg',
    );
  } finally {
    bitmap.close();
  }
}

async function prepareAs(
  bitmap: ImageBitmap,
  widths: number[],
  mime: PreparedImage['mime'],
): Promise<PreparedImage> {
  const files: PreparedImage['files'] = [];
  for (const width of widths) {
    let blob = await encode(bitmap, width, mime, QUALITY);
    if (blob.size > MAX_MEDIA_FILE_BYTES) blob = await encode(bitmap, width, mime, 0.6);
    files.push({
      width,
      blob,
      sha256: hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    });
  }
  const largest = widths[widths.length - 1] as number;
  return {
    mime,
    width: largest,
    height: Math.round((bitmap.height * largest) / bitmap.width),
    files,
  };
}

const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg' } as const;

/** Uploads the files (a file already there costs one quick check) and registers the image. */
export async function uploadImage(
  image: PreparedImage,
  alt?: { bn?: string; en?: string },
): Promise<Media> {
  for (const file of image.files) {
    const res = await fetch(`/api/admin/media/files/${file.sha256}.${EXT[image.mime]}`, {
      method: 'PUT',
      body: file.blob,
      headers: { 'content-type': image.mime },
      credentials: 'same-origin',
    });
    if (!res.ok) throw new ImageError('upload_failed');
  }
  return unwrap(
    await api.POST('/v1/admin/media', {
      body: {
        mime: image.mime,
        width: image.width,
        height: image.height,
        files: image.files.map((f) => ({ width: f.width, sha256: f.sha256, bytes: f.blob.size })),
        ...(alt && (alt.bn || alt.en) ? { alt } : {}),
      },
    }),
  );
}

/** A stored image's file name at about `width` (the smallest that is at least that wide). */
export function fileName(
  media: { mime: string; files: { width: number; sha256: string }[] },
  width = 400,
): string | null {
  const files = [...media.files].sort((a, b) => a.width - b.width);
  const file = files.find((f) => f.width >= width) ?? files[files.length - 1];
  if (!file) return null;
  const ext = media.mime === 'image/webp' ? 'webp' : media.mime === 'image/jpeg' ? 'jpg' : 'png';
  return `${file.sha256}.${ext}`;
}
