// An in-memory stand-in for Cloudflare for SaaS: tests control each
// hostname's state, and previews (which have no store zone) can add a
// domain and see its pending instructions (phase-3-plan §9).
import type { CustomHostnameProvider, HostnameState } from './types';

export interface FakeHostnames extends CustomHostnameProvider {
  readonly hostnames: Map<string, HostnameState>;
  /** Sets a hostname's state as the next get() or list() reports it. */
  set(hostname: string, patch: Partial<HostnameState>): void;
}

export function fakeHostnames(): FakeHostnames {
  const hostnames = new Map<string, HostnameState>();
  const byRef = (ref: string) => [...hostnames.values()].find((h) => h.ref === ref);
  return {
    hostnames,
    set(hostname, patch) {
      const current = hostnames.get(hostname);
      if (current) hostnames.set(hostname, { ...current, ...patch });
    },
    async create(hostname) {
      const state: HostnameState = {
        ref: `fake-${crypto.randomUUID()}`,
        hostname,
        status: 'pending',
        sslStatus: 'pending_validation',
        // Hostnames under a cf-* label pretend their DNS is on Cloudflare.
        ownership: hostname.split('.').some((label) => label.startsWith('cf-'))
          ? { type: 'TXT', name: `_cf-custom-hostname.${hostname}`, value: crypto.randomUUID() }
          : null,
        errors: [],
      };
      hostnames.set(hostname, state);
      return { ...state };
    },
    async get(ref) {
      const state = byRef(ref);
      return state ? { ...state } : null;
    },
    async delete(ref) {
      const state = byRef(ref);
      if (state) hostnames.delete(state.hostname);
    },
    async list() {
      return [...hostnames.values()].map((h) => ({ ...h }));
    },
  };
}

/**
 * Previews and local development, which have no store zone: every domain
 * stays pending, so the admin's instructions can be tried, and nothing is
 * kept between requests.
 */
export function pendingHostnames(): CustomHostnameProvider {
  const pending = (ref: string, hostname: string): HostnameState => ({
    ref,
    hostname,
    status: 'pending',
    sslStatus: 'pending_validation',
    ownership: null,
    errors: [],
  });
  return {
    create: async (hostname) => pending(`preview-${crypto.randomUUID()}`, hostname),
    get: async (ref) => pending(ref, ''),
    delete: async () => {},
    list: async () => [],
  };
}
