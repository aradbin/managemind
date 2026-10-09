// Minimal stand-in for the real i18n package: typed keys, Bangla and English.
const messages = {
  bn: {
    addToCart: 'কার্টে যোগ করুন',
    inStock: 'স্টকে আছে',
    delivery: 'ঢাকার ভিতরে ২–৩ দিনে ডেলিভারি',
    cod: 'ক্যাশ অন ডেলিভারি',
    related: 'আরও পণ্য',
    details: 'পণ্যের বিবরণ',
    home: 'হোম',
    footer: 'সর্বস্বত্ব সংরক্ষিত',
  },
  en: {
    addToCart: 'Add to cart',
    inStock: 'In stock',
    delivery: 'Delivery in 2–3 days inside Dhaka',
    cod: 'Cash on delivery',
    related: 'More products',
    details: 'Product details',
    home: 'Home',
    footer: 'All rights reserved',
  },
} as const;

export type Locale = keyof typeof messages;
export type MessageKey = keyof (typeof messages)['en'];
export const t = (locale: Locale, key: MessageKey) => messages[locale][key];
