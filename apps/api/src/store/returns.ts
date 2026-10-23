// A shopper's return request from the tracking page (phase-5a-plan §3.12,
// §6.1). Tracking by number and phone gives the token that allows it. Photos
// are uploaded first, by their SHA-256, under the store's private `returns/`
// prefix (the storefront serves only `media/`), then attached by name. The
// request itself is rate-limited per phone and, where the widget runs,
// checked by Turnstile.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createReturn,
  type ReturnPhotoInput,
  shopperActor,
  shopperOrderView,
  shopperReturnable,
} from '@managemind/core';
import { AppError, objectKey } from '@managemind/shared';
import { MEDIA_EXTENSIONS, sniffImageType } from '@managemind/shared/catalog';
import { RETURN_REASONS, shopperReturnInput, verifyOrderToken } from '@managemind/shared/orders';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { verifyTurnstile } from '../turnstile';
import { shopSiteKey } from '../turnstile-hosts';
import { inShopStore, limiterFor, shopperIp, withShopStore } from './commerce';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

const Host = z.object({ 'x-forwarded-host': z.string().min(1).max(253) });
const Token = z.object({ token: z.string().max(200) });
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const r = <const C extends Omit<Parameters<typeof createRoute>[0], 'tags'>>(config: C) =>
  createRoute({ ...config, tags: ['store'] } as C & { tags: string[] });

const Localized = z.object({ bn: z.string().optional(), en: z.string().optional() });

export const RETURN_STORE_ROUTES = {
  returnOptions: r({
    method: 'post',
    path: '/v1/store/returns/options',
    summary: 'Whether this order can still be returned, and which lines (the token from tracking)',
    request: { headers: Host, ...body(Token) },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({
              open: z.boolean(),
              until: z.string().nullable(),
              turnstileSiteKey: z.string().nullable(),
              reasons: z.array(z.enum(RETURN_REASONS)),
              lines: z.array(
                z.object({
                  orderLineId: z.uuid(),
                  title: Localized,
                  optionLabels: z.array(Localized),
                  returnable: z.number().int(),
                  excluded: z.boolean(),
                }),
              ),
            }),
          },
        },
        description: 'Options',
      },
    },
  }),
  returnPhoto: r({
    method: 'put',
    path: '/v1/store/returns/photos/{file}',
    summary: 'A photo for a return request, named by its SHA-256 (2 MB; JPEG, PNG or WebP)',
    request: {
      headers: Host.extend({ 'x-order-token': z.string().max(200) }),
      params: z.object({ file: z.string().regex(/^[0-9a-f]{64}\.(jpg|png|webp)$/) }),
    },
    responses: {
      201: {
        content: { 'application/json': { schema: z.object({ file: z.string() }) } },
        description: 'Stored',
      },
    },
  }),
  requestReturn: r({
    method: 'post',
    path: '/v1/store/returns',
    summary: 'Ask for a return (rate-limited per phone; Turnstile where the widget runs)',
    request: {
      headers: Host,
      ...body(
        shopperReturnInput.extend({
          token: z.string().max(200),
          turnstileToken: z.string().max(2048).optional(),
        }),
      ),
    },
    responses: {
      201: {
        content: {
          'application/json': {
            schema: z.object({ number: z.string(), status: z.literal('requested') }),
          },
        },
        description: 'Requested',
      },
    },
  }),
} as const;

/** The order behind a tracking token: only tracking (number and phone) opens returns. */
async function trackedOrder(c: Context<AppEnv>, tenantId: string, token: string) {
  const id = await verifyOrderToken('track', tenantId, token, c.var.config.AUTH_SECRET);
  if (!id) throw new AppError('not_found');
  return id;
}

