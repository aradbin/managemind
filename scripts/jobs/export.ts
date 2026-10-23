// A store's export (phase-5b-plan §3.10), run by the tenant-jobs workflow:
// every store table as JSON lines in the order a later import inserts them,
// spreadsheets for the lists a person opens, the store's platform rows, and
// its files from R2, with a manifest of counts and SHA-256s. The zip goes to
// exports/<tenant>/<job>.zip, which the R2 rule deletes after 7 days.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrationsFolder } from '@managemind/db/migrate';
import { STORE_TABLES } from '@managemind/db/registry';
import { type Zippable, zipSync } from 'fflate';
import type pg from 'pg';

/** Where the files live: R2 through Cloudflare's API, or memory in tests. */
export interface ObjectStore {
  list(prefix: string): AsyncIterable<{ key: string; size: number }>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

/** Store tables left out, with why; the manifest lists them. */
export const OMITTED: Partial<Record<(typeof STORE_TABLES)[number], string>> = {
  provider_credentials: 'sealed secrets, readable only by the platform; enter them again',
  shopper_sessions: 'sign-in sessions',
  shopper_verifications: 'one-time sign-in codes',
  push_subscriptions: 'staff devices’ push keys',
  idempotency_keys: 'short-lived request records',
  outbox: 'events already delivered',
};

/** The lists a person opens in a spreadsheet. */
export const CSV_TABLES = [
  'products',
  'variants',
  'customers',
  'orders',
  'order_lines',
  'payments',
  'refunds',
  'returns',
] as const;

/** The store's own platform rows; staff sign-in data stays out. */
const PLATFORM_QUERIES: Record<string, string> = {
  tenant: `select row_to_json(t)::text as j from platform.tenants t where id = $1`,
  domains: `select row_to_json(t)::text as j from platform.tenant_domains t where tenant_id = $1`,
  members: `select json_build_object('name', u.name, 'email', u.email, 'role', m.role,
              'createdAt', m.created_at)::text as j
              from platform.memberships m join platform.users u on u.id = m.user_id
             where m.tenant_id = $1 order by m.created_at`,
  subscription: `select row_to_json(t)::text as j from platform.subscriptions t where tenant_id = $1`,
  invoices: `select row_to_json(t)::text as j from platform.invoices t
              where tenant_id = $1 and status <> 'draft' order by created_at`,
  invoice_lines: `select row_to_json(l)::text as j from platform.invoice_lines l
                    join platform.invoices i on i.id = l.invoice_id
                   where i.tenant_id = $1 and i.status <> 'draft' order by i.created_at, l.position`,
  billing_payments: `select row_to_json(t)::text as j from platform.billing_payments t
                      where tenant_id = $1 order by created_at`,
  terms_acceptances: `select row_to_json(t)::text as j from platform.terms_acceptances t
                       where tenant_id = $1 order by accepted_at`,
};

const BATCH = 1000;
/** Images and other files that are already compressed. */
const STORED = /\.(jpe?g|png|webp|avif|gif|zip|pdf)$/i;

export interface ExportProgress {
  step: 'tables' | 'platform' | 'files' | 'upload';
  done: number;
  total: number;
}

export interface ExportResult {
  fileKey: string;
  bytes: number;
  sha256: string;
  tables: Record<string, number>;
  files: number;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const encoder = new TextEncoder();

/** The last migration the database has, by the journal's tag (0035_phase_5b_grants). */
async function schemaVersion(client: pg.Client): Promise<string> {
  const { rows } = await client.query<{ created_at: string }>(
    'select created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1',
  );
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as {
    entries: { tag: string; when: number }[];
  };
  const when = Number(rows[0]?.created_at);
  return journal.entries.find((e) => e.when === when)?.tag ?? `unknown (${when})`;
}

/** Reads a query's JSON rows a batch at a time, through a cursor in one transaction. */
async function* rowsOf(
  client: pg.Client,
  query: string,
  params: unknown[],
): AsyncGenerator<string> {
  await client.query('begin read only');
  try {
    await client.query(`declare export_rows no scroll cursor for ${query}`, params);
    for (;;) {
      const { rows } = await client.query<{ j: string }>(`fetch ${BATCH} from export_rows`);
      for (const r of rows) yield r.j;
      if (rows.length < BATCH) break;
    }
    await client.query('close export_rows');
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  }
}

/** A spreadsheet cell: objects as JSON, quotes doubled, and no formula a sheet would run. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [columns.map(cell).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(','));
  // A BOM so spreadsheet apps read Bangla as UTF-8.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * Builds the export and uploads it. Read-only on the database, so a
 * stopped export simply runs again from the start.
 */
export async function exportStore(
  client: pg.Client,
  files: ObjectStore,
  tenantId: string,
  jobId: string,
  onProgress: (p: ExportProgress) => Promise<void> = async () => {},
  now = new Date(),
): Promise<ExportResult> {
  const zip: Zippable = {};
  const entries: Record<string, { bytes: number; sha256: string }> = {};
  const add = (path: string, data: Uint8Array) => {
    zip[path] = STORED.test(path) ? [data, { level: 0 }] : data;
    entries[path] = { bytes: data.byteLength, sha256: sha256(data) };
  };

  const { rows: stores } = await client.query<{ slug: string; name: string }>(
    'select slug, name from platform.tenants where id = $1',
    [tenantId],
  );
  const store = stores[0];
  if (!store) throw new Error(`store ${tenantId} not found`);

  // Store tables, in insert order: the reverse of the purge order.
  const tables: Record<string, number> = {};
  const order = [...STORE_TABLES].reverse().filter((t) => !OMITTED[t]);
  for (const [n, table] of order.entries()) {
    const lines: string[] = [];
    const csv = (CSV_TABLES as readonly string[]).includes(table);
    const parsed: Record<string, unknown>[] = [];
    for await (const j of rowsOf(
      client,
      `select row_to_json(t)::text as j from store."${table}" t where tenant_id = $1`,
      [tenantId],
    )) {
      lines.push(j);
      if (csv) parsed.push(JSON.parse(j) as Record<string, unknown>);
    }
    tables[table] = lines.length;
    add(`tables/${table}.jsonl`, encoder.encode(lines.length ? `${lines.join('\n')}\n` : ''));
    if (csv) add(`csv/${table}.csv`, encoder.encode(toCsv(parsed)));
    await onProgress({ step: 'tables', done: n + 1, total: order.length });
  }

  const platform: Record<string, number> = {};
  for (const [name, query] of Object.entries(PLATFORM_QUERIES)) {
    const { rows } = await client.query<{ j: string }>(query, [tenantId]);
    platform[name] = rows.length;
    add(`platform/${name}.jsonl`, encoder.encode(rows.map((r) => `${r.j}\n`).join('')));
  }
  await onProgress({ step: 'platform', done: 1, total: 1 });

  // The store's files, as they are in R2 under tenants/<id>/.
  const prefix = `tenants/${tenantId}/`;
  const keys: string[] = [];
  for await (const o of files.list(prefix)) keys.push(o.key);
  let fileCount = 0;
  for (const [n, key] of keys.entries()) {
    const body = await files.get(key);
    if (body) {
      add(`files/${key.slice(prefix.length)}`, body);
      fileCount++;
    }
    if ((n + 1) % 50 === 0 || n + 1 === keys.length) {
      await onProgress({ step: 'files', done: n + 1, total: keys.length });
    }
  }

  const manifest = {
    format: 'managemind-store-export',
    version: 1,
    store: { id: tenantId, slug: store.slug, name: store.name },
    job: jobId,
    exportedAt: now.toISOString(),
    schema: await schemaVersion(client),
    /** Insert in this order; delete in the reverse. */
    tableOrder: order,
    tables,
    platform,
    omitted: OMITTED,
    files: entries,
  };
  zip['manifest.json'] = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const body = zipSync(zip, { level: 6 });

  await onProgress({ step: 'upload', done: 0, total: 1 });
  const fileKey = `exports/${tenantId}/${jobId}.zip`;
  await files.put(fileKey, body, 'application/zip');
  return { fileKey, bytes: body.byteLength, sha256: sha256(body), tables, files: fileCount };
}
