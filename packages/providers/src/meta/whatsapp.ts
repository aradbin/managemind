// The WhatsApp Cloud API (phase-9-plan §3.2, ADR 0032), with the store's own
// number, account and token: reading the number, submitting and listing
// templates, sending a template or a plain message, and checking a
// webhook's signature. Meta bills the store's own account for what it sends.
import { graph, MetaError } from './graph';

type Fetch = typeof fetch;

export interface WhatsappNumber {
  displayPhone: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  messagingLimit: string | null;
}

export interface TemplateSpec {
  name: string;
  language: 'bn' | 'en';
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  /** With {{1}}, {{2}}, …; `examples` gives one value for each. */
  body: string;
  examples: string[];
  /** Quick replies, in order. */
  quickReplies?: string[];
}

export interface SendTemplate {
  name: string;
  language: 'bn' | 'en';
  /** The body's values, in {{n}} order. */
  values: string[];
  /** Each quick reply's payload, in order: what the webhook reports when tapped. */
  payloads?: string[];
}

export interface WhatsappApi {
  number(): Promise<WhatsappNumber>;
  sendTemplate(to: string, template: SendTemplate): Promise<{ id: string }>;
  sendText(to: string, text: string): Promise<{ id: string }>;
  createTemplate(spec: TemplateSpec): Promise<{ id: string; status: string }>;
  templates(): Promise<
    { id: string; name: string; language: string; status: string; reason: string | null }[]
  >;
}

/** Meta's ID for a WhatsApp user: the number without the plus. */
const waId = (e164: string) => e164.replace(/\D/g, '');

/** Errors that mean the shopper can't get WhatsApp messages: not on WhatsApp, or undeliverable. */
export const UNREACHABLE_CODES = new Set(['graph_131026', 'graph_131047', 'graph_131051']);

export function whatsappApi(
  account: { phoneNumberId: string; wabaId: string; token: string },
  f: Fetch = fetch,
): WhatsappApi {
  const { phoneNumberId, wabaId, token } = account;
  const send = async (body: Record<string, unknown>) => {
    const json = await graph(f, token, `${phoneNumberId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', ...body },
    });
    const id = (json.messages as { id?: string }[] | undefined)?.[0]?.id;
    if (!id) throw new MetaError('no_message_id', { retryable: true });
    return { id };
  };
  return {
    async number() {
      const json = await graph(
        f,
        token,
        `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
        { method: 'GET' },
      );
      const s = (k: string) => (typeof json[k] === 'string' ? (json[k] as string) : null);
      return {
        displayPhone: s('display_phone_number'),
        verifiedName: s('verified_name'),
        qualityRating: s('quality_rating'),
        messagingLimit: s('messaging_limit_tier'),
      };
    },
    sendTemplate(to, t) {
      const components: Record<string, unknown>[] = [];
      if (t.values.length) {
        components.push({
          type: 'body',
          parameters: t.values.map((text) => ({ type: 'text', text: text || '-' })),
        });
      }
      (t.payloads ?? []).forEach((payload, index) => {
        components.push({
          type: 'button',
          sub_type: 'quick_reply',
          index: String(index),
          parameters: [{ type: 'payload', payload }],
        });
      });
      return send({
        to: waId(to),
        type: 'template',
        template: { name: t.name, language: { code: t.language }, components },
      });
    },
    sendText(to, text) {
      return send({ to: waId(to), type: 'text', text: { body: text, preview_url: false } });
    },
    async createTemplate(spec) {
      const components: Record<string, unknown>[] = [
        {
          type: 'BODY',
          text: spec.body,
          ...(spec.examples.length ? { example: { body_text: [spec.examples] } } : {}),
        },
      ];
      if (spec.quickReplies?.length) {
        components.push({
          type: 'BUTTONS',
          buttons: spec.quickReplies.map((text) => ({ type: 'QUICK_REPLY', text })),
        });
      }
      const json = await graph(f, token, `${wabaId}/message_templates`, {
        method: 'POST',
        body: { name: spec.name, language: spec.language, category: spec.category, components },
      });
      return { id: String(json.id ?? ''), status: String(json.status ?? 'PENDING') };
    },
    async templates() {
      const json = await graph(
        f,
        token,
        `${wabaId}/message_templates?fields=id,name,language,status,rejected_reason&limit=200`,
        { method: 'GET' },
      );
      return ((json.data as Record<string, unknown>[] | undefined) ?? []).map((t) => ({
        id: String(t.id),
        name: String(t.name),
        language: String(t.language),
        status: String(t.status),
        reason:
          typeof t.rejected_reason === 'string' && t.rejected_reason !== 'NONE'
            ? t.rejected_reason
            : null,
      }));
    },
  };
}

/**
 * Checks Meta's X-Hub-Signature-256 over the raw body with the app secret,
 * in constant time, before anything in the body is read.
 */
export async function verifyMetaSignature(
  appSecret: string,
  rawBody: string,
  header: string | null | undefined,
): Promise<boolean> {
  const sent = /^sha256=([0-9a-f]{64})$/.exec(header ?? '')?.[1];
  if (!sent) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)),
  );
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sent.charCodeAt(i);
  return diff === 0;
}

/** A WhatsApp account that keeps what it was asked, for previews, local runs and tests. */
export function fakeWhatsappApi(log: { kind: string; to?: string; body: unknown }[] = []) {
  let n = 0;
  const api: WhatsappApi & { log: typeof log } = {
    log,
    async number() {
      return {
        displayPhone: '+880 1700-000000',
        verifiedName: 'Fake shop',
        qualityRating: 'GREEN',
        messagingLimit: 'TIER_250',
      };
    },
    async sendTemplate(to, template) {
      if (to.endsWith('0000000')) {
        throw new MetaError('graph_131026', { retryable: false, message: 'Message undeliverable' });
      }
      log.push({ kind: 'template', to, body: template });
      return { id: `wamid.fake${++n}` };
    },
    async sendText(to, text) {
      log.push({ kind: 'text', to, body: text });
      return { id: `wamid.fake${++n}` };
    },
    async createTemplate(spec) {
      log.push({ kind: 'create', body: spec });
      return { id: `tpl${++n}`, status: 'APPROVED' };
    },
    async templates() {
      return [];
    },
  };
  return api;
}
