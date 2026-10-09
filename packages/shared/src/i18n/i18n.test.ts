import { describe, expect, it } from 'vitest';
import { formatDateTime, formatNumber, type MessageKey, messages, placeholders, t } from './index';

describe('i18n', () => {
  it('has every English key in Bangla, with the same placeholders', () => {
    const keys = Object.keys(messages.en) as MessageKey[];
    expect(Object.keys(messages.bn).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(placeholders(messages.bn[key]), key).toEqual(placeholders(messages.en[key]));
    }
  });

  it('substitutes placeholders', () => {
    expect(t('en', 'store.notFound.body', { host: 'demo.example.test' })).toBe(
      'There is no store at demo.example.test.',
    );
    expect(t('bn', 'store.placeholder.welcome', { store: 'ডেমো' })).toBe('ডেমো-এ স্বাগতম');
    expect(t('en', 'store.notFound.body')).toBe('There is no store at {host}.');
  });

  it('chooses plural forms and localises numbers', () => {
    expect(t('en', 'cart.items', { count: 1 })).toBe('1 item');
    expect(t('en', 'cart.items', { count: 3 })).toBe('3 items');
    expect(t('bn', 'cart.items', { count: 3 })).toBe('৩টি পণ্য');
    expect(t('bn', 'cart.items', { count: 3 }, 'latin')).toBe('3টি পণ্য');
  });

  it('formats numbers and dates in Asia/Dhaka', () => {
    expect(formatNumber('bn', 1234567)).toBe('১২,৩৪,৫৬৭');
    expect(formatNumber('en', 1234567)).toBe('1,234,567');
    // 18:30 UTC on 1 January is 00:30 on 2 January in Dhaka (UTC+6).
    const d = new Date(Date.UTC(2026, 0, 1, 18, 30));
    expect(
      formatDateTime('en', d, { dateStyle: 'medium', timeStyle: 'short', hour12: false }),
    ).toBe('Jan 2, 2026, 00:30');
    expect(formatDateTime('bn', d, { day: 'numeric' })).toBe('২');
  });
});
