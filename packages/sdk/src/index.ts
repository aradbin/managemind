// The typed API client for the admin (phase-1-plan §6.3): paths, request
// bodies and responses come from the generated OpenAPI types, and requests
// go through openapi-fetch (about 6 KB). The admin calls its own host, which
// serves the API under the same origin, so cookies and CSRF checks just work.
import createFetchClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths };

/** A problem details body (RFC 9457), as every API error returns. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  errors?: { path: string; code: string; message: string }[];
}

/** Browsers send same-origin cookies by default, which is all the admin needs. */
export function createClient(options: ClientOptions = {}) {
  return createFetchClient<paths>(options);
}

export type Client = ReturnType<typeof createClient>;
