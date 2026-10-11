// Sentry options shared by the API and storefront Workers (phase-0-plan §9).
// Errors only: no traces on the free plan. Sentry is off when there is no DSN,
// which is the case in local development and tests; deployed Workers get
// SENTRY_DSN from the deploy workflows (scripts/sentry.json).

export interface SentryEnv {
  SENTRY_DSN?: string;
  ENVIRONMENT: string;
  /** Git commit of the deployed build; also the Sentry release for source maps. */
  COMMIT_SHA?: string;
}

export function sentryOptions(env: SentryEnv) {
  return {
    dsn: env.SENTRY_DSN || undefined,
    environment: env.ENVIRONMENT,
    release: env.COMMIT_SHA,
    // The same rule as the logs: no personal data, headers, cookies, query
    // strings, bodies, query parameters or queue payloads.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
    },
  };
}
