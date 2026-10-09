import { AppError } from '@managemind/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { makeEnv } from './support';

const env: Env = makeEnv();

function appWithTestRoutes() {
  const app = createApp();
  app.get('/test/app-error', () => {
    throw new AppError('conflict', { detail: 'Already confirmed' });
  });
  app.get('/test/crash', () => {
    throw new Error('relation "store.orders" does not exist');
  });
  return app;
}

const logLines = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);

afterEach(() => vi.restoreAllMocks());

describe('api skeleton', () => {
  it('answers /health without a database', async () => {
    const res = await createApp().request('/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', environment: 'preview', commit: 'abc1234' });
  });

  it('generates a request id, or keeps a well-formed incoming one', async () => {
    const app = createApp();
    const generated = (await app.request('/health', {}, env)).headers.get('x-request-id');
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await app.request('/health', { headers: { 'x-request-id': 'req_abcdef12' } }, env);
    expect(kept.headers.get('x-request-id')).toBe('req_abcdef12');
    const replaced = await app.request(
      '/health',
      { headers: { 'x-request-id': 'bad id <script>' } },
      env,
    );
    expect(replaced.headers.get('x-request-id')).not.toBe('bad id <script>');
  });

  it('returns problem details for unknown routes', async () => {
    const res = await createApp().request('/nope', {}, env);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(await res.json()).toMatchObject({
      type: 'https://platform.example.test/errors/not_found',
      code: 'not_found',
      status: 404,
      instance: res.headers.get('x-request-id'),
    });
  });

  it('maps AppErrors to their status and code', async () => {
    const res = await appWithTestRoutes().request('/test/app-error', {}, env);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'conflict', detail: 'Already confirmed' });
  });

  it('hides unknown errors from the client but logs them', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await appWithTestRoutes().request('/test/crash', {}, env);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ code: 'internal', title: 'Internal error' });
    expect(JSON.stringify(body)).not.toContain('store.orders');
    const crash = logLines(errors).find((l) => l.message === 'unhandled error');
    expect(JSON.stringify(crash)).toContain('store.orders');
  });

  it('fails cleanly on bad configuration without logging values', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await createApp().request(
      '/health',
      {},
      { ...env, STORE_DOMAIN: 'https://secret-value.example' },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'internal' });
    const line = logLines(errors).find((l) => l.message === 'invalid configuration');
    expect(line?.problems).toEqual([expect.stringContaining('STORE_DOMAIN')]);
    expect(JSON.stringify(line)).not.toContain('secret-value');
  });

  it('publishes an OpenAPI 3.1 document', async () => {
    const res = await createApp().request('/openapi.json', {}, env);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toContain('/health');
  });

  it('sets security headers', async () => {
    const res = await createApp().request('/health', {}, env);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('logs one structured line per request, sampling successes', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = createApp();
    await app.request('/health', {}, env);
    await app.request('/health', {}, { ...env, LOG_SAMPLE_RATE: '0' });
    await app.request('/missing', {}, { ...env, LOG_SAMPLE_RATE: '0' });
    expect(logLines(info)).toHaveLength(1);
    expect(logLines(info)[0]).toMatchObject({
      level: 'info',
      message: 'request',
      route: '/health',
      status: 200,
    });
    expect(logLines(warn)[0]).toMatchObject({ level: 'warn', status: 404 });
  });
});
