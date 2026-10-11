// Sentry projects (scripts/sentry.json). DSNs are not secrets: Sentry designs
// them to be public, and the admin's ships in its JavaScript.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SentryApp = 'api' | 'storefront' | 'admin';

export interface SentryConfig {
  org: string;
  projects: Record<SentryApp, { slug: string; dsn: string }>;
}

export const sentry = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../sentry.json'), 'utf8'),
) as SentryConfig;
