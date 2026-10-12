// The only way to build KV keys and R2 object keys (phase-1-plan §3.2, §4.3),
// so every tenant's data can be found, exported and purged by prefix.
import { isUuid } from './uuid';

declare const kvKeyBrand: unique symbol;
declare const objectKeyBrand: unique symbol;
/** A key built by hostKey or tenantKey; KV wrappers accept nothing else. */
export type KvKey = string & { readonly [kvKeyBrand]: true };
/** An R2 key built by objectKey; R2 wrappers accept nothing else. */
export type ObjectKey = string & { readonly [objectKeyBrand]: true };

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** Lowercase segments of letters, digits, '.', '_' and '-', joined by '/', never '.' or '..'. */
const PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[a-z0-9._-]+(?:\/[a-z0-9._-]+)*$/;
const NAME = /^[a-z0-9._-]+(?::[a-z0-9._-]+)*$/;

function tenant(tenantId: string): string {
  if (!isUuid(tenantId)) throw new TypeError(`Not a tenant ID: ${tenantId}`);
  return tenantId.toLowerCase();
}

/**
 * The host-to-store index entry. The one key shape without a tenant prefix,
 * because the tenant is what the lookup finds; a purge deletes these through
 * the store's hosts.
 */
export function hostKey(hostname: string): KvKey {
  if (!HOSTNAME.test(hostname)) throw new TypeError(`Not a lowercase hostname: ${hostname}`);
  return `host:${hostname}` as KvKey;
}

/** Any other per-store KV entry, e.g. tenantKey(id, 'catalog:version'). */
export function tenantKey(tenantId: string, name: string): KvKey {
  if (!NAME.test(name)) throw new TypeError(`Bad KV key name: ${name}`);
  return `t:${tenant(tenantId)}:${name}` as KvKey;
}

export const OBJECT_KINDS = ['file', 'export', 'tmp-upload'] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

// R2 lifecycle rules match prefixes from the bucket root (exports/ after 7
// days, tmp-uploads/ after 1 day), so those folders come before the tenant.
const ROOT: Record<ObjectKind, string> = {
  file: 'tenants/',
  export: 'exports/tenants/',
  'tmp-upload': 'tmp-uploads/tenants/',
};

/** objectKey('file', id, 'products/ab12.webp') -> 'tenants/<id>/products/ab12.webp'. */
export function objectKey(kind: ObjectKind, tenantId: string, path: string): ObjectKey {
  if (!PATH.test(path)) throw new TypeError(`Bad object path: ${path}`);
  return `${ROOT[kind]}${tenant(tenantId)}/${path}` as ObjectKey;
}

/** Every R2 prefix that holds a store's files, for export and purge. */
export const tenantObjectPrefixes = (tenantId: string): string[] =>
  OBJECT_KINDS.map((kind) => `${ROOT[kind]}${tenant(tenantId)}/`);
