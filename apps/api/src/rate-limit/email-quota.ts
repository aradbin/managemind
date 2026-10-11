// Counts emails sent per UTC day against the provider's daily cap (Resend's
// free plan: 100, reset at midnight UTC; ADR 0014) and warns from 70%. The
// count lives in one Durable Object per day, in memory: if it is evicted the
// count restarts and the warning comes late, which is acceptable for a
// warning. Phase 5A's delivery log adds the alert.
import { log } from '../log';
import type { LimiterNamespace } from './index';

const DAY = 24 * 60 * 60;

export const EMAIL_DAILY_CAP = 100;

export async function countEmailSent(
  ns: LimiterNamespace,
  now = new Date(),
  cap = EMAIL_DAILY_CAP,
): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  try {
    // Day-long windows are aligned to the epoch, which is midnight UTC.
    const { count } = await ns
      .getByName(`email-quota:${day}`)
      .hit([{ limit: Number.MAX_SAFE_INTEGER, seconds: DAY }]);
    if (count >= cap * 0.7) {
      log(count >= cap ? 'error' : 'warn', 'email daily quota', { day, count, cap });
    }
    return count;
  } catch (e) {
    log('error', 'email quota count failed', { day, error: String(e) });
    return 0;
  }
}
