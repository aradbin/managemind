// Background entry points: the queue consumer and the daily Cron batch.
import {
  type EventType,
  failImport,
  type ImportMessage,
  type OutboxEvent,
  processImportChunk,
  relayEvents,
  runBilling,
  runDailyRollup,
  withTenant,
  writeStoreHealth,
} from '@managemind/core';
import { objectKey } from '@managemind/shared';
import { dhakaDate } from '@managemind/shared/billing';
import { MEDIA_EXTENSIONS, type MediaType } from '@managemind/shared/catalog';
import { captureMessage } from '@sentry/cloudflare';
import { chunkKey } from './admin/imports';
import { billingEmails, sendsBillingEmail } from './billing';
import { queueSink, withClient } from './db';
import { recheckDomains, releaseDomains } from './domains';
import { type Env, getConfig } from './env';
import { syncTenantHosts, touchesHosts } from './kv-sync';
import { log } from './log';
import { notify, sendsMessages } from './notifications';
import { purgeMessages } from './purge/consumer';
import { catchUpSaleEdges, saleEdgeMessages } from './sales';
import { exportEmails } from './tenant-jobs';
import { syncTurnstileHosts, touchesDomains, turnstileWidget } from './turnstile-hosts';

const HEALTH_EVENTS = new Set<EventType>([
  'credentials.changed',
  'tenant_domain.added',
  'tenant_domain.updated',
  'tenant_domain.removed',
]);

/**
 * Outbox consumer (ADR 0010). Events that change a store's hosts update the
 * KV map; events that change what shoppers see become cache purges, one
 * message per store on the purge queue (ADR 0018); order, payment and
 * shipment events send their messages (phase-5a-plan §3.6); everything else
 * is logged and acknowledged. Handlers recompute state rather than apply deltas, so
 * redeliveries are harmless. Messages that keep failing go to the
 * dead-letter queue.
 */
