// Product images through the API Worker (phase-2-plan §3.6, ADR 0016). The
// admin resizes photos in the browser, then:
//   PUT /media/files/{sha256}.{ext}  one resized file: size, type (from its
//                                    bytes) and hash checked, stored once in R2;
//   POST /media                      the image's row from its files;
//   PUT /products/{id}/media         the product's images, alt text, variant images.
// POST /media/fetch streams an image from another site for the import's image
// step, since most hosts refuse cross-origin requests from the browser.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { getMedia, registerMedia, setProductMedia } from '@managemind/core';
import { AppError, objectKey } from '@managemind/shared';
import {
  MAX_FETCH_BYTES,
  MAX_MEDIA_FILE_BYTES,
  MEDIA_EXTENSIONS,
  mediaCreate,
  mediaFetch,
  mediaFileName,
  productMediaInput,
  sniffImageType,
} from '@managemind/shared/catalog';
import type { Context } from 'hono';
import { log } from '../log';
import { createLimiter } from '../rate-limit/index';
import { Product } from './catalog';
import { inStore, type StaffEnv } from './context';

const translated = <T extends z.ZodType>(value: T) =>
  z.object({ bn: value.optional(), en: value.optional() });
const Media = z
  .object({
    id: z.uuid(),
    sha256: z.string(),
    mime: z.enum(['image/webp', 'image/jpeg', 'image/png']),
    ext: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    files: z.array(
      z.object({ width: z.number().int(), sha256: z.string(), bytes: z.number().int() }),
    ),
    alt: translated(z.string()),
  })
  .openapi('Media');
const binary = z.string().openapi({ format: 'binary' });
const imageBody = {
  content: {
    'image/webp': { schema: binary },
    'image/jpeg': { schema: binary },
    'image/png': { schema: binary },
  },
  required: true,
};
const FileParam = z.object({ file: mediaFileName });

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['media'] } as C & {
    tags: string[];
  });

export const MEDIA_ROUTES = {
  uploadFile: r({
    method: 'put',
    path: '/media/files/{file}',
    summary: 'Upload one resized file, named <sha256>.<ext> (catalog.write; at most 2 MB)',
    request: { params: FileParam, body: imageBody },
    responses: {
      201: {
        content: {
          'application/json': {
            schema: z.object({ file: z.string(), bytes: z.number().int(), stored: z.boolean() }),
          },
        },
        description: 'Stored, or already there',
      },
    },
  }),
  file: r({
    method: 'get',
    path: '/media/files/{file}',
    summary: 'One of the store’s files, for the admin’s previews (catalog.read)',
    request: { params: FileParam },
    responses: { 200: { content: { 'image/*': { schema: binary } }, description: 'The file' } },
  }),
  createMedia: r({
    method: 'post',
    path: '/media',
    summary: 'Register an image from its uploaded files (catalog.write)',
    request: { body: { content: { 'application/json': { schema: mediaCreate } }, required: true } },
    responses: {
      201: { content: { 'application/json': { schema: Media } }, description: 'Image' },
    },
  }),
  media: r({
    method: 'get',
    path: '/media',
    summary: 'Images by ID, with their files and alt text (catalog.read)',
    request: { query: z.object({ ids: z.string().max(4000) }) },
    responses: {
      200: { content: { 'application/json': { schema: z.array(Media) } }, description: 'Images' },
    },
  }),
  fetchImage: r({
    method: 'post',
    path: '/media/fetch',
    summary: 'Fetch an image by URL for the import’s image step (catalog.write; rate-limited)',
    request: { body: { content: { 'application/json': { schema: mediaFetch } }, required: true } },
    responses: { 200: { content: { 'image/*': { schema: binary } }, description: 'The image' } },
  }),
  productMedia: r({
    method: 'put',
    path: '/products/{id}/media',
    summary: "A product's images in order, their alt text and the variants' images (catalog.write)",
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: productMediaInput } }, required: true },
    },
    responses: {
      200: { content: { 'application/json': { schema: Product } }, description: 'Product' },
    },
  }),
} as const;

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

const fileKey = (tenantId: string, file: string) => objectKey('file', tenantId, `media/${file}`);

function requirePermission(c: Context<StaffEnv>, permission: 'catalog.write' | 'catalog.read') {
  const { actor } = c.var.staff;
  if (!actor.tenantId) throw new AppError('forbidden', { detail: 'no active store' });
  if (!actor.permissions.has(permission)) throw new AppError('forbidden');
  return actor.tenantId;
}

/** Hosts an image fetch may reach: names on the public internet, default ports. */
function checkFetchUrl(url: URL): void {
  const host = url.hostname.toLowerCase();
  const bad =
    !['http:', 'https:'].includes(url.protocol) ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    host === 'localhost' ||
    /\.(localhost|local|internal|home|lan)$/.test(host) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.startsWith('[') ||
    !host.includes('.');
  if (bad) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'url', code: 'invalid', message: 'only http(s) links to public hosts' }],
    });
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Fetches an image, following at most 3 redirects (each checked again),
 * refusing anything that isn't an image or is over 15 MB, and streaming the
 * bytes through without buffering them.
 */
