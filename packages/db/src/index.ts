import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema/index';

export { schema };
export type Db = NodePgDatabase<typeof schema>;

/**
 * The only way to build a Drizzle instance: column names are snake_case in
 * the database (drizzle-kit `casing`), so the runtime needs the same setting.
 *
 * Built without `schema`: passing it makes Drizzle rebuild its relational
 * query config on every call (about 15% of a signed-in request's CPU, Phase 1
 * report §3), and nothing uses `db.query`. The type keeps the schema so a
 * relational query would at least compile; it would fail at runtime.
 */
export function createDb(client: pg.Client | pg.PoolClient): Db {
  return drizzle(client, { casing: 'snake_case' }) as unknown as Db;
}
