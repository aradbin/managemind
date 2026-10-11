// Error reporting for the admin (phase-0-plan §9). The deploy workflows set
// these at build time; local and CI builds have no DSN, so Sentry stays off.
import { init, reactErrorHandler } from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN;

export function initSentry(): void {
  if (!dsn) return;
  init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    // Errors only: no tracing or replay on the free plan, and no personal data.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}

type RootErrorHook = (error: unknown, info: { componentStack?: string | undefined }) => void;

// Sentry's handler expects a componentStack string; React 19 types it as optional.
const report = (): RootErrorHook => {
  const handler = reactErrorHandler();
  return (error, info) => handler(error, { componentStack: info.componentStack ?? '' });
};

/** React 19 root error hooks, so errors React catches are reported too. */
export const rootErrorHandlers: {
  onUncaughtError?: RootErrorHook;
  onCaughtError?: RootErrorHook;
  onRecoverableError?: RootErrorHook;
} = dsn ? { onUncaughtError: report(), onCaughtError: report(), onRecoverableError: report() } : {};
