// First middleware: request ID, then configuration. A bad configuration fails
// the request with a problem response and one log line naming the bad keys.

import { uuidv7 } from '@managemind/shared';
import { ConfigError } from '@managemind/shared/config';
import { createMiddleware } from 'hono/factory';
import { type AppEnv, getConfig } from '../env';
import { log } from '../log';

const INCOMING_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const context = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const requestId = incoming && INCOMING_ID.test(incoming) ? incoming : uuidv7();
  c.set('requestId', requestId);
  c.header('X-Request-Id', requestId);
  try {
    c.set('config', getConfig(c.env));
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    log('error', 'invalid configuration', { request_id: requestId, problems: e.problems });
    return c.json(
      {
        type: 'about:blank',
        title: 'Internal error',
        status: 500,
        code: 'internal',
        instance: requestId,
      },
      500,
      { 'Content-Type': 'application/problem+json' },
    );
  }
  await next();
  return;
});
