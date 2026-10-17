// Theme text in the shopper's language, falling back to the store's default.
import type { Locale } from '@managemind/shared/i18n';

export type Localized = { bn?: string; en?: string };

export const pick = (
  value: Localized | null | undefined,
  locale: Locale,
  fallback: Locale,
): string => value?.[locale] || value?.[fallback] || '';