export async function fetchImage(input: string, fetcher: typeof fetch = fetch): Promise<Response> {
  let url = new URL(input);
  for (let hop = 0; hop <= 3; hop++) {
    checkFetchUrl(url);
    let res: Response;
    try {
      res = await fetcher(url, { redirect: 'manual', headers: { accept: 'image/*' } });
    } catch {
      throw new AppError('validation_failed', {
        fields: [{ path: 'url', code: 'unreachable', message: 'the site could not be reached' }],
      });
    }
    if (REDIRECTS.has(res.status)) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) break;
      url = new URL(location, url);
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new AppError('validation_failed', {
        fields: [{ path: 'url', code: 'not_found', message: `the site answered ${res.status}` }],
      });
    }
    const type = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!type.startsWith('image/') || type === 'image/svg+xml') {
      await res.body.cancel();
      throw new AppError('unsupported_media_type');
    }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_FETCH_BYTES) {
      await res.body.cancel();
      throw new AppError('payload_too_large');
    }
    let total = 0;
    const limited = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          if (total > MAX_FETCH_BYTES) controller.error(new AppError('payload_too_large'));
          else controller.enqueue(chunk);
        },
      }),
    );
    return new Response(limited, {
      headers: { 'content-type': type, 'cache-control': 'no-store' },
    });
  }
  throw new AppError('validation_failed', {
    fields: [{ path: 'url', code: 'too_many_redirects', message: 'more than 3 redirects' }],
  });
}

export function registerMediaRoutes(admin: OpenAPIHono<StaffEnv>): void {
  const R = MEDIA_ROUTES;

  admin.openapi(R.uploadFile, async (c) => {
    const tenantId = requirePermission(c, 'catalog.write');
    const { file } = c.req.valid('param');
    if (Number(c.req.header('content-length') ?? 0) > MAX_MEDIA_FILE_BYTES) {
      throw new AppError('payload_too_large');
    }
    // A suspended store accepts no uploads (§4.4 of the Phase 1 plan).
    await inStore(c, async () => {}, { write: true });
    const body = await c.req.arrayBuffer();
    if (body.byteLength > MAX_MEDIA_FILE_BYTES) throw new AppError('payload_too_large');
    const type = sniffImageType(new Uint8Array(body, 0, Math.min(body.byteLength, 16)));
    const [sha256, ext] = file.split('.') as [string, string];
    if (!type || MEDIA_EXTENSIONS[type] !== ext) throw new AppError('unsupported_media_type');
    if (hex(await crypto.subtle.digest('SHA-256', body)) !== sha256) {
      throw new AppError('validation_failed', {
        fields: [{ path: 'file', code: 'hash_mismatch', message: 'the body’s SHA-256 differs' }],
      });
    }
    const key = fileKey(tenantId, file);
    const stored = !(await c.env.FILES.head(key));
    if (stored) {
      await c.env.FILES.put(key, body, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
      });
    }
    return c.json({ file, bytes: body.byteLength, stored }, 201);
  });

  admin.openapi(R.file, async (c) => {
    const tenantId = requirePermission(c, 'catalog.read');
    const { file } = c.req.valid('param');
    const object = await c.env.FILES.get(fileKey(tenantId, file));
    if (!object) throw new AppError('not_found');
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        // Named by content, so it never changes; private, as it comes with a session.
        'cache-control': 'private, max-age=31536000, immutable',
        etag: object.httpEtag,
      },
    }) as never;
  });

  admin.openapi(R.createMedia, async (c) => {
    const tenantId = requirePermission(c, 'catalog.write');
    const input = c.req.valid('json');
    const media = await inStore(
      c,
      (tx) =>
        registerMedia(tx, c.var.staff.actor, input, async (file) => {
          const head = await c.env.FILES.head(fileKey(tenantId, file));
          return head ? { bytes: head.size } : null;
        }),
      { write: true },
    );
    return c.json(media, 201);
  });

  admin.openapi(R.media, async (c) => {
    const ids = c.req
      .valid('query')
      .ids.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = z.array(z.uuid()).max(100).safeParse(ids);
    if (!parsed.success) return c.json([], 200);
    return c.json(await inStore(c, (tx) => getMedia(tx, c.var.staff.actor, parsed.data)), 200);
  });

  admin.openapi(R.fetchImage, async (c) => {
    const tenantId = requirePermission(c, 'catalog.write');
    const { url } = c.req.valid('json');
    const limiter = createLimiter(c.env.RATE_LIMITER, (e) =>
      log('error', 'rate limiter unavailable', { request_id: c.var.requestId, error: String(e) }),
    );
    await limiter.check('media-fetch:tenant', tenantId);
    return (await fetchImage(url)) as never;
  });

  admin.openapi(R.productMedia, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(
      await inStore(c, (tx) => setProductMedia(tx, c.var.staff.actor, id, input), { write: true }),
      200,
    );
  });
}
