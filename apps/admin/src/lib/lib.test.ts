import { describe, expect, it } from 'vitest';
import { safeRedirect, totpSecret } from './auth';
import { describeDevice } from './device';
import { parseThemeChoice, resolveTheme } from './theme';

describe('safeRedirect', () => {
  it('keeps paths on this site', () => {
    expect(safeRedirect('/settings')).toBe('/settings');
    expect(safeRedirect('/invite')).toBe('/invite');
    expect(safeRedirect('/account?tab=1#two-factor')).toBe('/account?tab=1#two-factor');
  });

  it('refuses anything that could leave the site or loop', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/\nfoo',
      '/sign-in',
      '/two-factor?redirect=/',
      42,
      undefined,
    ]) {
      expect(safeRedirect(bad), String(bad)).toBeUndefined();
    }
  });
});

describe('totpSecret', () => {
  it('reads the key from an otpauth URI, in groups of four', () => {
    expect(totpSecret('otpauth://totp/m:a%40b.c?secret=JBSWY3DPEHPK3PXP&issuer=m')).toBe(
      'JBSW Y3DP EHPK 3PXP',
    );
    expect(totpSecret('not a uri')).toBe('');
  });
});

describe('describeDevice', () => {
  it('names common phones and browsers', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome · Android');
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari · iPhone');
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      ),
    ).toBe('Edge · Windows');
    expect(describeDevice(null)).toBeNull();
    expect(describeDevice('curl/8.5.0')).toBeNull();
  });
});

describe('theme', () => {
  it('reads only light or dark as a choice; anything else follows the device', () => {
    expect(parseThemeChoice('light')).toBe('light');
    expect(parseThemeChoice('dark')).toBe('dark');
    for (const other of [null, '', 'system', 'Dark', 1])
      expect(parseThemeChoice(other)).toBe('system');
  });

  it('follows the device only while the choice is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
