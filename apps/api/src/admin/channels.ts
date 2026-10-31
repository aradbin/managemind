// Sales channels in the admin (phase-9-plan §3.1, §6.1): the store's Meta
// settings with its feed's URLs and last build, a rebuild on asking, and a
// new feed key. The settings themselves save through PATCH /store (`meta`).
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { metaChannel, requestFeedBuild, rotateFeedKey } from '@managemind/core';
import { FEED_SKIP_REASONS, META_PURCHASE_AT } from '@managemind/shared/channels';
import type { Context } from 'hono';
import type { FeedBuildMessage } from '../feeds';
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
      const urls = await storeUrls(c, tx);
      const { key, ...feed } = meta.feed;
      const at = (file: string) => urls.link(`/feeds/${file}`, { key: key ?? '' });
      return {
        ...meta,
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
