// Counts emails sent per UTC day against the provider's daily cap (Resend's
// free plan: 100, reset at midnight UTC; ADR 0014) and warns from 70%. The
// count lives in one Durable Object per day, in memory: if it is evicted the
// count restarts and the warning comes late, which is acceptable for a
// warning. Phase 5A's notifications skip shopper order updates past 70%
// (phase-5a-plan §3.8), keeping the rest for sign-in codes and staff alerts.
import { log } from '../log';
import type { LimiterNamespace } from './index';

const DAY = 24 * 60 * 60;

export const EMAIL_DAILY_CAP = 100;
/** The share past which shopper order updates are skipped. */
export const EMAIL_GUARD_SHARE = 0.7;

const dayWindow = [{ limit: Number.MAX_SAFE_INTEGER, seconds: DAY }];

export async function countEmailSent(
  ns: LimiterNamespace,
  now = new Date(),
  cap = EMAIL_DAILY_CAP,
): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  try {
    // Day-long windows are aligned to the epoch, which is midnight UTC.
    const { count } = await ns.getByName(`email-quota:${day}`).hit(dayWindow);
    if (count >= cap * 0.7) {
      log(count >= cap ? 'error' : 'warn', 'email daily quota', { day, count, cap });
    }
    return count;
  } catch (e) {
    log('error', 'email quota count failed', { day, error: String(e) });
    return 0;
  }
}

/** Today's platform emails so far; 0 when the count can't be read (fails open). */
export async function emailsSentToday(ns: LimiterNamespace, now = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  try {
    return await ns.getByName(`email-quota:${day}`).peek(dayWindow);
  } catch (e) {
    log('error', 'email quota read failed', { day, error: String(e) });
    return 0;
  }
}
