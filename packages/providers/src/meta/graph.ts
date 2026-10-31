// Meta's Graph API, the part every Meta client shares: the pinned version,
// one authenticated call, and its errors. The token travels in the
// Authorization header, never in a URL (ADR 0013: Workers Logs record URLs).
/** Pinned; moved on yearly, as Meta retires each version about two years after release. */
export const GRAPH_VERSION = 'v25.0';
export const GRAPH_ORIGIN = 'https://graph.facebook.com';

/** A refused or failed call. The message never contains the token or the shopper's data. */
export class MetaError extends Error {
  readonly code: string;
  /** False when retrying can't help: a revoked token, a bad pixel, a malformed event. */
  readonly retryable: boolean;

  constructor(code: string, options: { retryable: boolean; message?: string }) {
    super(options.message ?? code);
    this.name = 'MetaError';
    this.code = code;
    this.retryable = options.retryable;
  }
}

type Fetch = typeof fetch;

// Graph error codes that a retry can fix: temporary, throttled or unknown.
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export async function graph(
  f: Fetch,
  token: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(`${GRAPH_ORIGIN}/${GRAPH_VERSION}/${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new MetaError('network', { retryable: true, message: "Meta didn't answer" });
  }
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_subcode?: number };
  } & Record<string, unknown>;
  if (res.ok && !json.error) return json;
  const code = json.error?.code ?? res.status;
  throw new MetaError(`graph_${code}`, {
    retryable: res.status >= 500 || RETRYABLE_CODES.has(code),
    message: (json.error?.message ?? `HTTP ${res.status}`).slice(0, 200),
  });
}