export async function handleQueue(
  batch: MessageBatch<OutboxEvent>,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  // Purges first: if the queue refuses them, the whole batch is retried.
  const purges = purgeMessages(batch.messages.map((m) => m.body));
  if (env.PURGE && purges.length) {
    await env.PURGE.sendBatch(purges.map((body) => ({ body, contentType: 'json' as const })));
  }
  // Sale windows' edges (phase-4-plan §3.14), as delayed messages.
  const edges = saleEdgeMessages(batch.messages.map((m) => m.body));
  // sendBatch takes at most 100 messages.
  for (let i = 0; env.DOMAINS && i < edges.length; i += 100) {
    await env.DOMAINS.sendBatch(edges.slice(i, i + 100));
  }
  // Messages to shoppers and staff (phase-5a-plan §3.6). The delivery log
  // keeps a redelivered event from sending twice, so a failure retries the
  // event and only what it left unsent goes out again.
  const unsent = new Set<string>();
  for (const message of batch.messages) {
    if (!sendsMessages(message.body)) continue;
    try {
      await notify(env, ctx, message.body);
    } catch (e) {
      log('warn', 'notifications will be retried', {
        event_id: message.body.id,
        tenant_id: message.body.tenantId,
        error: String(e),
      });
      unsent.add(message.body.id);
    }
  }
  // Our invoices and their reminders, to the owners (phase-5b-plan §3.7, §3.8).
  for (const message of batch.messages) {
    if (!sendsBillingEmail(message.body)) continue;
    try {
      await billingEmails(env, ctx, message.body);
    } catch (e) {
      log('warn', 'billing email will be retried', { event_id: message.body.id, error: String(e) });
      unsent.add(message.body.id);
    }
  }
  // A finished export's link, to the owners (phase-5b-plan §3.10).
  for (const message of batch.messages) {
    if (message.body.eventType !== 'tenant.exported') continue;
    try {
      await exportEmails(env, ctx, message.body);
    } catch (e) {
      log('warn', 'export email will be retried', { event_id: message.body.id, error: String(e) });
      unsent.add(message.body.id);
    }
  }
  // A closed store lets its custom domains go (phase-5b-plan §3.1).
  for (const message of batch.messages) {
    if (message.body.eventType !== 'tenant.closed') continue;
    try {
      const released = await releaseDomains(env, ctx, message.body.tenantId);
      log('info', 'closed store domains released', {
        tenant_id: message.body.tenantId,
        released,
      });
    } catch (e) {
      log('warn', 'closed store domains will be retried', {
        tenant_id: message.body.tenantId,
        error: String(e),
      });
      unsent.add(message.body.id);
    }
  }
  // Saved credentials and domain changes update the store's health at once
  // (phase-5b-plan §3.3); best effort, since the nightly pass rewrites it.
  const healthOf = new Set(
    batch.messages
      .filter((m) => HEALTH_EVENTS.has(m.body.eventType) && !unsent.has(m.body.id))
      .map((m) => m.body.tenantId),
  );
  for (const tenantId of healthOf) {
    try {
      await withClient(env, ctx, (client) => withTenant(client, tenantId, writeStoreHealth));
    } catch (e) {
      log('warn', 'store health refresh failed', { tenant_id: tenantId, error: String(e) });
    }
  }
  // One sync per store per batch, however many of its events arrived.
  const widget = turnstileWidget(env);
  const tenants = new Map<string, Message<OutboxEvent>[]>();
  for (const message of batch.messages) {
    log('info', 'event received', {
      event_id: message.body.id,
      event_type: message.body.eventType,
      tenant_id: message.body.tenantId,
      attempts: message.attempts,
    });
    if (unsent.has(message.body.id)) {
      message.retry();
    } else if (
      (env.EDGE && touchesHosts(message.body)) ||
      (widget && touchesDomains(message.body))
    ) {
      const list = tenants.get(message.body.tenantId) ?? [];
      list.push(message);
      tenants.set(message.body.tenantId, list);
    } else {
      message.ack();
    }
  }
  const storeDomain = getConfig(env).STORE_DOMAIN;
  for (const [tenantId, messages] of tenants) {
    try {
      if (env.EDGE && messages.some((m) => touchesHosts(m.body))) {
        const result = await syncTenantHosts(env, env.EDGE, ctx, tenantId, storeDomain);
        log('info', 'kv hosts synced', { tenant_id: tenantId, ...result });
      }
      // The Turnstile widget's hostnames follow the store's custom domains.
      if (widget && messages.some((m) => touchesDomains(m.body))) {
        const result = await withClient(env, ctx, (client) =>
          syncTurnstileHosts(client, widget, tenantId),
        );
        log('info', 'turnstile hosts synced', { tenant_id: tenantId, ...result });
      }
      for (const m of messages) m.ack();
    } catch (e) {
      log('error', 'host sync failed', { tenant_id: tenantId, error: String(e) });
      for (const m of messages) m.retry();
    }
  }
}

/**
 * Import chunks (phase-2-plan §3.7): one message per chunk, one chunk per
 * invocation. The chunk's staged JSON is read from R2, processed in one
 * transaction, its events relayed, and the next chunk queued. A failure
 * retries the message; after 3 it goes to the dead-letter queue.
 */
export async function handleImportQueue(
  batch: MessageBatch<ImportMessage>,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  for (const message of batch.messages) {
    const { tenantId, jobId, chunk } = message.body;
    try {
      const staged = await env.FILES.get(chunkKey(tenantId, jobId, chunk));
      // A missing chunk (expired after a day, or never staged) fails the job.
      const products = staged ? await staged.json() : null;
      const next = await withClient(env, ctx, async (client) => {
        if (products === null) {
          await withTenant(client, tenantId, (tx) =>
            failImport(tx, jobId, `chunk ${chunk} is missing`),
          );
          return null;
        }
        return processImportChunk(client, message.body, products, {
          afterCommit: (events) =>
            relayEvents(client, events, queueSink(env.OUTBOX)).then(() => {}),
        });
      });
      if (next) await env.IMPORTS.send(next, { contentType: 'json' });
      log('info', 'import chunk', {
        tenant_id: tenantId,
        job_id: jobId,
        chunk,
        next: next?.chunk ?? null,
      });
      message.ack();
    } catch (e) {
      log('error', 'import chunk failed', {
        tenant_id: tenantId,
        job_id: jobId,
        chunk,
        attempts: message.attempts,
        error: String(e),
      });
      message.retry({ delaySeconds: 10 * message.attempts });
    }
  }
}

