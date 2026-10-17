// Store images on the store's own host (phase-3-plan §3.1): read from R2
// under the store's prefix, cached for a year (file names are content
// hashes, Phase 2). A file of another store is simply not found.

import { env } from 'cloudflare:workers';
import { objectKey } from '@managemind/shared';
import type { APIRoute } from 'astro';
import { CACHE_TAGS_HEADER, MEDIA_CACHE_CONTROL } from '../../lib/cache';

const FILE = /^[0-9a-f]{64}\.(webp|jpg|png)$/;
const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };

export const GET: APIRoute = async ({ locals, params }) => {
  const file = params.file ?? '';
  const { store } = locals;
  if (!store || !FILE.test(file)) return new Response('Not found', { status: 404 });
  const object = await env.FILES.get(objectKey('file', store.id, `media/${file}`));
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: {
      'Content-Type': TYPES[file.split('.')[1] ?? ''] ?? 'application/octet-stream',
      'Cache-Control': MEDIA_CACHE_CONTROL,
      ETag: object.httpEtag,
      // Cacheable, without tags: an image never changes under its name.
      [CACHE_TAGS_HEADER]: '',
    },
  });
};
