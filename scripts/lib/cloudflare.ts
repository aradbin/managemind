// The few Cloudflare API calls the deploy, preview, platform and zone scripts need.
import { type ApiClient, apiClient, HttpError, sleep } from './http';

interface Envelope<T> {
  result: T;
}
export interface HyperdriveConfig {
  id: string;
  name: string;
}
export interface LifecycleRule {
  id: string;
  /** Key prefix; "" for every object. */
  prefix: string;
  deleteAfterDays?: number;
  abortUploadsAfterDays?: number;
}
export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
}
export interface WafRule {
  ref: string;
  description: string;
  expression: string;
  action: 'block' | 'managed_challenge' | 'skip';
  enabled?: boolean;
}
export interface Origin {
  host: string;
  database: string;
  user: string;
  password: string;
}

export class Cloudflare {
  private readonly api: ApiClient;
  constructor(
    token: string,
    private readonly accountId: string,
  ) {
    this.api = apiClient('https://api.cloudflare.com/client/v4', token, 'Cloudflare');
  }

  private get account() {
    return `/accounts/${this.accountId}`;
  }

  private async get<T>(path: string): Promise<T> {
    return (await this.api.request<Envelope<T>>('GET', `${this.account}${path}`)).result;
  }

  /** The account's workers.dev subdomain, e.g. "example" in example.workers.dev. */
  async workersSubdomain(): Promise<string> {
    return (await this.get<{ subdomain: string }>('/workers/subdomain')).subdomain;
  }

  async findHyperdrive(name: string): Promise<HyperdriveConfig | undefined> {
    return (await this.get<HyperdriveConfig[]>('/hyperdrive/configs')).find((c) => c.name === name);
  }

  /** Caching off: every query must see the current row-level security context (ADR 0002). */
  async createHyperdrive(name: string, origin: Origin): Promise<HyperdriveConfig> {
    const res = await this.api.request<Envelope<HyperdriveConfig>>(
      'POST',
      `${this.account}/hyperdrive/configs`,
      {
        name,
        origin: { ...origin, port: 5432, scheme: 'postgres' },
        caching: { disabled: true },
      },
    );
    return res.result;
  }

  /** Replaces the origin, e.g. after rotating the role's password. */
  async updateHyperdrive(id: string, origin: Origin): Promise<void> {
    await this.api.request('PATCH', `${this.account}/hyperdrive/configs/${id}`, {
      origin: { ...origin, port: 5432, scheme: 'postgres' },
    });
  }

  async deleteHyperdrive(id: string): Promise<void> {
    await this.ignore404(() =>
      this.api.request('DELETE', `${this.account}/hyperdrive/configs/${id}`),
    );
  }

  async ensureQueue(name: string): Promise<void> {
    const queues = await this.get<{ queue_name: string }[]>(
      `/queues?name=${encodeURIComponent(name)}`,
    );
    if (queues.some((q) => q.queue_name === name)) return;
    await this.api.request('POST', `${this.account}/queues`, { queue_name: name });
  }

  /** A queue by name, with its consumers, or undefined. */
  private async findQueue(
    name: string,
  ): Promise<{ queue_id: string; consumers?: { consumer_id: string }[] } | undefined> {
    const queues = await this.get<
      { queue_id: string; queue_name: string; consumers?: { consumer_id: string }[] }[]
    >(`/queues?name=${encodeURIComponent(name)}`);
    return queues.find((q) => q.queue_name === name);
  }

  /**
   * Detaches a queue's consumers. Cloudflare won't delete a Worker that
   * consumes a queue, nor a queue that a Worker still binds, so a closed
   * PR's queues are detached, then its API Worker deleted, then the queues.
   */
  async detachQueueConsumers(name: string): Promise<void> {
    const found = await this.findQueue(name);
    for (const consumer of found?.consumers ?? []) {
      await this.ignore404(() =>
        this.api.request(
          'DELETE',
          `${this.account}/queues/${found?.queue_id}/consumers/${consumer.consumer_id}`,
        ),
      );
    }
  }

