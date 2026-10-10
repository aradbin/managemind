// The few Neon API calls the preview workflow needs (api/v2).
import { type ApiClient, apiClient, HttpError, sleep } from './http';

export interface Branch {
  id: string;
  name: string;
  default: boolean;
  created_at: string;
}
interface Operation {
  id: string;
  status: string;
}
interface Endpoint {
  id: string;
  host: string;
  type: string;
}

export const DATABASE = 'neondb';
export const OWNER_ROLE = 'neondb_owner';

export class Neon {
  private readonly api: ApiClient;
  constructor(
    token: string,
    private readonly projectId: string,
  ) {
    this.api = apiClient('https://console.neon.tech/api/v2', token, 'Neon');
  }

  private get project() {
    return `/projects/${this.projectId}`;
  }

  /** This billing period's compute (CU-seconds) and the project's branches with their sizes. */
  async usage(): Promise<{ computeSeconds: number; periodStart: string; branchBytes: number }> {
    const { project } = await this.api.request<{
      project: { compute_time_seconds: number; consumption_period_start: string };
    }>('GET', this.project);
    const { branches } = await this.api.request<{ branches: { logical_size?: number }[] }>(
      'GET',
      `${this.project}/branches`,
    );
    return {
      computeSeconds: project.compute_time_seconds,
      periodStart: project.consumption_period_start,
      branchBytes: branches.reduce((sum, b) => sum + (b.logical_size ?? 0), 0),
    };
  }

  async branches(): Promise<Branch[]> {
    const { branches } = await this.api.request<{ branches: Branch[] }>(
      'GET',
      `${this.project}/branches`,
    );
    return branches;
  }

  async findBranch(name: string): Promise<Branch | undefined> {
    return (await this.branches()).find((b) => b.name === name);
  }

  /**
   * Creates `name` from the project's default branch (production: schema and
   * roles, no data yet), with a fixed 0.25 CU compute that suspends when idle.
   */
  async createBranch(name: string): Promise<Branch> {
    const parent = (await this.branches()).find((b) => b.default);
    if (!parent) throw new Error('Neon project has no default branch');
    const created = await this.api.request<{ branch: Branch; operations: Operation[] }>(
      'POST',
      `${this.project}/branches`,
      {
        branch: { name, parent_id: parent.id },
        endpoints: [
          { type: 'read_write', autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 0.25 },
        ],
      },
    );
    await this.settle(created.operations);
    return created.branch;
  }

  async deleteBranch(id: string): Promise<void> {
    try {
      const res = await this.api.request<{ operations: Operation[] }>(
        'DELETE',
        `${this.project}/branches/${id}`,
      );
      await this.settle(res.operations);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
  }

  /**
   * A branch starts with its parent's role passwords. Resetting the owner's
   * password on every new preview branch keeps production's out of previews.
   */
  async resetOwnerPassword(branchId: string): Promise<void> {
    const res = await this.api.request<{ operations: Operation[] }>(
      'POST',
      `${this.project}/branches/${branchId}/roles/${OWNER_ROLE}/reset_password`,
    );
    await this.settle(res.operations);
  }

  /** Direct (unpooled) connection string for the owner role. */
  async ownerUri(branchId: string): Promise<string> {
    const query = new URLSearchParams({
      branch_id: branchId,
      database_name: DATABASE,
      role_name: OWNER_ROLE,
      pooled: 'false',
    });
    const { uri } = await this.api.request<{ uri: string }>(
      'GET',
      `${this.project}/connection_uri?${query}`,
    );
    return uri;
  }

  /** Host of the branch's read-write compute (direct, for Hyperdrive). */
  async host(branchId: string): Promise<string> {
    const { endpoints } = await this.api.request<{ endpoints: Endpoint[] }>(
      'GET',
      `${this.project}/branches/${branchId}/endpoints`,
    );
    const rw = endpoints.find((e) => e.type === 'read_write');
    if (!rw) throw new Error(`branch ${branchId} has no read-write compute`);
    return rw.host;
  }

  /** Waits for the operations a change started; Neon refuses the next change until then. */
  private async settle(operations: Operation[]): Promise<void> {
    for (const op of operations) {
      for (let i = 0; ; i++) {
        const { operation } = await this.api.request<{ operation: Operation }>(
          'GET',
          `${this.project}/operations/${op.id}`,
        );
        if (operation.status === 'finished' || operation.status === 'skipped') break;
        if (operation.status === 'failed' || operation.status === 'error') {
          throw new Error(`Neon operation ${op.id} ${operation.status}`);
        }
        if (i > 120) throw new Error(`Neon operation ${op.id} still ${operation.status}`);
        await sleep(1000);
      }
    }
  }
}
