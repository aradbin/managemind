import { describe, expect, it } from 'vitest';
import { type ChatOrder, chatOrderText, parseChatText } from './chat';

const taka = (poisha: number) => `৳${poisha / 100}`;
const order: ChatOrder = {
  storeName: 'Demo Fashion',
  orderNumber: '#1042',
  customerName: 'Rahim',
  lines: [
    { title: 'Cotton Panjabi', options: ['White', 'L'], quantity: 2, total: 240000 },
    { title: 'Cap', options: [], quantity: 1, total: 30000 },
  ],
  discount: 10000,
  deliveryFee: 6000,
  total: 266000,
  due: 266000,
  trackUrl: 'https://demo.example.test/track',
};

describe('chatOrderText', () => {
  it('writes the summary with lines, discount, delivery and the tracking link', () => {
    expect(chatOrderText('summary', order, 'en', taka)).toBe(
      [
        'Hello Rahim, here is your order #1042 from Demo Fashion:',
        '',
        '• Cotton Panjabi (White, L) × 2: ৳2400',
        '• Cap × 1: ৳300',
        'Discount: −৳100',
        'Delivery: ৳60',
        'Total: ৳2660',
        '',
        'Track your order: https://demo.example.test/track',
        'Use your order number and phone number.',
      ].join('\n'),
    );
  });

  it('shows what is still due when part is paid, and the pay link for payment', () => {
    const paid = { ...order, due: 200000, payUrl: 'https://demo.example.test/track#pay' };
    expect(chatOrderText('summary', paid, 'en', taka)).toContain('To pay: ৳2000');
    const text = chatOrderText('payment', paid, 'en', taka);
    expect(text).toContain('Pay here: https://demo.example.test/track#pay');
    expect(text).not.toContain('Cotton');
  });

  it('writes Bangla with Bangla digits for quantities', () => {
    const text = chatOrderText('summary', order, 'bn', taka);
    expect(text).toContain('Demo Fashion থেকে আপনার অর্ডার #1042:');
    expect(text).toContain('× ২');
  });
});

describe('parseChatText', () => {
  it('finds phones in every common form, once each', () => {
    const text = 'call 01712-345678 or +880 1812 345678, again 8801712345678; বাসা ০১৯১২৩৪৫৬৭৮';
    expect(parseChatText(text).phones).toEqual([
      '+8801712345678',
      '+8801812345678',
      '+8801912345678',
    ]);
  });

  it("ignores numbers that aren't Bangladeshi mobiles", () => {
    expect(parseChatText('code 01234567890, amount 12345678901').phones).toEqual([]);
  });

  it('reads product links with variants and quantities, merging repeats', () => {
    const v = '0192f0c3-1111-7222-8333-444455556666';
    const text = [
      `https://shop.example.test/products/cotton-panjabi?v=${v} × 2`,
      'https://shop.example.test/en/products/%E0%A6%B6%E0%A6%BE%E0%A6%A1%E0%A6%BC%E0%A6%BF',
      `again https://shop.example.test/products/cotton-panjabi?v=${v} x1`,
      'not a product https://shop.example.test/categories/men',
    ].join('\n');
    expect(parseChatText(text).products).toEqual([
      { slug: 'cotton-panjabi', variantId: v, quantity: 3 },
      { slug: 'শাড়ি', variantId: null, quantity: 1 },
    ]);
  });

  it('finds order numbers written with #', () => {
    expect(parseChatText('about order #1042 and # 1043, not 2024').orderNumbers).toEqual([
      1042, 1043,
    ]);
  });
});