/** Chunks that kept failing: their jobs are marked failed with the last error. */
export async function handleImportDeadLetters(
  batch: MessageBatch<ImportMessage>,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  await withClient(env, ctx, async (client) => {
    for (const message of batch.messages) {
      const { tenantId, jobId, chunk } = message.body;
      await withTenant(client, tenantId, (tx) =>
        failImport(tx, jobId, `chunk ${chunk} failed ${message.attempts} times; see the logs`),
      );
      captureMessage('import chunk dead-lettered', {
        level: 'error',
        extra: { tenantId, jobId, chunk },
      });
      message.ack();
    }
  });
}

interface OutboxRow {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: unknown;
  request_id: string | null;
  created_at: Date;
}

const toEvent = (r: OutboxRow): OutboxEvent => ({
  id: r.id,
  tenantId: r.tenant_id,
  eventType: r.event_type as EventType,
  aggregateType: r.aggregate_type,
  aggregateId: r.aggregate_id,
  payload: r.payload,
  requestId: r.request_id,
  createdAt: new Date(r.created_at).toISOString(),
});

/**
 * The daily batch: relay outbox events the request path missed (older than
 * five minutes, across tenants), delete expired technical rows, check that
 * every stock level still equals its movements (phase-2-plan §3.8), and
 * re-check custom domains (phase-3-plan §3.9).
 */
export async function runDailyJobs(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  await withClient(env, ctx, async (client) => {
    await client.query('begin');
    try {
      // The claimed rows stay locked (SKIP LOCKED) until this commit.
      const { rows } = await client.query<OutboxRow>(
        "select * from app.outbox_claim(1000, interval '5 minutes')",
      );
      const result = await relayEvents(client, rows.map(toEvent), queueSink(env.OUTBOX));
      await client.query('commit');
      if (rows.length > 0) {
        const level = result.failed > 0 ? 'error' : 'warning';
        log(result.failed > 0 ? 'error' : 'warn', 'outbox sweep relayed leftovers', {
          claimed: rows.length,
          ...result,
        });
        // The request path should leave nothing behind (ADR 0010), so any
        // leftover is worth an alert.
        captureMessage('outbox sweep relayed leftovers', {
          level,
          extra: { claimed: rows.length, ...result },
        });
      }
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    }
    const cleanup = await client.query<{ name: string; deleted: string }>(
      'select * from app.cleanup_expired()',
    );
    log(
      'info',
      'daily cleanup',
      Object.fromEntries(cleanup.rows.map((r) => [r.name, Number(r.deleted)])),
    );
    await checkInventoryDrift(client);
    // Shoppers' return photos, 90 days after their return closed (phase-5a-plan §3.12).
    try {
      await cleanUpReturnPhotos(env, client);
    } catch (e) {
      log('error', 'return photo cleanup failed', { error: String(e) });
    }
    // Custom domains: pending ones until active or 7 days old, active ones for breakage (ADR 0019).
    try {
      await recheckDomains(env, ctx, client);
    } catch (e) {
      log('error', 'domain recheck failed', { error: String(e) });
      captureMessage('domain recheck failed', { level: 'error', extra: { error: String(e) } });
    }
    // Sale windows that opened or closed since yesterday, in case a queued edge was lost.
    try {
      await catchUpSaleEdges(env, client);
    } catch (e) {
      log('error', 'sale catch-up failed', { error: String(e) });
      captureMessage('sale catch-up failed', { level: 'error', extra: { error: String(e) } });
    }
    // Yesterday's usage and health per store (phase-5b-plan §3.6); a store
    // that fails is filled in the next night.
    try {
      const yesterday = dhakaDate(new Date(Date.now() - 86_400_000));
      const rollup = await runDailyRollup(client, yesterday);
      log(rollup.failed.length ? 'error' : 'info', 'usage rollup', {
        day: yesterday,
        stores: rollup.stores,
        failed: rollup.failed.length,
      });
      if (rollup.failed.length) {
        captureMessage('usage rollup failed for some stores', {
          level: 'error',
          extra: { failed: rollup.failed.slice(0, 10) },
        });
      }
    } catch (e) {
      log('error', 'usage rollup failed', { error: String(e) });
      captureMessage('usage rollup failed', { level: 'error', extra: { error: String(e) } });
    }
    // Our billing (phase-5b-plan §3.7, §3.8): drafts on billing days, drafts
    // issued after review, reminders and the suspension at +14.
    try {
      const billing = await runBilling(client, dhakaDate(new Date()), new Date(), {
        afterCommit: async (events) => {
          await relayEvents(client, events, queueSink(env.OUTBOX));
        },
      });
      log(billing.failed.length ? 'error' : 'info', 'billing run', {
        drafted: billing.drafted,
        issued: billing.issued,
        reminders: billing.reminders.length,
        suspended: billing.suspended.length,
        skipped: billing.skipped.length,
        failed: billing.failed.length,
      });
      if (billing.failed.length || billing.skipped.length) {
        captureMessage('billing run needs attention', {
          level: billing.failed.length ? 'error' : 'warning',
          extra: { failed: billing.failed.slice(0, 10), skipped: billing.skipped.length },
        });
      }
    } catch (e) {
      log('error', 'billing run failed', { error: String(e) });
      captureMessage('billing run failed', { level: 'error', extra: { error: String(e) } });
    }
    // Weekly, on Friday mornings in Dhaka (the cron runs at 23:47 UTC on Thursday).
    if (new Date().getUTCDay() === 4) await cleanUpMedia(env, client);
  });
}