export function registerShopperReturns(app: OpenAPIHono<AppEnv>): void {
  const R = RETURN_STORE_ROUTES;

  app.openapi(R.returnOptions, (async (c: Context<AppEnv>) => {
    const { token } = (await c.req.json()) as { token: string };
    const { out, siteKey } = await inShopStore(c, async (tx, tenantId) => {
      const id = await trackedOrder(c, tenantId, token);
      return { out: await shopperReturnable(tx, id), siteKey: await shopSiteKey(c, tx) };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        open: out.open,
        until: out.until,
        turnstileSiteKey: siteKey,
        reasons: [...RETURN_REASONS],
        lines: out.lines
          .filter((l) => l.delivered > 0)
          .map((l) => ({
            orderLineId: l.orderLineId,
            title: l.title,
            optionLabels: l.optionLabels,
            returnable: l.returnable,
            excluded: l.excluded,
          })),
      },
      200,
    );
  }) as never);

  app.openapi(R.returnPhoto, (async (c: Context<AppEnv>) => {
    const file = c.req.param('file') as string;
    if (Number(c.req.header('content-length') ?? 0) > MAX_PHOTO_BYTES) {
      throw new AppError('payload_too_large');
    }
    const tenantId = await withShopStore(c, async (run, tenantId) => {
      await limiterFor(c).check('return-photo:ip', shopperIp(c));
      const orderId = await trackedOrder(c, tenantId, c.req.header('x-order-token') ?? '');
      // Only for an order that can still be returned.
      const window = await run((tx) => shopperReturnable(tx, orderId));
      if (!window.open) throw new AppError('illegal_transition', { detail: 'Returns are closed' });
      return tenantId;
    });
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > MAX_PHOTO_BYTES) throw new AppError('payload_too_large');
    const type = sniffImageType(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16)));
    const [sha256, ext] = file.split('.') as [string, keyof typeof MIME];
    if (!type || MEDIA_EXTENSIONS[type] !== ext) throw new AppError('unsupported_media_type');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (digest !== sha256) {
      throw new AppError('validation_failed', {
        fields: [{ path: 'file', code: 'hash_mismatch', message: 'the body’s SHA-256 differs' }],
      });
    }
    await c.env.FILES.put(objectKey('file', tenantId, `returns/${file}`), bytes, {
      httpMetadata: { contentType: MIME[ext], cacheControl: 'private, no-store' },
    });
    return c.json({ file }, 201);
  }) as never);

  app.openapi(R.requestReturn, (async (c: Context<AppEnv>) => {
    const raw = (await c.req.json()) as Record<string, unknown>;
    const { token, turnstileToken, ...request } = raw as {
      token: string;
      turnstileToken?: string;
    } & Record<string, unknown>;
    const parsed = shopperReturnInput.safeParse(request);
    if (!parsed.success) throw new AppError('validation_failed');
    const host = c.req.header('x-forwarded-host') ?? '';
    const ip = shopperIp(c);
    const created = await withShopStore(c, async (run, tenantId) => {
      const orderId = await trackedOrder(c, tenantId, String(token ?? ''));
      const [view, siteKey] = await run(
        async (tx) => [await shopperOrderView(tx, orderId), await shopSiteKey(c, tx)] as const,
      );
      if (!view) throw new AppError('not_found');
      await limiterFor(c).check('return:phone', `${tenantId}:${view.contact.phone}`);
      if (siteKey) {
        await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, turnstileToken, { host, ip });
      }
      // Each photo must have been uploaded for this store.
      const photos: ReturnPhotoInput[] = [];
      for (const name of parsed.data.photos) {
        const key = objectKey('file', tenantId, `returns/${name}`);
        const head = await c.env.FILES.head(key);
        if (!head) {
          throw new AppError('validation_failed', {
            fields: [{ path: 'photos', code: 'missing', message: `${name} was not uploaded` }],
          });
        }
        const ext = name.split('.')[1] as keyof typeof MIME;
        photos.push({ objectKey: key, mimeType: MIME[ext], bytes: head.size });
      }
      return run((tx) =>
        createReturn(tx, shopperActor(), parsed.data, { by: 'shopper', orderId, photos }),
      );
    });
    c.header('Cache-Control', 'no-store');
    return c.json({ number: `R${created.number}`, status: 'requested' as const }, 201);
  }) as never);
}
