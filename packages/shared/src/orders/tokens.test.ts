import { describe, expect, it } from 'vitest';
import { signOrderToken, verifyOrderToken } from './tokens';

const A = '01951e1e-0000-7000-8000-00000000000a';
const B = '01951e1e-0000-7000-8000-00000000000b';
const ORDER = '01951e1e-0000-7000-8000-0000000000aa';
const SECRET = 'a-secret-that-is-long-enough-0123456789';

describe('order tokens', () => {
  it('verify for the same store and purpose only, until they expire', async () => {
    const now = new Date('2026-10-17T00:00:00Z');
    const t = await signOrderToken('view', A, ORDER, SECRET, now);
    expect(await verifyOrderToken('view', A, t, SECRET, now)).toBe(ORDER);
    expect(await verifyOrderToken('view', B, t, SECRET, now)).toBeNull();
    expect(await verifyOrderToken('track', A, t, SECRET, now)).toBeNull();
    expect(
      await verifyOrderToken('view', A, t, 'another-secret-that-is-long-enough-000', now),
    ).toBeNull();
    const later = new Date(now.getTime() + 25 * 3600_000);
    expect(await verifyOrderToken('view', A, t, SECRET, later)).toBeNull();
    expect(await verifyOrderToken('view', A, `${t}x`, SECRET, now)).toBeNull();
  });
});
