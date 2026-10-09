import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { baseConfig, ConfigError, hostname, loadConfig } from './config';

const env = {
  ENVIRONMENT: 'production',
  PLATFORM_NAME: 'managemind',
  PLATFORM_DOMAIN: 'platform.example.test',
  STORE_DOMAIN: 'stores.example.test',
};

describe('config', () => {
  it('parses a valid environment once per env object', () => {
    const first = loadConfig(baseConfig, env);
    expect(first.STORE_DOMAIN).toBe('stores.example.test');
    expect(loadConfig(baseConfig, env)).toBe(first);
  });

  it('names the bad keys but never their values', () => {
    const schema = baseConfig.extend({ AUTH_SECRET: z.string().min(32) });
    const bad = { ...env, STORE_DOMAIN: 'https://stores.example.test', AUTH_SECRET: 'hunter2' };
    try {
      loadConfig(schema, bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const message = (e as ConfigError).message;
      expect(message).toContain('STORE_DOMAIN');
      expect(message).toContain('AUTH_SECRET');
      expect(message).not.toContain('hunter2');
    }
  });

  it('accepts hostnames only', () => {
    const h = hostname();
    for (const ok of ['example.com', 'a.b.example.co.bd', 'localhost', 'xn--p1ai.example']) {
      expect(h.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      'https://example.com',
      'Example.com',
      'example.com/x',
      'example.com:8787',
      '-a.com',
      'com',
    ]) {
      expect(h.safeParse(bad).success, bad).toBe(false);
    }
  });
});
