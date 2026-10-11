// Sends with two quick retries for transient failures. Every attempt carries
// the same idempotency key, so a retry after a lost response never sends a
// second copy.
import { uuidv7 } from '@managemind/shared';
import { EmailError, type EmailMessage, type EmailProvider } from './types';

export interface RetryOptions {
  attempts?: number;
  /** Delay before the second attempt; doubled after each failure. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function sendEmail(
  provider: EmailProvider,
  message: EmailMessage,
  { attempts = 3, backoffMs = 200, sleep = wait }: RetryOptions = {},
): Promise<{ id: string }> {
  const withKey = { ...message, idempotencyKey: message.idempotencyKey ?? uuidv7() };
  let delay = backoffMs;
  for (let attempt = 1; ; attempt++) {
    try {
      return await provider.send(withKey);
    } catch (e) {
      const retryable = !(e instanceof EmailError) || e.retryable;
      if (!retryable || attempt >= attempts) throw e;
      await sleep(delay);
      delay *= 2;
    }
  }
}
