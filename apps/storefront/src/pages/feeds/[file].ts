// The Meta product feed on the store's own host (phase-9-plan §3.1.4):
// /feeds/meta.csv in the store's language, /feeds/meta-bn.csv and
// /feeds/meta-en.csv in either, each with the store's key. The last build's
// manifest in R2 names its chunks, which stream in order after the header;
// no database call. Not cached at the edge: each build changes it.

import { env } from 'cloudflare:workers';
import { objectKey } from '@managemind/shared';
import { type FeedManifest, feedPath, metaFeedHeader } from '@managemind/shared/channels/feed';
import type { APIRoute } from 'astro';

const FILE = /^meta(?:-(bn|en))?\.csv$/;
const notFound = () => new Response('Not found', { status: 404 });

/** Compares two strings in time that doesn't depend on where they differ. */
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const GET: APIRoute = async ({ locals, params, request, url }) => {
  const { store } = locals;
  const match = FILE.exec(params.file ?? '');
  if (!store || !match) return notFound();
  const stored = await env.FILES.get(objectKey('file', store.id, feedPath.manifest));
  if (!stored) return notFound();
  const manifest = (await stored.json()) as FeedManifest;
  if (!sameKey(url.searchParams.get('key') ?? '', manifest.key)) return notFound();
  const locale = (match[1] as 'bn' | 'en' | undefined) ?? manifest.defaultLocale;
  const count = manifest.chunks[locale] ?? 0;
  const etag = `"${manifest.build}-${locale}"`;
  const headers = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Cache-Control': 'private, no-cache',
    ETag: etag,
    'Last-Modified': new Date(manifest.builtAt).toUTCString(),
    'X-Robots-Tag': 'noindex',
  };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const pump = async () => {
    const writer = writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(metaFeedHeader()));
      for (let n = 0; n < count; n++) {
        const chunk = await env.FILES.get(
          objectKey('file', store.id, feedPath.chunk(manifest.build, locale, n)),
        );
        if (chunk) await writer.write(new Uint8Array(await chunk.arrayBuffer()));
      }
      await writer.close();
    } catch (e) {
      await writer.abort(e);
    }
  };
  void pump();
  return new Response(readable, { headers });
};
