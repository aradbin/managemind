import { describe, expect, it } from 'vitest';
import { defaultTenantSettings, tenantSettings } from './tenant-settings';

describe('tenantSettings', () => {
  it('fills defaults for a new store', () => {
    expect(defaultTenantSettings()).toEqual({ version: 1, profile: {}, display: {} });
    expect(tenantSettings.parse({})).toEqual(defaultTenantSettings());
  });

  it('normalizes the contact phone to E.164', () => {
    const settings = tenantSettings.parse({
      profile: { contactPhone: '01712-345678', contactEmail: 'shop@example.test' },
    });
    expect(settings.profile).toEqual({
      contactPhone: '+8801712345678',
      contactEmail: 'shop@example.test',
    });
  });

  it('refuses bad values and unknown keys', () => {
    expect(tenantSettings.safeParse({ profile: { contactPhone: '12345' } }).success).toBe(false);
    expect(tenantSettings.safeParse({ profile: { contactEmail: 'not-an-email' } }).success).toBe(
      false,
    );
    expect(tenantSettings.safeParse({ profile: { fax: '123' } }).success).toBe(false);
    expect(tenantSettings.safeParse({ theme: 'dark' }).success).toBe(false);
    expect(tenantSettings.safeParse({ version: 2 }).success).toBe(false);
  });

  it('trims address lines and refuses empty ones', () => {
    const settings = tenantSettings.parse({ profile: { address: { line1: '  House 12  ' } } });
    expect(settings.profile.address).toEqual({ line1: 'House 12' });
    expect(tenantSettings.safeParse({ profile: { address: { line1: '  ' } } }).success).toBe(false);
  });
});
