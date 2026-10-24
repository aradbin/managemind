import { placeholders } from '@managemind/shared/i18n';
import { describe, expect, it } from 'vitest';
import { type AdminKey, loadLocale, messages, translate } from './index';
import './messages';
import './online-store';
import './orders';
import './promotions';
import './launch';
import './billing';

await loadLocale('en');
await loadLocale('bn');

describe('admin messages', () => {
  it('has every English key in Bangla, with the same placeholders', () => {
    const keys = Object.keys(messages.en) as AdminKey[];
    expect(Object.keys(messages.bn).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(placeholders(messages.bn[key] ?? ''), key).toEqual(placeholders(messages.en[key]));
    }
  });

  it('includes the online store’s messages once they are loaded', () => {
    expect(translate('en', 'theme.title')).toBe('Theme');
    expect(translate('bn', 'theme.title')).toBe('থিম');
  });

  it('translates with placeholders', () => {
    expect(translate('en', 'app.name', { platform: 'managemind' })).toBe('managemind admin');
    expect(translate('bn', 'app.name', { platform: 'managemind' })).toBe('managemind অ্যাডমিন');
  });
});
