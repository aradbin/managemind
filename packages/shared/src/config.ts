// Worker configuration, validated once per isolate. A bad config fails every
// request with a clear log line naming the bad keys, never their values
// (some are secrets), instead of failing later in some unrelated code path.
import { z } from 'zod';

// Multi-label hostnames, plus "localhost" for local development ({slug}.localhost).
const HOSTNAME =
  /^(?:localhost|(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/;

/** A lowercase hostname without scheme, port or path, e.g. "example.com" or "localhost". */
export const hostname = () =>
  z.string().regex(HOSTNAME, 'must be a lowercase hostname without scheme, port or path');

export const environment = z.enum(['development', 'preview', 'production']);
export type Environment = z.infer<typeof environment>;

/** Settings every Worker shares (phase-0-plan §4.1: names and domains are config). */
export const baseConfig = z.object({
  ENVIRONMENT: environment,
  PLATFORM_NAME: z.string().min(1).max(60),
  PLATFORM_DOMAIN: hostname(),
  STORE_DOMAIN: hostname(),
});

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Invalid Worker configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const cache = new WeakMap<object, unknown>();

/** Parses `env` with `schema`, caching the result per env object (per isolate). */
export function loadConfig<T extends z.ZodType>(schema: T, env: object): z.infer<T> {
  if (cache.has(env)) return cache.get(env) as z.infer<T>;
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  cache.set(env, result.data);
  return result.data;
}
