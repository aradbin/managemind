// Worker bindings and the validated configuration derived from them.
import type { OutboxEvent } from '@managemind/core';
import { baseConfig, loadConfig } from '@managemind/shared/config';
import { z } from 'zod';

export interface Env {
  /** Neon through Hyperdrive, as the mm_app role (ADR 0002, ADR 0009). */
  HYPERDRIVE: Hyperdrive;
  /** Outbox events, relayed after commit (ADR 0010). */
  OUTBOX: Queue<OutboxEvent>;
  ENVIRONMENT: string;
  PLATFORM_NAME: string;
  PLATFORM_DOMAIN: string;
  STORE_DOMAIN: string;
  /** Git commit of the deployed build, set by CI. */
  COMMIT_SHA?: string;
  /** Share of successful requests to log, 0 to 1 (errors are always logged). */
  LOG_SAMPLE_RATE?: string;
}

export const apiConfig = baseConfig.extend({
  COMMIT_SHA: z.string().default('dev'),
  LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
});
export type ApiConfig = z.infer<typeof apiConfig>;

export const getConfig = (env: Env): ApiConfig => loadConfig(apiConfig, env);

export interface Variables {
  requestId: string;
  config: ApiConfig;
  tenantId?: string;
  userId?: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