  /** Deletes a queue if it exists (a closed PR's import queues). */
  async deleteQueue(name: string): Promise<boolean> {
    const found = await this.findQueue(name);
    if (!found) return false;
    // A just-deleted Worker's binding takes a moment to go: until it has, the
    // delete is refused.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.ignore404(() =>
          this.api.request('DELETE', `${this.account}/queues/${found.queue_id}`),
        );
        return true;
      } catch (e) {
        if (attempt >= 5) throw e;
        await sleep(2000 * attempt);
      }
    }
  }

  async queueId(name: string): Promise<string> {
    const queues = await this.get<{ queue_id: string; queue_name: string }[]>(
      `/queues?name=${encodeURIComponent(name)}`,
    );
    const found = queues.find((q) => q.queue_name === name);
    if (!found) throw new Error(`queue ${name} not found`);
    return found.queue_id;
  }

  /** Sends JSON messages to a queue, at most 100 per call. */
  async sendToQueue(queueId: string, bodies: readonly unknown[]): Promise<void> {
    for (let i = 0; i < bodies.length; i += 100) {
      await this.api.request('POST', `${this.account}/queues/${queueId}/messages/batch`, {
        messages: bodies.slice(i, i + 100).map((body) => ({ body, content_type: 'json' })),
      });
    }
  }

  async kvPutMany(
    namespaceId: string,
    entries: readonly { key: string; value: string }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.api.request(
      'PUT',
      `${this.account}/storage/kv/namespaces/${namespaceId}/bulk`,
      entries,
    );
  }

  async kvDeleteMany(namespaceId: string, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.api.request(
      'POST',
      `${this.account}/storage/kv/namespaces/${namespaceId}/bulk/delete`,
      keys,
    );
  }

  /** Returns the namespace ID, creating the namespace if needed. */
  async ensureKvNamespace(title: string): Promise<string> {
    const namespaces = await this.get<{ id: string; title: string }[]>(
      '/storage/kv/namespaces?per_page=100',
    );
    const found = namespaces.find((n) => n.title === title);
    if (found) return found.id;
    const res = await this.api.request<Envelope<{ id: string }>>(
      'POST',
      `${this.account}/storage/kv/namespaces`,
      { title },
    );
    return res.result.id;
  }

  /** Creates the bucket near Singapore if needed, then replaces its lifecycle rules. */
  async ensureBucket(name: string, rules: LifecycleRule[]): Promise<void> {
    try {
      await this.get(`/r2/buckets/${name}`);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
      await this.api.request('POST', `${this.account}/r2/buckets`, { name, locationHint: 'apac' });
    }
    await this.api.request('PUT', `${this.account}/r2/buckets/${name}/lifecycle`, {
      rules: rules.map((r) => ({
        id: r.id,
        enabled: true,
        conditions: { prefix: r.prefix },
        ...(r.deleteAfterDays
          ? {
              deleteObjectsTransition: {
                condition: { type: 'Age', maxAge: r.deleteAfterDays * 86_400 },
              },
            }
          : {}),
        ...(r.abortUploadsAfterDays
          ? {
              abortMultipartUploadsTransition: {
                condition: { type: 'Age', maxAge: r.abortUploadsAfterDays * 86_400 },
              },
            }
          : {}),
      })),
    });
  }

  async deleteWorker(name: string): Promise<void> {
    await this.ignore404(() =>
      this.api.request('DELETE', `${this.account}/workers/scripts/${name}?force=true`),
    );
  }

  /** GraphQL Analytics, scoped to this account (`$acct` is filled in). */
  async analytics<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.api.request<{ data: T | null; errors?: { message: string }[] }>(
      'POST',
      '/graphql',
      { query, variables: { acct: this.accountId, ...variables } },
    );
    if (res.errors?.length || !res.data) {
      throw new Error(`Cloudflare GraphQL: ${res.errors?.map((e) => e.message).join('; ')}`);
    }
    return res.data;
  }

  /** Workers Logs aggregates for one Worker over [from, to] (epoch ms). */
  async workerLogStats(
    service: string,
    from: number,
    to: number,
    calculations: { operator: string; key?: string; alias: string }[],
    groupBy?: string,
    /** Extra string-equality filters, such as one `$metadata.trigger`. */
    where: Record<string, string> = {},
  ): Promise<
    { alias: string; aggregates: { groupKey?: string; value: number; count: number }[] }[]
  > {
    const res = await this.api.request<
      Envelope<{
        calculations?: {
          alias: string;
          aggregates: { groupKey?: string; value: number; count: number }[];
        }[];
      }>
    >('POST', `${this.account}/workers/observability/telemetry/query`, {
      queryId: 'usage-alarm',
      timeframe: { from, to },
      view: 'calculations',
      parameters: {
        calculations: calculations.map((c) => ({
          ...c,
          ...(c.key ? { keyType: 'number' } : {}),
        })),
        ...(groupBy ? { groupBys: [{ type: 'string', value: groupBy }] } : {}),
        filters: [
          { key: '$metadata.service', operation: 'eq', value: service, type: 'string' },
          ...Object.entries(where).map(([key, value]) => ({
            key,
            operation: 'eq',
            value,
            type: 'string',
          })),
        ],
      },
    });
    return res.result.calculations ?? [];
  }

  /** A zone's ID by name (zones aren't account-scoped in the API). */
  async zoneId(name: string): Promise<string> {
    const res = await this.api.request<Envelope<{ id: string }[]>>(
      'GET',
      `/zones?name=${encodeURIComponent(name)}`,
    );
    const zone = res.result[0];
    if (!zone) throw new Error(`zone ${name} is not on this Cloudflare account`);
    return zone.id;
  }

  async dnsRecords(zoneId: string, name: string, type?: string): Promise<DnsRecord[]> {
    const query = `name=${encodeURIComponent(name)}${type ? `&type=${type}` : ''}`;
    return (
      await this.api.request<Envelope<DnsRecord[]>>('GET', `/zones/${zoneId}/dns_records?${query}`)
    ).result;
  }

  /**
   * A proxied placeholder (AAAA 100::) so a Workers route on `name` gets
   * traffic. Leaves an existing proxied record alone; returns what it did.
   */
  async ensureRoutePlaceholder(
    zoneId: string,
    name: string,
  ): Promise<'created' | 'proxied' | 'kept'> {
    const existing = (await this.dnsRecords(zoneId, name)).find((r) =>
      ['A', 'AAAA', 'CNAME'].includes(r.type),
    );
    if (existing?.proxied) return 'kept';
    if (existing) {
      await this.api.request('PATCH', `/zones/${zoneId}/dns_records/${existing.id}`, {
        proxied: true,
      });
      return 'proxied';
    }
    await this.api.request('POST', `/zones/${zoneId}/dns_records`, {
      type: 'AAAA',
      name,
      content: '100::',
      proxied: true,
      comment: 'Workers route placeholder (scripts/production/zones.ts)',
    });
    return 'created';
  }

  /** The zone's "Block AI bots" setting. */
  async blockAiBots(zoneId: string): Promise<void> {
    await this.api.request('PUT', `/zones/${zoneId}/bot_management`, {
      ai_bots_protection: 'block',
    });
  }

  /**
   * Puts one WAF custom rule (by `ref`) into the zone's custom-rules entry
   * point, keeping every other rule as it is.
   */
  async ensureWafRule(zoneId: string, rule: WafRule): Promise<void> {
    const path = `/zones/${zoneId}/rulesets/phases/http_request_firewall_custom/entrypoint`;
    let rules: (WafRule & { id?: string })[] = [];
    try {
      rules =
        (await this.api.request<Envelope<{ rules?: WafRule[] }>>('GET', path)).result.rules ?? [];
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
    const others = rules.filter((r) => r.ref !== rule.ref).map(({ id: _id, ...r }) => r);
    await this.api.request('PUT', path, { rules: [...others, { ...rule, enabled: true }] });
  }

  private async ignore404(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
  }
}
