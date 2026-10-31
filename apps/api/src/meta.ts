// Server-side events for Meta's Conversions API (phase-9-plan §3.1.6, ADR
// 0032). The outbox consumer hands over each order and shipment event; core
// decides whether it reports a purchase or a delivery, and records it once
// per order and name before anything is sent. The send happens outside the
// transaction, and its outcome is recorded after: a failure Meta may accept
// later stays queued and the event is retried; a refusal is final.
import {
  loadCredentials,
  META_EVENT_TRIGGERS,
  markCredentialsFailing,
  metaEventPayload,
  type OutboxEvent,
  planMetaEvent,
  recordMetaEvent,
  withTenant,
} from '@managemind/core';
import {
  type CapiEvent,
  type ConversionsApi,
  conversionsApi,
  fakeConversionsApi,
  MetaError,
} from '@managemind/providers/meta';
import { storeUrlsFor } from './admin/store-urls';
import { withClient } from './db';
import { type Env, getConfig } from './env';
import { log } from './log';
import { credentialsKeyring } from './notifications';

/** What the fake Conversions API was sent: previews, local runs and tests. */
export const fakeMetaEvents: CapiEvent[] = [];

/** The store's Conversions API: the fake one for the token `fake`, outside production. */
export function conversionsApiFor(
  env: Env,
  credentials: { secrets: Record<string, unknown>; config: Record<string, unknown> },
): ConversionsApi {
  const token = String(credentials.secrets.accessToken ?? '');
  if (token === 'fake' && getConfig(env).ENVIRONMENT !== 'production') {
    return fakeConversionsApi(fakeMetaEvents);
  }
  return conversionsApi(String(credentials.config.pixelId ?? ''), token);
}

/** Graph errors that mean the token can't send: invalid, expired, or without permission. */
const AUTH_CODES = new Set(['graph_190', 'graph_102', 'graph_10', 'graph_200']);

export const reportsToMeta = (e: OutboxEvent) => META_EVENT_TRIGGERS.has(e.eventType);

/** Reports one outbox event to Meta when it should; throws when it should be retried. */
export async function reportToMeta(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  event: OutboxEvent,
): Promise<void> {
  const config = getConfig(env);
  const keyring = await credentialsKeyring(env);
  await withClient(env, ctx, async (client) => {
    const planned = await withTenant(client, event.tenantId, async (tx) => {
      const credentials = await loadCredentials(tx, keyring, 'meta_capi');
      const p = await planMetaEvent(tx, event, { hasToken: credentials !== null });
      if (!p || !credentials) return null;
      const urls = await storeUrlsFor(config, tx);
      const payload = await metaEventPayload(tx, p, { sourceUrl: urls.page('checkout') });
      return payload ? { p, payload, credentials } : null;
    });
    if (!planned) return;
    const { p, payload, credentials } = planned;
    const testEventCode = credentials.config.testEventCode as string | undefined;
    let retry: unknown = null;
    let refused = false;
    let outcome: Parameters<typeof recordMetaEvent>[2];
    try {
      await conversionsApiFor(env, credentials).send([payload as CapiEvent], { testEventCode });
      outcome = { status: 'sent' };
    } catch (e) {
      const final = !(e instanceof MetaError) || !e.retryable;
      outcome = {
        status: final ? 'failed' : 'queued',
        reason: e instanceof Error ? e.message : String(e),
      };
      if (!final) retry = e;
      // A revoked token or lost permission: every later event would fail too.
      refused = e instanceof MetaError && AUTH_CODES.has(e.code);
      log(final ? 'error' : 'warn', 'meta event not sent', {
        tenant_id: event.tenantId,
        event: p.name,
        code: e instanceof MetaError ? e.code : 'error',
      });
    }
    await withTenant(client, event.tenantId, async (tx) => {
      await recordMetaEvent(tx, p.id, outcome);
      // Shown on the settings page until the token is replaced.
      if (refused && outcome.status !== 'sent') {
        await markCredentialsFailing(tx, 'meta_capi', outcome.reason);
      }
    });
    if (retry) throw retry;
  });
}
