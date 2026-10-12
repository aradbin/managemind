// Resend over its HTTP API (https://resend.com/docs/api-reference/emails/send-email).
// No SDK: one fetch call is all the Worker needs.
import { EmailError, type EmailMessage, type EmailProvider } from './types';

const ENDPOINT = 'https://api.resend.com/emails';
/** Errors Resend says to retry: its own failures, locks and per-second limits. */
const RETRYABLE = new Set([
  'application_error',
  'service_unavailable',
  'concurrent_idempotent_requests',
  'resource_locked',
  'rate_limit_exceeded',
]);

export interface ResendOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

export function resendProvider({ apiKey, fetch: fetchImpl = fetch }: ResendOptions): EmailProvider {
  if (!apiKey) throw new Error('resendProvider needs an API key');
  return {
    name: 'resend',
    async send(message: EmailMessage) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      };
      if (message.idempotencyKey) headers['idempotency-key'] = message.idempotencyKey;
      const body = {
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(message.tags
          ? { tags: Object.entries(message.tags).map(([name, value]) => ({ name, value })) }
          : {}),
      };

      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch {
        throw new EmailError('network_error', { retryable: true });
      }
      const json = (await res.json().catch(() => ({}))) as { id?: unknown; name?: unknown };
      if (res.ok && typeof json.id === 'string') return { id: json.id };
      const code = typeof json.name === 'string' ? json.name : `http_${res.status}`;
      throw new EmailError(code, {
        retryable: RETRYABLE.has(code) || res.status >= 500,
        status: res.status,
      });
    },
  };
}
