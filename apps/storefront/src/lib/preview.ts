import { env } from 'cloudflare:workers';

/** Who may frame preview pages (and send them theme changes): the admin, and locally its dev servers. */
export function previewParents(): string[] {
  if (env.ENVIRONMENT === 'development') return ['http://localhost:8787', 'http://localhost:5173'];
  return env.ADMIN_HOST ? [`https://${env.ADMIN_HOST}`] : [];
}
