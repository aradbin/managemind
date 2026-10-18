// A Turnstile widget's hostname list (phase-4-plan §3.15): custom domains are
// added when they become active and removed when they go. One GET and at
// most one PUT through Cloudflare's API; a free widget holds 10 hostnames
// (no wildcards; a hostname also covers its subdomains), and a PUT past the
// limit is refused, which the caller records.

export interface TurnstileWidgetProvider {
  /** The hostnames the widget allows now. */
  hostnames(): Promise<string[]>;
  /** Replaces the list; false when Cloudflare refuses it (over the limit). */
  setHostnames(hostnames: string[]): Promise<boolean>;
}

interface Widget {
  sitekey: string;
  name: string;
  mode: string;
  domains: string[];
  region?: string;
  bot_fight_mode?: boolean;
  clearance_level?: string;
}

interface Envelope<T> {
  success: boolean;
  errors?: { code?: number; message?: string }[];
  result: T;
}

export class TurnstileApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TurnstileApiError';
  }
}

export function cloudflareTurnstileWidget(options: {
  accountId: string;
  siteKey: string;
  token: string;
  fetcher?: typeof fetch;
}): TurnstileWidgetProvider {
  const url = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/challenges/widgets/${options.siteKey}`;
  const fetcher = options.fetcher ?? fetch;
  const headers = {
    authorization: `Bearer ${options.token}`,
    'content-type': 'application/json',
  };
  const get = async (): Promise<Widget> => {
    const res = await fetcher(url, { headers });
    const body = (await res.json().catch(() => null)) as Envelope<Widget> | null;
    if (!res.ok || !body?.success) {
      throw new TurnstileApiError(res.status, body?.errors?.[0]?.message ?? `HTTP ${res.status}`);
    }
    return body.result;
  };
  return {
    async hostnames() {
      return (await get()).domains;
    },
    async setHostnames(hostnames) {
      const widget = await get();
      const res = await fetcher(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: widget.name,
          mode: widget.mode,
          domains: hostnames,
          ...(widget.region ? { region: widget.region } : {}),
          ...(widget.bot_fight_mode === undefined ? {} : { bot_fight_mode: widget.bot_fight_mode }),
          ...(widget.clearance_level ? { clearance_level: widget.clearance_level } : {}),
        }),
      });
      if (res.status === 400) return false;
      const body = (await res.json().catch(() => null)) as Envelope<Widget> | null;
      if (!res.ok || !body?.success) {
        throw new TurnstileApiError(res.status, body?.errors?.[0]?.message ?? `HTTP ${res.status}`);
      }
      return true;
    },
  };
}

/** A widget in memory, for tests and local development. */
export function fakeTurnstileWidget(
  initial: string[],
  limit = 10,
): TurnstileWidgetProvider & {
  list: string[];
} {
  const state = { list: [...initial] };
  return {
    get list() {
      return state.list;
    },
    async hostnames() {
      return [...state.list];
    },
    async setHostnames(hostnames) {
      if (hostnames.length > limit) return false;
      state.list = [...hostnames];
      return true;
    },
  };
}
