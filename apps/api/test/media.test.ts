// Product images through the API (phase-2-plan §3.6, §8, ADR 0016): uploads
// checked for size, type and hash; images registered from their files;
// product images; the URL fetch's rules; the weekly cleanup.
import { createTenant, systemActor } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { objectKey } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchImage } from '../src/admin/media';
import { cleanUpMedia } from '../src/jobs';
import { type Browser, browser, signIn } from './staff';
import { appUrl, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const env = makeEnv();
let owner: pg.Client;
let app: pg.Client;
let tenantId: string;
let user: Browser;
beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  const slug = `m${Date.now().toString(36)}`;
  const email = `${slug}@example.test`;
  tenantId = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Media API',
      defaultLocale: 'en',
      owner: { email, name: 'Owner' },
    })
  ).id;
  user = browser(env);
  expect((await signIn(user, owner, email)).status).toBe(200);
  expect((await user.call('PUT', '/api/admin/me/active-store', { tenantId })).status).toBe(200);
});
afterAll(() => Promise.all([owner.end(), app.end()]));

let seq = 0;
/** A fake PNG: the right signature, then unique bytes. */
function png(size = 1000): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set(new TextEncoder().encode(`file ${Date.now()} ${seq++}`), 8);
  return bytes;
}
async function sha(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const upload = (file: string, bytes: Uint8Array, type = 'image/png') =>
  user.call('PUT', `/api/admin/media/files/${file}`, bytes, { 'content-type': type });
const json = async (res: Response) => (await res.json()) as Json;

async function uploadImage() {
  const small = png(500);
  const large = png(2000);
  for (const bytes of [small, large]) {
    expect((await upload(`${await sha(bytes)}.png`, bytes)).status).toBe(201);
  }
  const res = await user.post('/api/admin/media', {
    mime: 'image/png',
    width: 800,
    height: 600,
    files: [
      { width: 400, sha256: await sha(small), bytes: small.byteLength },
      { width: 800, sha256: await sha(large), bytes: large.byteLength },
    ],
    alt: { en: 'A shirt' },
  });
  expect(res.status).toBe(201);
  return { media: await json(res), small, large };
}

describe('uploads', () => {
  it('stores a checked file once, under the store’s prefix', async () => {
    const bytes = png();
    const file = `${await sha(bytes)}.png`;
    const first = await upload(file, bytes);
    expect(first.status).toBe(201);
    expect(await json(first)).toEqual({ file, bytes: bytes.byteLength, stored: true });
    expect(env.FILES.objects.has(objectKey('file', tenantId, `media/${file}`))).toBe(true);
    expect(await json(await upload(file, bytes))).toMatchObject({ stored: false });
    const served = await user.get(`/api/admin/media/files/${file}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
  });

  it('refuses a wrong hash, a type its bytes don’t match, and oversized files', async () => {
    const bytes = png();
    expect((await upload(`${'0'.repeat(64)}.png`, bytes)).status).toBe(422);
    expect((await upload(`${await sha(bytes)}.webp`, bytes, 'image/webp')).status).toBe(415);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await upload(`${await sha(svg)}.png`, svg)).status).toBe(415);
    const big = png(2 * 1024 * 1024 + 1);
    expect((await upload(`${await sha(big)}.png`, big)).status).toBe(413);
    // Only image types, and only on the upload path, may skip JSON.
    expect(
      (
        await user.call('PUT', `/api/admin/media/files/${await sha(bytes)}.png`, bytes, {
          'content-type': 'text/plain',
        })
      ).status,
    ).toBe(403);
  });
});

describe('images and products', () => {
  it('registers an image from its files, once per largest file', async () => {
    const { media, large } = await uploadImage();
    expect(media).toMatchObject({
      mime: 'image/png',
      ext: 'png',
      sha256: await sha(large),
      alt: { en: 'A shirt' },
    });
    expect(media.files.map((f: Json) => f.width)).toEqual([400, 800]);
    const missing = await user.post('/api/admin/media', {
      mime: 'image/png',
      width: 400,
      height: 300,
      files: [{ width: 400, sha256: 'f'.repeat(64), bytes: 10 }],
    });
    expect(missing.status).toBe(422);
  });

  it('sets a product’s images and a variant’s image', async () => {
    const product = await json(
      await user.post('/api/admin/products', {
        translations: { en: { title: `Pictured ${seq++}` } },
      }),
    );
    const { media: a } = await uploadImage();
    const { media: b } = await uploadImage();
    const variantId = product.variants[0].id;
    const res = await user.call('PUT', `/api/admin/products/${product.id}/media`, {
      images: [{ mediaId: b.id, alt: { en: 'Back' } }, { mediaId: a.id }],
      variantImages: [{ variantId, mediaId: a.id }],
    });
    expect(res.status).toBe(200);
    const updated = await json(res);
    expect(updated.media.map((m: Json) => [m.mediaId, m.position, m.alt.en])).toEqual([
      [b.id, 0, 'Back'],
      [a.id, 1, 'A shirt'],
    ]);
    expect(updated.variants[0].imageMediaId).toBe(a.id);
    // Removing an image clears it from the variant, and it becomes unused.
    const removed = await json(
      await user.call('PUT', `/api/admin/products/${product.id}/media`, {
        images: [{ mediaId: b.id }],
      }),
    );
    expect(removed.variants[0].imageMediaId).toBeNull();
    const { rows } = await owner.query(
      `select unused_since is not null as unused from store.media where id = $1`,
      [a.id],
    );
    expect(rows[0]).toEqual({ unused: true });
    const listed = await json(await user.get(`/api/admin/media?ids=${a.id},${b.id}`));
    expect(listed).toHaveLength(2);
  });

  it('removes images unused for 7 days, and their files', async () => {
    const { media, small, large } = await uploadImage();
    await owner.query(
      `update store.media set unused_since = now() - interval '8 days' where id = $1`,
      [media.id],
    );
    const result = await cleanUpMedia(env, owner);
    expect(result.files).toBeGreaterThanOrEqual(2);
    for (const bytes of [small, large]) {
      expect(
        env.FILES.objects.has(objectKey('file', tenantId, `media/${await sha(bytes)}.png`)),
      ).toBe(false);
    }
    const { rowCount } = await owner.query('select 1 from store.media where id = $1', [media.id]);
    expect(rowCount).toBe(0);
  });
});

describe('fetching images by URL', () => {
  const image = (headers: Record<string, string> = {}) =>
    new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/jpeg', ...headers },
    });

  it('streams an image and follows up to 3 redirects', async () => {
    const hops = vi.fn<typeof fetch>(async (url) => {
      const n = Number(new URL(String(url)).searchParams.get('n') ?? 0);
      return n < 3
        ? new Response(null, {
            status: 302,
            headers: { location: `https://img.example.test/a.jpg?n=${n + 1}` },
          })
        : image();
    });
    const res = await fetchImage('https://img.example.test/a.jpg', hops);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(hops).toHaveBeenCalledTimes(4);
  });

  it('refuses a 4th redirect, other schemes, ports, IPs, non-images and oversized bodies', async () => {
    const loop = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 302, headers: { location: '/again' } }),
    );
    await expect(fetchImage('https://img.example.test/a.jpg', loop)).rejects.toMatchObject({
      code: 'validation_failed',
    });
    for (const url of [
      'https://img.example.test:8443/a.jpg',
      'http://127.0.0.1/a.jpg',
      'http://[::1]/a.jpg',
      'http://localhost/a.jpg',
      'http://metadata.internal/a.jpg',
    ]) {
      await expect(fetchImage(url, vi.fn()), url).rejects.toMatchObject({
        code: 'validation_failed',
      });
    }
    // A redirect into a private address is checked too.
    const sneaky = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 301, headers: { location: 'http://10.0.0.1/x' } }),
    );
    await expect(fetchImage('https://img.example.test/a.jpg', sneaky)).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const html = vi.fn<typeof fetch>(
      async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    );
    await expect(fetchImage('https://img.example.test/a.jpg', html)).rejects.toMatchObject({
      code: 'unsupported_media_type',
    });
    const svg = vi.fn<typeof fetch>(async () => image({ 'content-type': 'image/svg+xml' }));
    await expect(fetchImage('https://img.example.test/a.svg', svg)).rejects.toMatchObject({
      code: 'unsupported_media_type',
    });
    const huge = vi.fn<typeof fetch>(async () =>
      image({ 'content-length': String(16 * 1024 * 1024) }),
    );
    await expect(fetchImage('https://img.example.test/a.jpg', huge)).rejects.toMatchObject({
      code: 'payload_too_large',
    });
  });

  it('is an admin route for catalog writers', async () => {
    const res = await user.post('/api/admin/media/fetch', { url: 'ftp://img.example.test/a.jpg' });
    expect(res.status).toBe(422);
  });
});
