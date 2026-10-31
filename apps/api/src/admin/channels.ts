// Sales channels in the admin (phase-9-plan §3.1, §6.1): the store's Meta
// settings with its feed's URLs and last build, a rebuild on asking, and a
// new feed key. The settings themselves save through PATCH /store (`meta`).
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  capiConnection,
  listMetaEvents,
  listWhatsappTemplates,
  metaChannel,
  newVerifyToken,
  removeCredentials,
  requestFeedBuild,
  rotateFeedKey,
  saveCredentials,
  whatsappConnection,
} from '@managemind/core';
import { fakeWhatsappApi, type WhatsappApi, whatsappApi } from '@managemind/providers/meta';
import { AppError } from '@managemind/shared';
import { FEED_SKIP_REASONS, META_PURCHASE_AT } from '@managemind/shared/channels';
import type { Context } from 'hono';
import { getConfig } from '../env';
import type { FeedBuildMessage } from '../feeds';
import { credentialsKeyring } from '../notifications';
import { submitTemplates, whatsappFor } from '../whatsapp';
import { inStore, type StaffEnv } from './context';
import { storeUrls } from './store-urls';

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});

const MetaChannel = z
  .object({
    feed: z.object({
      enabled: z.boolean(),
      /** The feed's address in the store's language, and in each; null while it's off. */
      urls: z.object({ default: z.string(), bn: z.string(), en: z.string() }).nullable(),
      builtAt: z.string().nullable(),
      dirtySince: z.string().nullable(),
      rows: z.number().int(),
      skipped: z.partialRecord(z.enum(FEED_SKIP_REASONS), z.number().int()),
      lastError: z.string().nullable(),
    }),
    purchaseAt: z.enum(META_PURCHASE_AT),
    deliveredEvent: z.boolean(),
    /** The Conversions API's connection, without its token (phase-9-plan §3.1.6). */
    capi: z.object({
      connected: z.boolean(),
      pixelId: z.string().nullable(),
      testEventCode: z.string().nullable(),
      hint: z.string().nullable(),
      checkError: z.string().nullable(),
    }),
    /** The latest events sent, skipped or failed. */
    events: z.array(
      z.object({
        id: z.uuid(),
        orderId: z.uuid(),
        orderNumber: z.number().int(),
        name: z.enum(['Purchase', 'Delivered']),
        status: z.enum(['queued', 'sent', 'failed', 'skipped']),
        reason: z.string().nullable(),
        createdAt: z.string(),
        sentAt: z.string().nullable(),
      }),
    ),
  })
  .openapi('MetaChannel');

export const CHANNEL_ROUTES = {
  meta: r({
    method: 'get',
    path: '/channels/meta',
    summary: "The store's Meta settings, its feed's addresses and last build (settings.read)",
    responses: json(MetaChannel, 'Meta'),
  }),
  rebuildFeed: r({
    method: 'post',
    path: '/channels/meta/feed/rebuild',
    summary: 'Build the Meta feed now (settings.write)',
    responses: json(MetaChannel, 'Queued'),
  }),
  rotateFeedKey: r({
    method: 'post',
    path: '/channels/meta/feed/key',
    summary: "A new key for the feed's address; the old one stops working (settings.write)",
    responses: json(MetaChannel, 'Changed'),
  }),
} as const;

export function registerChannels(admin: OpenAPIHono<StaffEnv>): void {
  const R = CHANNEL_ROUTES;
  const actor = (c: Context<StaffEnv>) => c.var.staff.actor;
  const view = (c: Context<StaffEnv>) =>
    inStore(c, async (tx) => {
      const meta = await metaChannel(tx, actor(c));
      const capi = await capiConnection(tx, actor(c));
      const events = await listMetaEvents(tx, actor(c));
      const urls = await storeUrls(c, tx);
      const { key, ...feed } = meta.feed;
      const at = (file: string) => urls.link(`/feeds/${file}`, { key: key ?? '' });
      return {
        ...meta,
        capi,
        events,
        feed: {
          ...feed,
          urls:
            feed.enabled && key
              ? { default: at('meta.csv'), bn: at('meta-bn.csv'), en: at('meta-en.csv') }
              : null,
        },
      };
    });
  const build = async (c: Context<StaffEnv>) => {
    const tenantId = actor(c).tenantId as string;
    await c.env.DOMAINS?.send({ kind: 'feed_build', tenantId } satisfies FeedBuildMessage, {
      contentType: 'json',
    });
  };

  admin.openapi(R.meta, async (c) => c.json(await view(c), 200));
  admin.openapi(R.rebuildFeed, async (c) => {
    requestFeedBuild(actor(c));
    await build(c);
    return c.json(await view(c), 200);
  });
  admin.openapi(R.rotateFeedKey, async (c) => {
    await inStore(c, (tx) => rotateFeedKey(tx, actor(c)), { write: true });
    return c.json(await view(c), 200);
  });
}

// ---- WhatsApp with the store's own app (phase-9-plan §3.2.1) ---------------------------

const WhatsappTemplate = z.object({
  event: z.string(),
  locale: z.enum(['bn', 'en']),
  name: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  submittedAt: z.string().nullable(),
});
const WhatsappChannel = z
  .object({
    connected: z.boolean(),
    phoneNumberId: z.string().nullable(),
    wabaId: z.string().nullable(),
    displayPhone: z.string().nullable(),
    verifiedName: z.string().nullable(),
    qualityRating: z.string().nullable(),
    messagingLimit: z.string().nullable(),
    /** The token's last four characters. */
    hint: z.string().nullable(),
    checkError: z.string().nullable(),
    /** To paste into the store's Meta app: shown to settings.credentials only. */
    webhook: z.object({ url: z.string(), verifyToken: z.string() }).nullable(),
    templates: z.array(WhatsappTemplate),
  })
  .openapi('WhatsappChannel');
