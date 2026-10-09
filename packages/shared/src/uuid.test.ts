import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7, uuidv7Time } from './uuid';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces RFC 9562 version 7 UUIDs', () => {
    for (let i = 0; i < 1000; i += 1) expect(uuidv7()).toMatch(V7);
  });

  it('encodes the timestamp', () => {
    // A time ahead of every earlier call: the generator never goes back in time.
    const now = Date.UTC(2040, 0, 1, 12, 0, 0, 123);
    expect(uuidv7Time(uuidv7(now))).toBe(now);
  });

  it('reads the RFC 9562 test vector', () => {
    // RFC 9562 Appendix A.6: 2022-02-22T19:22:22Z.
    expect(uuidv7Time('017f22e2-79b0-7cc3-98c4-dc0c0c07398f')).toBe(0x017f22e279b0);
  });

  it('stays unique and sorted within one millisecond, past the counter range', () => {
    const now = Date.UTC(2041, 0, 1);
    const ids = Array.from({ length: 6000 }, () => uuidv7(now));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('stays sorted when the clock goes backwards', () => {
    const later = uuidv7(Date.UTC(2042, 0, 1, 0, 0, 1));
    const earlier = uuidv7(Date.UTC(2042, 0, 1, 0, 0, 0));
    expect(earlier > later).toBe(true);
  });

  it('validates UUID strings', () => {
    expect(isUuid(uuidv7())).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')).toBe(false);
    expect(() => uuidv7Time('00000000-0000-4000-8000-000000000000')).toThrow(TypeError);
  });
});
