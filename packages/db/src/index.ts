import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema/index';

export { schema };
export type Db = NodePgDatabase<typeof schema>;

/**
 * The only way to build a Drizzle instance: column names are snake_case in
 * the database (drizzle-kit `casing`), so the runtime needs the same setting.
 */
export function createDb(client: pg.Client | pg.PoolClient): Db {
  return drizzle(client, { schema, casing: 'snake_case' });
}