const WhatsappConnect = z
  .object({
    phoneNumberId: z
      .string()
      .trim()
      .regex(/^\d{5,20}$/),
    wabaId: z
      .string()
      .trim()
      .regex(/^\d{5,20}$/),
    accessToken: z.string().trim().min(1).max(1000),
    appSecret: z.string().trim().max(64),
  })
  .strict();

export const WHATSAPP_ROUTES = {
  whatsapp: r({
    method: 'get',
    path: '/channels/whatsapp',
    summary: "The store's WhatsApp number, its webhook and its templates (settings.read)",
    responses: json(WhatsappChannel, 'WhatsApp'),
  }),
  connectWhatsapp: r({
    method: 'put',
    path: '/channels/whatsapp',
    summary:
      "Check the number with Meta, save it sealed, and submit the store's templates (settings.credentials)",
    request: {
      body: { content: { 'application/json': { schema: WhatsappConnect } }, required: true },
    },
    responses: json(WhatsappChannel, 'Connected'),
  }),
  disconnectWhatsapp: r({
    method: 'delete',
    path: '/channels/whatsapp',
    summary: 'Forget the number and its token (settings.credentials)',
    responses: { 204: { description: 'Disconnected' } },
  }),
  submitTemplates: r({
    method: 'post',
    path: '/channels/whatsapp/templates/submit',
    summary: 'Submit templates not yet approved, and read Meta’s decisions (settings.write)',
    responses: json(WhatsappChannel, 'Submitted'),
  }),
} as const;

export function registerWhatsapp(admin: OpenAPIHono<StaffEnv>): void {
  const R = WHATSAPP_ROUTES;
  const actor = (c: Context<StaffEnv>) => c.var.staff.actor;
  const tenant = (c: Context<StaffEnv>) => actor(c).tenantId as string;
  const keyringOf = async (c: Context<StaffEnv>) => {
    const keyring = await credentialsKeyring(c.env);
    if (!keyring) {
      throw new AppError('feature_unavailable', {
        detail: 'The platform has no credentials key yet (CREDENTIALS_KEY)',
      });
    }
    return keyring;
  };
  const view = (c: Context<StaffEnv>) =>
    inStore(c, async (tx) => {
      const templates = await listWhatsappTemplates(tx, actor(c));
      const conn = await whatsappConnection(tx, actor(c));
      const own = actor(c).permissions.has('settings.credentials');
      const saved = conn && own ? await whatsappFor(c.env, tx) : null;
      const s = (k: string) => conn?.config[k] ?? null;
      return {
        connected: Boolean(conn),
        phoneNumberId: s('phoneNumberId'),
        wabaId: s('wabaId'),
        displayPhone: s('displayPhone'),
        verifiedName: s('verifiedName'),
        qualityRating: s('qualityRating'),
        messagingLimit: s('messagingLimit'),
        hint: conn?.hint ?? null,
        checkError: conn?.checkError ?? null,
        webhook: saved?.verifyToken
          ? {
              url: `https://${getConfig(c.env).ADMIN_HOST ?? 'localhost'}/v1/webhooks/whatsapp/${tenant(c)}`,
              verifyToken: saved.verifyToken,
            }
          : null,
        templates,
      };
    });

  admin.openapi(R.whatsapp, async (c) => c.json(await view(c), 200));
  admin.openapi(R.connectWhatsapp, async (c) => {
    if (!actor(c).permissions.has('settings.credentials')) throw new AppError('forbidden');
    const input = c.req.valid('json');
    const keyring = await keyringOf(c);
    const fake = input.accessToken === 'fake' && getConfig(c.env).ENVIRONMENT !== 'production';
    // The number, read with the token before anything is saved.
    let number: Awaited<ReturnType<WhatsappApi['number']>>;
    try {
      number = await (fake
        ? fakeWhatsappApi()
        : whatsappApi({ ...input, token: input.accessToken })
      ).number();
    } catch (e) {
      throw new AppError('validation_failed', {
        fields: [
          {
            path: 'accessToken',
            code: 'rejected',
            message: `Meta refused: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
          },
        ],
      });
    }
    await inStore(
      c,
      async (tx) => {
        const existing = await whatsappFor(c.env, tx);
        await saveCredentials(
          tx,
          actor(c),
          keyring,
          'whatsapp',
          {
            provider: 'whatsapp',
            secrets: {
              accessToken: input.accessToken,
              appSecret: fake && !input.appSecret ? 'f'.repeat(32) : input.appSecret,
              verifyToken: existing?.verifyToken ?? newVerifyToken(),
            },
            config: {
              phoneNumberId: input.phoneNumberId,
              wabaId: input.wabaId,
              ...Object.fromEntries(Object.entries(number).filter(([, v]) => v !== null)),
            },
          },
          async () => {},
        );
      },
      { write: true },
    );
    await submitTemplates(c.env, c.executionCtx, tenant(c));
    return c.json(await view(c), 200);
  });
  admin.openapi(R.disconnectWhatsapp, async (c) => {
    await inStore(c, (tx) => removeCredentials(tx, actor(c), 'whatsapp'), { write: true });
    return c.body(null, 204);
  });
  admin.openapi(R.submitTemplates, async (c) => {
    if (!actor(c).permissions.has('settings.write')) throw new AppError('forbidden');
    await submitTemplates(c.env, c.executionCtx, tenant(c));
    return c.json(await view(c), 200);
  });
}
