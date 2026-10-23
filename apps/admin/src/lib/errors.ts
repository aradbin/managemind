// Turns a failed call into a message for the person using the admin.

import type { Params } from '@managemind/shared/i18n';
import type { AdminKey } from '../i18n';
import { ApiError } from './api';
import { AuthError } from './auth';

type T = (key: AdminKey, params?: Params) => string;

/** What the plan allows and how to get more (phase-5b-plan §3.5), or the terms to accept. */
function planMessage(error: ApiError, t: T): string | null {
  const code = error.problem?.code;
  if (code === 'plan_limit') {
    const p = error.problem as { limit?: string; max?: number };
    return t('error.planLimit', {
      max: p.max ?? 0,
      what: t(`error.planLimit.${p.limit ?? 'products'}` as AdminKey),
    });
  }
  if (code === 'feature_not_in_plan') return t('error.notInPlan');
  if (code === 'terms_required') return t('error.termsRequired');
  return null;
}

export function errorMessage(error: unknown, t: T): string {
  if (error instanceof ApiError) {
    const plan = planMessage(error, t);
    if (plan) return plan;
  }
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
    const plan = planMessage(error, t);
    if (plan) return plan;
    if (error.status === 423) return t('error.suspended');
    if (error.status === 403) return t('error.forbidden');
    if (error.status === 422) return t('form.invalid');
  }
  return errorMessage(error, t);
}
