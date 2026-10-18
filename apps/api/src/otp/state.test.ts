import { describe, expect, it } from 'vitest';
import { CODE_TTL_MS, MAX_TRIES, newCode, OtpState } from './state';

function memory() {
  let value: Parameters<ConstructorParameters<typeof OtpState>[0]['put']>[0] | undefined;
  return new OtpState({
    get: async () => value,
    put: async (v) => {
      value = v;
    },
  });
}

describe('phone codes', () => {
  it('are six digits', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it('give a token for the right code, good for this phone until it expires', async () => {
    const otp = memory();
    const code = await otp.issue();
    const result = await otp.verify(code);
    expect(result.ok).toBe(true);
    const token = result.ok ? result.token : '';
    expect(await otp.check('nope')).toBe(false);
    expect(await otp.check(token)).toBe(true);
    expect(await otp.check(token)).toBe(true);
    expect(await otp.check(token, Date.now() + 16 * 60_000)).toBe(false);
    // The code is spent with it.
    expect(await otp.verify(code)).toEqual({ ok: false, reason: 'expired' });
  });

  it('lock after five wrong tries, and expire after ten minutes', async () => {
    const otp = memory();
    const code = await otp.issue();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_TRIES; i++)
      expect(await otp.verify(wrong)).toEqual({ ok: false, reason: 'wrong' });
    expect(await otp.verify(wrong)).toEqual({ ok: false, reason: 'locked' });
    expect(await otp.verify(code)).toEqual({ ok: false, reason: 'locked' });
    const later = memory();
    const now = Date.now();
    const fresh = await later.issue(now);
    expect(await later.verify(fresh, now + CODE_TTL_MS + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});