/**
 * The weekly image cleanup (phase-2-plan §3.6): images no product or variant
 * has used for 7 days are deleted, then the files no remaining image of their
 * store refers to. A file whose R2 delete fails is only orphaned: no row
 * points at it, and a later upload of the same bytes simply rewrites it.
 */
export async function cleanUpMedia(
  env: Pick<Env, 'FILES'>,
  client: Parameters<Parameters<typeof withClient>[2]>[0],
): Promise<{ files: number }> {
  let files = 0;
  for (let round = 0; round < 10; round++) {
    const { rows } = await client.query<{ tenant_id: string; sha256: string; mime: MediaType }>(
      'select * from app.media_cleanup(500)',
    );
    if (rows.length === 0) break;
    const keys = rows.map((r) =>
      objectKey('file', r.tenant_id, `media/${r.sha256}.${MEDIA_EXTENSIONS[r.mime]}`),
    );
    for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
    files += keys.length;
  }
  if (files) log('info', 'media cleanup', { files });
  return { files };
}

/**
 * Return photos 90 days after their return closed (phase-5a-plan §3.12):
 * the rows go, then the files no other photo uses. A failed R2 delete only
 * orphans a file no row points at.
 */
export async function cleanUpReturnPhotos(
  env: Pick<Env, 'FILES'>,
  client: Parameters<Parameters<typeof withClient>[2]>[0],
): Promise<{ files: number }> {
  let files = 0;
  for (let round = 0; round < 10; round++) {
    const { rows } = await client.query<{ object_key: string }>(
      'select * from app.return_photo_cleanup(500)',
    );
    if (rows.length === 0) break;
    const keys = rows.map((r) => r.object_key);
    for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
    files += keys.length;
  }
  if (files) log('info', 'return photo cleanup', { files });
  return { files };
}

/**
 * Stock levels that differ from the sum of their movements. Only the
 * inventory service writes either, in one transaction, so any row here is a
 * bug: alert, and keep the IDs for the investigation.
 */
export async function checkInventoryDrift(client: Parameters<Parameters<typeof withClient>[2]>[0]) {
  const { rows } = await client.query<{
    tenant_id: string;
    variant_id: string;
    location_id: string;
    on_hand: string;
    reserved: string;
    moved_on_hand: string;
    moved_reserved: string;
  }>('select * from app.inventory_drift(100)');
  if (rows.length === 0) return 0;
  log('error', 'inventory drift', { rows: rows.length, first: rows.slice(0, 10) });
  captureMessage('inventory drift: stock levels differ from the ledger', {
    level: 'error',
    extra: { rows: rows.length, first: rows.slice(0, 10) },
  });
  return rows.length;
}
