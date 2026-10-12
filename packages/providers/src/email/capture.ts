// Outside production, email is captured instead of sent (phase-1-plan §3.8):
// the API saves each message to platform.dev_emails, where the dev mailbox
// endpoint and Playwright read it. The adapter only calls `save`, so it
// stays free of database code.
import type { EmailMessage, EmailProvider } from './types';

export type SaveEmail = (message: EmailMessage) => Promise<{ id: string }>;

export function captureProvider(save: SaveEmail): EmailProvider {
  return { name: 'capture', send: (message) => save(message) };
}
