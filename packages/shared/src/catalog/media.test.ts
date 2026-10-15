import { describe, expect, it } from 'vitest';
import { mediaCreate, mediaFetch, productMediaInput, sniffImageType } from './media';

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])),
  );

describe('sniffImageType', () => {
  it('reads the type from the first bytes', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png');
    expect(sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))).toBe('image/webp');
  });

  it('refuses anything else, whatever it claims to be', () => {
    expect(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(bytes('GIF89a'))).toBeNull();
    expect(sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('media schemas', () => {
  const sha = (c: string) => c.repeat(64);
  const image = {
    mime: 'image/webp',
    width: 1200,
    height: 900,
    files: [
      { width: 400, sha256: sha('a'), bytes: 20_000 },
      { width: 1200, sha256: sha('b'), bytes: 140_000 },
    ],
  };

  it('accepts an image with its files', () => {
    expect(mediaCreate.safeParse(image).success).toBe(true);
  });

  it('refuses oversized, repeated or impossible files and other types', () => {
    const files = (f: unknown[]) => mediaCreate.safeParse({ ...image, files: f }).success;
    expect(files([{ width: 400, sha256: sha('a'), bytes: 3 * 1024 * 1024 }])).toBe(false);
    expect(files([image.files[0], image.files[0]])).toBe(false);
    expect(files([{ width: 1600, sha256: sha('a'), bytes: 1 }])).toBe(false);
    expect(files([{ width: 400, sha256: 'A'.repeat(64), bytes: 1 }])).toBe(false);
    expect(mediaCreate.safeParse({ ...image, mime: 'image/svg+xml' }).success).toBe(false);
    expect(mediaCreate.safeParse({ ...image, width: 300 }).success).toBe(false);
  });

  it('limits product images to 10, each once', () => {
    const id = (n: number) => `0190a0b0-0000-7000-8000-${String(n).padStart(12, '0')}`;
    const images = Array.from({ length: 11 }, (_, i) => ({ mediaId: id(i) }));
    expect(productMediaInput.safeParse({ images }).success).toBe(false);
    expect(productMediaInput.safeParse({ images: images.slice(0, 10) }).success).toBe(true);
    expect(productMediaInput.safeParse({ images: [images[0], images[0]] }).success).toBe(false);
  });

  it('fetches only http(s) links', () => {
    expect(mediaFetch.safeParse({ url: 'https://img.example.test/a.jpg' }).success).toBe(true);
    for (const url of [
      'ftp://x.test/a.jpg',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:image/png;base64,AA',
    ]) {
      expect(mediaFetch.safeParse({ url }).success, url).toBe(false);
    }
  });
});
