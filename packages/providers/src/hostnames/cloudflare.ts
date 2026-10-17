// Cloudflare for SaaS custom hostnames on the store zone (ADR 0019), with
// HTTP certificate validation: once the client's CNAME points at our
// fallback origin, Cloudflare validates and issues the certificate itself.
// Needs a token with SSL and Certificates: Edit on the store zone.
import type { CustomHostnameProvider, DnsRecord, HostnameState } from './types';

interface CfHostname {
  id: string;
  hostname: string;
  status?: string;
  ssl?: { status?: string; validation_errors?: { message?: string }[] };
  ownership_verification?: { type?: string; name?: string; value?: string };
  verification_errors?: string[];
}

interface Envelope<T> {
  success: boolean;
  errors?: { code?: number; message?: string }[];
  result: T;
  result_info?: { page: number; total_pages: number };
}

export class CloudflareHostnameError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CloudflareHostnameError';
  }
}

const STATUSES = ['pending', 'active', 'blocked', 'deleted'] as const;

function toState(h: CfHostname): HostnameState {
  const own = h.ownership_verification;
  const ownership: DnsRecord | null =
    own?.type === 'txt' && own.name && own.value
      ? { type: 'TXT', name: own.name, value: own.value }
      : null;
  return {
    ref: h.id,
    hostname: h.hostname,
    status: STATUSES.find((s) => s === h.status) ?? 'unknown',
    sslStatus: h.ssl?.status ?? 'unknown',
    ownership,
    errors: [
      ...(h.verification_errors ?? []),
      ...(h.ssl?.validation_errors ?? []).map((e) => e.message ?? '').filter(Boolean),
    ],
  };
}

export function cloudflareHostnames(options: {
  zoneId: string;
  token: string;
  fetcher?: typeof fetch;
}): CustomHostnameProvider {
  const base = `https://api.cloudflare.com/client/v4/zones/${options.zoneId}/custom_hostnames`;
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: Envelope<T> | null }> => {
    const res = await (options.fetcher ?? fetch)(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!res.ok && res.status !== 404) {
      const message = data?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
      throw new CloudflareHostnameError(res.status, message);
    }
    return { status: res.status, data };
  };

  return {
    async create(hostname) {
      const { data } = await call<CfHostname>('POST', '', {
        hostname,
        ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
      });
      if (!data?.result) throw new CloudflareHostnameError(502, 'no hostname in the response');
      return toState(data.result);
    },
    async get(ref) {
      const { status, data } = await call<CfHostname>('GET', `/${encodeURIComponent(ref)}`);
      return status === 404 || !data?.result ? null : toState(data.result);
    },
    async delete(ref) {
      await call('DELETE', `/${encodeURIComponent(ref)}`);
    },
    async list() {
      const all: HostnameState[] = [];
      for (let page = 1; page <= 100; page++) {
        const { data } = await call<CfHostname[]>('GET', `?per_page=50&page=${page}`);
        all.push(...(data?.result ?? []).map(toState));
        if (!data?.result_info || page >= data.result_info.total_pages) break;
      }
      return all;
    },
  };
}
