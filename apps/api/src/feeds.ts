// The Meta product feed's builds (phase-9-plan §3.1.4, §7). A catalog or
// stock change marks the feed stale and queues one build 15 minutes later on
// the delayed queue. A build is a chain of messages, one chunk of variants
// each, so no invocation renders the whole catalog on the Free plan's CPU.
// Each build writes its own folder in R2; its manifest, written last, is
// what the storefront serves, and older folders are deleted after it.
import {
  FEED_DELAY_SECONDS,
  FEED_EVENTS,
  failFeedBuild,
  feedChunk,
  finishFeedBuild,
  markFeedDirty,
  type OutboxEvent,
  startFeedBuild,
  withTenant,
} from '@managemind/core';
import { objectKey } from '@managemind/shared';
import {
  type FeedManifest,
  type FeedSkipReason,
  feedPath,
  metaFeedRow,
} from '@managemind/shared/channels';
import type { Locale } from '@managemind/shared/money';
import { storeUrlsFor } from './admin/store-urls';
import { withClient } from './db';
import { type Env, getConfig } from './env';
import { log } from './log';

/** One step of a build: the first has only the store; the rest carry where they are. */
export interface FeedBuildMessage {
  kind: 'feed_build';
  tenantId: string;
  build?: {
    id: string;
    startedAt: string;
    key: string;
    defaultLocale: Locale;
    locales: Locale[];
    /** Index into `locales`. */
    locale: number;
    after: string | null;
    chunk: number;
    chunks: Partial<Record<Locale, number>>;
    rows: number;
    skipped: Partial<Record<FeedSkipReason, number>>;
  };
}

/** Did the store's Meta settings change: the feed turned on or off, or its key? */
const metaChanged = (e: OutboxEvent) =>
  e.eventType === 'tenant.updated' &&
  ((e.payload as { fields?: string[] }).fields ?? []).includes('meta');

/**
 * The outbox's part: a store whose catalog changed gets its feed marked stale
 * and, when it was current, one build later. A change to the store's Meta
 * settings builds (or removes) the feed at once.
 */
export async function queueFeedBuilds(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  events: readonly OutboxEvent[],
): Promise<void> {
  if (!env.DOMAINS) return;
  const now = new Set(events.filter(metaChanged).map((e) => e.tenantId));
  const later = new Set(
    events
      .filter((e) => FEED_EVENTS.has(e.eventType as never) && !now.has(e.tenantId))
      .map((e) => e.tenantId),
  );
  if (!now.size && !later.size) return;
  const due: { tenantId: string; delaySeconds: number }[] = [...now].map((tenantId) => ({
    tenantId,
    delaySeconds: 0,
  }));
  if (later.size) {
    await withClient(env, ctx, async (client) => {
      for (const tenantId of later) {
        if (await withTenant(client, tenantId, markFeedDirty)) {
          due.push({ tenantId, delaySeconds: FEED_DELAY_SECONDS });
        }
      }
    });
  }
  if (!due.length) return;
  await env.DOMAINS.sendBatch(
    due.map(({ tenantId, delaySeconds }) => ({
      body: { kind: 'feed_build', tenantId } satisfies FeedBuildMessage,
      contentType: 'json' as const,
      delaySeconds,
    })),
  );
}

const add = (
  a: Partial<Record<FeedSkipReason, number>>,
  b: Partial<Record<FeedSkipReason, number>>,
) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b) as [FeedSkipReason, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
};

/** Deletes every feed file of the store except the given build's (and the manifest). */
async function removeFeedFiles(env: Env, tenantId: string, keep: string | null) {
  const prefix = `${objectKey('file', tenantId, feedPath.folder)}/`;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, ...(cursor ? { cursor } : {}) });
    const doomed = page.objects
      .map((o) => o.key)
      .filter((k) => !keep || !k.startsWith(`${prefix}${keep}/`))
      .filter((k) => keep === null || !k.endsWith('manifest.json'));
    if (doomed.length) await env.FILES.delete(doomed);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** One step of each build in the batch. */
