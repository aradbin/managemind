// The store's /api/* is the API's /v1/store/* (pages/api/[...path].ts), so the
// scripts' routes leave that prefix out: '/v1/store/confirm' would reach
// /v1/store/v1/store/confirm, a 404 that pages can mistake for an answer.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = import.meta.dirname;
const scripts = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('store script API routes', () => {
  it('finds the scripts’ calls', () => {
    const calls = scripts.flatMap((f) => routes(f));
    expect(calls).toContain('/checkout/draft');
    expect(calls).toContain('/confirm/view');
  });

  it.each(scripts)('%s calls /api without the /v1/store prefix', (file) => {
    for (const route of routes(file)) expect(route).not.toMatch(/^\/v1\//);
  });
});

/** The string routes passed to api() and api<T>(). */
function routes(file: string): string[] {
  const text = readFileSync(join(dir, file), 'utf8');
  return [...text.matchAll(/\bapi(?:<[^>]*>)?\(\s*['`]([^'`$]+)/g)].map((m) => m[1] as string);
}
