import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asList, oneOrMany } from './query';

describe('oneOrMany', () => {
  const status = oneOrMany(z.enum(['paid', 'unpaid', 'refunded']));

  it('reads one value, or several separated by commas', () => {
    expect(status.parse('paid')).toEqual(['paid']);
    expect(status.parse('paid, unpaid')).toEqual(['paid', 'unpaid']);
    expect(status.parse(['unpaid'])).toEqual(['unpaid']);
    expect(status.parse(undefined)).toBeUndefined();
  });

  it('refuses a value outside the list, an empty one and more than 20', () => {
    expect(status.safeParse('paid,lost').success).toBe(false);
    expect(status.safeParse(',').success).toBe(false);
    const ids = oneOrMany(z.uuid());
    const many = Array.from({ length: 21 }, () => crypto.randomUUID()).join(',');
    expect(ids.safeParse(many).success).toBe(false);
  });
});

describe('asList', () => {
  it('makes one value or several a list', () => {
    expect(asList(undefined)).toEqual([]);
    expect(asList('a')).toEqual(['a']);
    expect(asList(['a', 'b'])).toEqual(['a', 'b']);
  });
});
