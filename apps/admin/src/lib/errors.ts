// Turns a failed call into a message for the person using the admin.

import type { Params } from '@managemind/shared/i18n';
import type { AdminKey } from '../i18n';
import { ApiError } from './api';
import { AuthError } from './auth';

type T = (key: AdminKey, params?: Params) => string;

export function errorMessage(error: unknown, t: T): string {
  if ((error instanceof ApiError || error instanceof AuthError) && error.status === 429) {
    return t('error.rateLimited', {
      minutes: Math.max(1, Math.ceil((error.retryAfter ?? 60) / 60)),
    });
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return t('error.offline');
  return t('error.generic');
}

/** errorMessage, plus the reasons a change is refused in a store. */
export function saveErrorMessage(error: unknown, t: T): string {
  if (error instanceof ApiError) {
    if (error.status === 423) return t('error.suspended');
    if (error.status === 403) return t('error.forbidden');
    if (error.status === 422) return t('form.invalid');
  }
  return errorMessage(error, t);
}
