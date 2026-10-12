import { describe, expect, it } from 'vitest';
import { hostKey, objectKey, tenantKey, tenantObjectPrefixes } from './storage-keys';

const T = '0199d000-0000-7000-8000-00000000f001';

describe('KV keys', () => {
  it('builds host and tenant keys', () => {
    expect(hostKey('acme.example.test')).toBe('host:acme.example.test');
    expect(hostKey('acme.localhost')).toBe('host:acme.localhost');
    expect(tenantKey(T, 'catalog:version')).toBe(`t:${T}:catalog:version`);
  });

  it.each(['Acme.example.test', 'acme', 'acme.example.test:443', 'acme.example.test/x', ''])(
    'refuses host %s',
    (host) => {
      expect(() => hostKey(host)).toThrow(TypeError);
    },
  );

  it('refuses a missing tenant or a bad name', () => {
    expect(() => tenantKey('acme', 'x')).toThrow(TypeError);
    expect(() => tenantKey(T, '')).toThrow(TypeError);
    expect(() => tenantKey(T, 'a b')).toThrow(TypeError);
    expect(() => tenantKey(T, 'Upper')).toThrow(TypeError);
  });
});

describe('R2 keys', () => {
  it('puts lifecycle folders before the tenant prefix', () => {
    expect(objectKey('file', T, 'products/ab12.webp')).toBe(`tenants/${T}/products/ab12.webp`);
    expect(objectKey('export', T, '2026-10-11.zip')).toBe(`exports/tenants/${T}/2026-10-11.zip`);
    expect(objectKey('tmp-upload', T, 'u1.webp')).toBe(`tmp-uploads/tenants/${T}/u1.webp`);
  });

  it.each(['', '/abs', 'a//b', '../x', 'a/../b', 'a/./b', '.', 'A.webp', 'a b', 'a/'])(
    'refuses path %s',
    (path) => {
      expect(() => objectKey('file', T, path)).toThrow(TypeError);
    },
  );

  it('lists every prefix a purge must delete', () => {
    expect(tenantObjectPrefixes(T)).toEqual([
      `tenants/${T}/`,
      `exports/tenants/${T}/`,
      `tmp-uploads/tenants/${T}/`,
    ]);
  });
});
