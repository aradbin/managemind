// Custom hostnames (phase-3-plan §3.9): a store's own domain served by our
// store zone with Cloudflare for SaaS. Behind an interface, so tests and
// previews use a fake and the core never sees Cloudflare's API.

/** A DNS record the client adds at their DNS provider. */
export interface DnsRecord {
  type: 'CNAME' | 'TXT';
  name: string;
  value: string;
}

export interface HostnameState {
  /** The provider's ID for the hostname. */
  ref: string;
  hostname: string;
  /** Whether traffic for the hostname is accepted. */
  status: 'pending' | 'active' | 'blocked' | 'deleted' | 'unknown';
  /** The certificate's state, as the provider names it (pending_validation, active, …). */
  sslStatus: string;
  /** Only when the client's DNS is itself on Cloudflare: the ownership TXT record. */
  ownership: DnsRecord | null;
  /** What the provider says is wrong, if anything. */
  errors: string[];
}

export interface CustomHostnameProvider {
  create(hostname: string): Promise<HostnameState>;
  /** Null when the provider no longer knows the hostname. */
  get(ref: string): Promise<HostnameState | null>;
  /** Deleting a hostname that is already gone succeeds. */
  delete(ref: string): Promise<void>;
  /** Every hostname on the zone (the daily re-check: one call per page of 50). */
  list(): Promise<HostnameState[]>;
}

/** The hostname state is live: traffic accepted and the certificate issued. */
export const isLive = (state: HostnameState): boolean =>
  state.status === 'active' && state.sslStatus === 'active';
