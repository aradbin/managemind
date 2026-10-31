import { describe, expect, it } from 'vitest';
import { metaSettings } from './settings';

describe('metaSettings', () => {
  it('is off by default and reports purchases when placed', () => {
    expect(metaSettings.parse({})).toEqual({
      feed: { enabled: false },
      purchaseAt: 'placed',
      deliveredEvent: false,
    });
  });

  it('refuses a key that is too short, and unknown fields', () => {
    expect(metaSettings.safeParse({ feed: { enabled: true, key: 'short' } }).success).toBe(false);
    expect(metaSettings.safeParse({ pixelId: '123' }).success).toBe(false);
  });
});
