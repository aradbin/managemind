// Brevo over its HTTP API (https://developers.brevo.com/reference/sendtransacemail),
// for shopper email from the store domain (ADR 0022). No SDK: one fetch call.
// Brevo has no idempotency key, so the caller's retries must stay few: a
// retry after a timeout may send a second copy, which for a sign-in code is
// harmless.
import { EmailError, type EmailMessage, type EmailProvider } from './types';

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export interface BrevoOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

/** "Store <no-reply@example.com>" -> { name: 'Store', email: 'no-reply@example.com' }. */
export function parseAddress(value: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return { email: value.trim() };
  const name = (match[1] ?? '').replace(/^"|"$/g, '');
  return name ? { name, email: (match[2] ?? '').trim() } : { email: (match[2] ?? '').trim() };
}

export function brevoProvider({ apiKey, fetch: fetchImpl = fetch }: BrevoOptions): EmailProvider {
  if (!apiKey) throw new Error('brevoProvider needs an API key');
  return {
    name: 'brevo',
    async send(message: EmailMessage) {
      const body = {
        sender: parseAddress(message.from),
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        ...(message.replyTo ? { replyTo: parseAddress(message.replyTo) } : {}),
        // Brevo's tags are plain strings.
        ...(message.tags
          ? { tags: Object.entries(message.tags).map(([name, value]) => `${name}:${value}`) }
          : {}),
      };
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch {
        throw new EmailError('network_error', { retryable: true });
      }
      const json = (await res.json().catch(() => ({}))) as { messageId?: unknown; code?: unknown };
      if (res.ok && typeof json.messageId === 'string') return { id: json.messageId };
      const code = typeof json.code === 'string' ? json.code : `http_${res.status}`;
      throw new EmailError(code, {
        retryable: res.status === 429 || res.status >= 500,
        status: res.status,
      });
    },
  };
}
