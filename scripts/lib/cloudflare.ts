// The few Cloudflare API calls the preview workflow needs.
import { type ApiClient, apiClient, HttpError } from './http';

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

  private async ignore404(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
  }
}
