// Admin messages (phase-1-plan §7.3). Kept out of packages/shared so
// storefront bundles never carry them; same t() and parity test.
export const en = {
  'app.name': '{platform} admin',
  'nav.home': 'Home',
  'nav.settings': 'Settings',
  'nav.account': 'Account',
  'nav.platform': 'Platform',
  'nav.main': 'Main',
  'language.switch': 'বাংলা',
  'home.title': 'Home',
  'home.placeholder': 'Your store dashboard arrives with orders (Phase 4).',
  'settings.title': 'Settings',
  'account.title': 'Account',
  'signIn.title': 'Sign in',
  'signIn.placeholder': 'Sign in with an email code arrives in the next update.',
  'error.generic': 'Something went wrong. Please try again.',
  'error.offline': 'You are offline. Changes will not be saved.',
  'update.available': 'A new version is ready.',
  'update.reload': 'Reload',
  loading: 'Loading…',
  'banner.suspended': '{store} is suspended. You can look, but changes are turned off.',
  'banner.support': 'You are working in {store} as {platform} support.',
} as const;
