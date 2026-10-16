import { describe, expect, it } from 'vitest';
import { parseInteger, toBanglaDigits, toLatinDigits } from './digits';

describe('digits', () => {
  it('converts between Bangla and Latin digits', () => {
    expect(toLatinDigits('১২৩ টি')).toBe('123 টি');
    expect(toBanglaDigits('01712')).toBe('০১৭১২');
  });

  it('parses whole numbers people type', () => {
    expect(parseInteger(' ১২ ')).toBe(12);
    expect(parseInteger('1,200')).toBe(1200);
    expect(parseInteger('-3')).toBeNull();
    expect(parseInteger('-3', { signed: true })).toBe(-3);
    expect(parseInteger('1.5')).toBeNull();
    expect(parseInteger('')).toBeNull();
    expect(parseInteger('99999999999999999')).toBeNull();
  });
});
