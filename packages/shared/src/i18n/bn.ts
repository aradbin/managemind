import type { Messages } from './index';

// Bangla messages. Must cover every key in en.ts.
export const bn: Messages = {
  'common.language.bn': 'বাংলা',
  'common.language.en': 'English',
  'store.notFound.title': 'দোকানটি পাওয়া যায়নি',
  'store.notFound.body': '{host} ঠিকানায় কোনো দোকান নেই।',
  'store.placeholder.welcome': '{store}-এ স্বাগতম',
  'cart.items': { one: '{count}টি পণ্য', other: '{count}টি পণ্য' },
  'error.validation_failed': 'চিহ্নিত ঘরগুলো আবার দেখুন।',
  'error.not_found': 'পাতাটি খুঁজে পাওয়া যায়নি।',
  'error.rate_limited': 'অনেকবার চেষ্টা করা হয়েছে। এক মিনিট পরে আবার চেষ্টা করুন।',
  'error.internal': 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।',
};
