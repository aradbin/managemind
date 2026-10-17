import { describe, expect, it } from 'vitest';
import { mapCustomerHeaders, matchPlace, parseCustomerRow } from './customer-import';

describe('customer import', () => {
  it('recognizes WooCommerce’s customer export headers', () => {
    const cols = mapCustomerHeaders([
      'Customer ID',
      'First Name',
      'Last Name',
      'Email',
      'Billing Phone',
      'Billing Address 1',
      'Billing City',
      'Billing State',
    ]);
    expect(cols).toMatchObject({
      firstName: 1,
      lastName: 2,
      email: 3,
      phone: 4,
      address: 5,
      area: 6,
      district: 7,
    });
    const r = parseCustomerRow(
      [
        '7',
        'Rahim',
        'Uddin',
        'R@Example.test',
        '01712-345678',
        'House 5, Road 3',
        'Dhanmondi',
        'Dhaka',
      ],
      cols,
      2,
    );
    expect(r.customer).toMatchObject({
      row: 2,
      phone: '+8801712345678',
      name: 'Rahim Uddin',
      email: 'r@example.test',
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 5, Road 3' },
    });
    expect(r.warnings).toEqual([]);
  });

  it('matches places in Bangla, old spellings, and a unique area without a district', () => {
    expect(matchPlace('ধানমন্ডি', 'ঢাকা')?.areaId).toBe(513);
    expect(matchPlace('Kotwali', 'Chittagong')?.districtId).toBe(8);
    expect(matchPlace('Dhanmondi', undefined)?.areaId).toBe(513);
    // Kotwali is in Dhaka and Chattogram: ambiguous without a district.
    expect(matchPlace('Kotwali', undefined)).toBeNull();
    expect(matchPlace('Nowhere', 'Dhaka')).toBeNull();
  });

  it('keeps an unmatched address in the note with a warning, and refuses a bad phone', () => {
    const cols = mapCustomerHeaders(['নাম', 'মোবাইল', 'ঠিকানা', 'থানা', 'ট্যাগ']);
    const r = parseCustomerRow(['করিম', '০১৮১২৩৪৫৬৭৮', 'বাসা ৩', 'অজানা', 'VIP, wholesale'], cols, 3);
    expect(r.customer).toMatchObject({
      phone: '+8801812345678',
      tags: ['vip', 'wholesale'],
      address: null,
    });
    expect(r.customer?.note).toContain('বাসা ৩');
    expect(r.warnings[0]?.code).toBe('unmatched');
    expect(
      parseCustomerRow(['X', '12345'], mapCustomerHeaders(['name', 'phone']), 4).errors[0]?.field,
    ).toBe('phone');
  });
});
