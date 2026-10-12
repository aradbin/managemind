import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    '01712345678',
    '1712345678',
    '8801712345678',
    '+8801712345678',
    '008801712345678',
    '+880 1712-345678',
    '(017) 1234.5678',
    '০১৭১২৩৪৫৬৭৮',
    '+৮৮০১৭১২৩৪৫৬৭৮',
  ])('normalizes %s', (input) => {
    expect(normalizePhone(input)).toBe('+8801712345678');
  });

  it.each([
    '',
    '0171234567', // too short
    '017123456789', // too long
    '01212345678', // no operator 2
    '0221234567', // Dhaka landline
    '+911712345678', // India
    '+1 171 234 5678',
    '01712a45678',
  ])('refuses %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('formatPhone', () => {
  it('shows the local form', () => {
    expect(formatPhone('+8801712345678')).toBe('01712-345678');
    expect(formatPhone('+8801712345678', 'bengali')).toBe('০১৭১২-৩৪৫৬৭৮');
  });

  it('leaves anything else alone', () => {
    expect(formatPhone('+911712345678')).toBe('+911712345678');
  });
});
