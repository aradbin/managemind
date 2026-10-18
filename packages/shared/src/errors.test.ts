import { describe, expect, it } from 'vitest';
import { AppError, toProblem } from './errors';

const ctx = { errorBaseUrl: 'https://example.test/errors/', requestId: 'req_123' };

describe('toProblem', () => {
  it('maps a known error to RFC 9457 problem details', () => {
    const err = new AppError('validation_failed', {
      detail: 'Quantity must be at least 1',
      fields: [{ path: 'items.0.quantity', code: 'too_small', message: 'Must be at least 1' }],
    });
    expect(err.status).toBe(422);
    expect(toProblem(err, ctx)).toEqual({
      type: 'https://example.test/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      code: 'validation_failed',
      detail: 'Quantity must be at least 1',
      instance: 'req_123',
      errors: [{ path: 'items.0.quantity', code: 'too_small', message: 'Must be at least 1' }],
    });
  });

  it('never leaks the message of an unknown error', () => {
    const problem = toProblem(new Error('relation "store.orders" does not exist'), ctx);
    expect(problem).toEqual({
      type: 'https://example.test/errors/internal',
      title: 'Internal error',
      status: 500,
      code: 'internal',
      instance: 'req_123',
    });
  });

  it('hides the detail of server-side AppErrors', () => {
    const err = new AppError('tenant_context_missing', { detail: 'withTenant called without id' });
    const problem = toProblem(err, { errorBaseUrl: 'https://example.test/errors' });
    expect(problem.code).toBe('internal');
    expect(problem.detail).toBeUndefined();
  });
});

describe('problem extensions', () => {
  it('carries extension members without replacing the standard ones', () => {
    const problem = toProblem(
      new AppError('price_changed', { extensions: { totals: { total: 100 }, status: 200 } }),
      { errorBaseUrl: 'https://x.test/errors' },
    );
    expect(problem).toMatchObject({ code: 'price_changed', status: 409, totals: { total: 100 } });
  });
});
