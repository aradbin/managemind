import { describe, expect, it } from 'vitest';
import { sentryOptions } from './sentry';

describe('sentryOptions', () => {
  it('is off without a DSN', () => {
    expect(sentryOptions({ ENVIRONMENT: 'development' }).dsn).toBeUndefined();
    expect(sentryOptions({ ENVIRONMENT: 'development', SENTRY_DSN: '' }).dsn).toBeUndefined();
  });

  it('tags the environment and release, and collects no personal data', () => {
    const options = sentryOptions({
      SENTRY_DSN: 'https://key@o1.ingest.de.sentry.io/2',
      ENVIRONMENT: 'production',
      COMMIT_SHA: 'abc123',
    });
    expect(options).toMatchObject({ environment: 'production', release: 'abc123' });
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
    });
    expect(options).not.toHaveProperty('tracesSampleRate');
  });
});
