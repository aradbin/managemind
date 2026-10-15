import type { UseFormReturn } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../lib/api';
import {
  applyServerErrors,
  fieldErrorKey,
  optionalEmail,
  optionalPhone,
  optionalText,
} from './form';

describe('form schemas', () => {
  const schema = z.object({
    email: optionalEmail(),
    phone: optionalPhone(),
    note: optionalText(5),
  });

  it('turns empty optional fields into undefined and normalizes phones', () => {
    expect(schema.parse({ email: '', phone: ' ', note: '' })).toEqual({
      email: undefined,
      phone: undefined,
      note: undefined,
    });
    expect(schema.parse({ email: 'a@b.co', phone: '০১৭১২-৩৪৫৬৭৮', note: 'hi' })).toEqual({
      email: 'a@b.co',
      phone: '+8801712345678',
      note: 'hi',
    });
  });

  it('reports message keys the fields can translate', () => {
    const result = schema.safeParse({ email: 'nope', phone: '12345', note: 'too long' });
    expect(result.success).toBe(false);
    const issues = result.error?.issues.map((i) => [i.path.join('.'), i.message, i.code]);
    expect(issues).toEqual([
      ['email', 'form.invalidEmail', 'custom'],
      ['phone', 'form.invalidPhone', 'custom'],
      ['note', expect.any(String), 'too_big'],
    ]);
  });
});

describe('fieldErrorKey', () => {
  it('maps errors to messages', () => {
    expect(fieldErrorKey(undefined)).toBeUndefined();
    expect(fieldErrorKey({ type: 'custom', message: 'form.invalidPhone' })).toBe(
      'form.invalidPhone',
    );
    expect(fieldErrorKey({ type: 'too_small', message: 'Too small: expected…' })).toBe(
      'form.required',
    );
    expect(fieldErrorKey({ type: 'too_big', message: 'Too big' })).toBe('form.tooLong');
    expect(fieldErrorKey({ type: 'invalid_format', message: 'Invalid email' })).toBe(
      'form.invalid',
    );
  });
});

describe('applyServerErrors', () => {
  const problem = (errors: { path: string; code: string; message: string }[]) =>
    new ApiError(422, {
      type: 'x',
      title: 'Validation failed',
      status: 422,
      code: 'validation_failed',
      errors,
    } as never);

  it('puts field errors on the mapped fields only', () => {
    const setError = vi.fn();
    const form = { setError } as unknown as UseFormReturn<{ contactPhone: string }>;
    const applied = applyServerErrors(
      form,
      problem([
        { path: 'profile.contactPhone', code: 'custom', message: 'bad' },
        { path: 'unknown', code: 'custom', message: 'bad' },
      ]),
      (p) => (p === 'profile.contactPhone' ? 'contactPhone' : undefined),
    );
    expect(applied).toBe(true);
    expect(setError).toHaveBeenCalledOnce();
    expect(setError).toHaveBeenCalledWith('contactPhone', {
      type: 'custom',
      message: 'form.invalid',
    });
  });

  it('ignores anything but a 422', () => {
    const form = { setError: vi.fn() } as unknown as UseFormReturn<{ a: string }>;
    expect(applyServerErrors(form, new ApiError(500, undefined))).toBe(false);
    expect(applyServerErrors(form, new Error('x'))).toBe(false);
  });
});