export async function handleFeedBuilds(
  messages: readonly Message<FeedBuildMessage>[],
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  const config = getConfig(env);
  await withClient(env, ctx, async (client) => {
    for (const m of messages) {
      const { tenantId } = m.body;
      try {
        const next = await withTenant(client, tenantId, async (tx) => {
          let b = m.body.build;
          if (!b) {
            const start = await startFeedBuild(tx);
            if (!start.enabled || !start.key) return { off: true as const };
            b = {
              id: crypto.randomUUID(),
              startedAt: start.startedAt,
              key: start.key,
              defaultLocale: start.defaultLocale,
              locales: start.locales,
              locale: 0,
              after: null,
              chunk: 0,
              chunks: {},
              rows: 0,
              skipped: {},
            };
          }
          const locale = b.locales[b.locale] as Locale;
          const urls = await storeUrlsFor(config, tx);
          const chunk = await feedChunk(tx, {
            locale,
            defaultLocale: b.defaultLocale,
            after: b.after,
            link: urls.link,
          });
          await env.FILES.put(
            objectKey('file', tenantId, feedPath.chunk(b.id, locale, b.chunk)),
            chunk.items.map(metaFeedRow).join(''),
            { httpMetadata: { contentType: 'text/csv; charset=utf-8' } },
          );
          const done = {
            ...b,
            chunks: { ...b.chunks, [locale]: b.chunk + 1 },
            // Rows and skips are counted once, in the store's own language.
            rows: b.locale === 0 ? b.rows + chunk.items.length : b.rows,
            skipped: b.locale === 0 ? add(b.skipped, chunk.skipped) : b.skipped,
          };
          if (chunk.after) return { next: { ...done, after: chunk.after, chunk: b.chunk + 1 } };
          if (b.locale + 1 < b.locales.length) {
            return { next: { ...done, locale: b.locale + 1, after: null, chunk: 0 } };
          }
          // The last chunk: the manifest switches the storefront to this build.
          const manifest: FeedManifest = {
            key: b.key,
            defaultLocale: b.defaultLocale,
            build: b.id,
            chunks: done.chunks,
            builtAt: new Date().toISOString(),
          };
          await env.FILES.put(
            objectKey('file', tenantId, feedPath.manifest),
            JSON.stringify(manifest),
            { httpMetadata: { contentType: 'application/json' } },
          );
          const stale = await finishFeedBuild(tx, {
            startedAt: b.startedAt,
            chunks: done.chunks,
            rows: done.rows,
            skipped: done.skipped,
            etag: b.id,
          });
          return { finished: { build: b.id, rows: done.rows, stale } };
        });
        if ('off' in next) {
          // The feed is off: the storefront answers 404 once the files are gone.
          await removeFeedFiles(env, tenantId, null);
        } else if ('next' in next) {
          await env.DOMAINS?.send(
            { kind: 'feed_build', tenantId, build: next.next },
            {
              contentType: 'json',
            },
          );
        } else {
          await removeFeedFiles(env, tenantId, next.finished.build);
          log('info', 'feed built', { tenant_id: tenantId, rows: next.finished.rows });
          if (next.finished.stale) {
            await env.DOMAINS?.send(
              { kind: 'feed_build', tenantId },
              {
                contentType: 'json',
                delaySeconds: FEED_DELAY_SECONDS,
              },
            );
          }
        }
        m.ack();
      } catch (e) {
        log('error', 'feed build failed', { tenant_id: tenantId, error: String(e) });
        if (m.attempts >= 3) {
          await withTenant(client, tenantId, (tx) => failFeedBuild(tx, String(e))).catch(() => {});
          m.ack();
        } else {
          m.retry({ delaySeconds: 60 });
        }
      }
    }
  });
}
