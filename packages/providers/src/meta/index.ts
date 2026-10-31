// Meta's Graph API (phase-9-plan §3.1.6, ADR 0032): the Conversions API for
// server-side events, and a check that a token can reach its pixel. No SDK:
// one fetch per call. The token travels in the Authorization header, never
// in a URL (ADR 0013: Workers Logs record URLs).

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

/** One Conversions API event, as Meta takes it; `user_data` values are already hashed. */
export interface CapiEvent {
  event_name: string;
  /** Seconds since the epoch. */
  event_time: number;
  event_id: string;
  action_source: 'website' | 'business_messaging' | 'phone_call' | 'physical_store' | 'other';
  event_source_url?: string;
  user_data: {
    ph?: string[];
    em?: string[];
    fn?: string[];
    ln?: string[];
    ct?: string[];
    country?: string[];
    external_id?: string[];
    client_ip_address?: string;
    client_user_agent?: string;
    fbp?: string;
    fbc?: string;
  };
  custom_data: {
    currency: string;
    value: number;
    order_id?: string;
    content_type?: 'product';
    contents?: { id: string; quantity: number; item_price?: number }[];
    num_items?: number;
  };
}

type Fetch = typeof fetch;

// Graph error codes that a retry can fix: temporary, throttled or unknown.
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

async function graph(
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

export interface ConversionsApi {
  /** Sends events to the pixel; Meta answers how many it received. */
  send(
    events: readonly CapiEvent[],
    options?: { testEventCode?: string | undefined },
  ): Promise<{ received: number }>;
  /** Reads the pixel with the token: proves both before they are saved. */
  check(): Promise<{ id: string; name: string | null }>;
}

export function conversionsApi(pixelId: string, token: string, f: Fetch = fetch): ConversionsApi {
  if (!/^\d{15,16}$/.test(pixelId)) {
    throw new MetaError('bad_pixel', {
      retryable: false,
      message: 'A pixel ID is 15 or 16 digits',
    });
  }
  return {
    async send(events, options = {}) {
      const json = await graph(f, token, `${pixelId}/events`, {
        method: 'POST',
        body: {
          data: events,
          ...(options.testEventCode ? { test_event_code: options.testEventCode } : {}),
        },
      });
      return { received: Number(json.events_received ?? 0) };
    },
    async check() {
      const json = await graph(f, token, `${pixelId}?fields=id,name`, { method: 'GET' });
      return {
        id: String(json.id ?? pixelId),
        name: typeof json.name === 'string' ? json.name : null,
      };
    },
  };
}

/**
 * A Conversions API that keeps what it was sent, for previews, local runs
 * and tests: connected with the token `fake`, never in production.
 */
export function fakeConversionsApi(sent: CapiEvent[] = []): ConversionsApi & { sent: CapiEvent[] } {
  return {
    sent,
    async send(events) {
      sent.push(...events);
      return { received: events.length };
    },
    async check() {
      return { id: 'fake', name: 'Fake pixel' };
    },
  };
}

/** SHA-256 in hex, as Meta matches hashed customer data. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
