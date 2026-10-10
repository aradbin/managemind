// English messages. The source of truth for message keys: bn.ts must provide
// every key (checked by the type system and by a parity test).
export const en = {
  'common.language.bn': 'বাংলা',
  'common.language.en': 'English',
  'store.notFound.title': 'Store not found',
  'store.notFound.body': 'There is no store at {host}.',
  'store.placeholder.welcome': 'Welcome to {store}',
  'store.devBanner': 'Preview: showing {store}. Choose another store with ?store=<slug>.',
  'admin.title': '{platform} admin',
  'admin.placeholder': 'The admin app arrives in Phase 1. This page proves the build and hosting.',
  'admin.api': 'API status: {status}',
  'cart.items': { one: '{count} item', other: '{count} items' },
  'error.validation_failed': 'Please check the highlighted fields.',
  'error.not_found': 'We could not find that page.',
  'error.rate_limited': 'Too many attempts. Please wait a minute and try again.',
  'error.internal': 'Something went wrong. Please try again.',
} as const;
