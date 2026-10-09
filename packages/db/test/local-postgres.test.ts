import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Guards the assumption in ADR 0008: tests run against the same major
// Postgres version as Neon production, including its built-in uuidv7().
const url = process.env.TEST_DATABASE_URL;

describe('test database', () => {
  const client = new pg.Client({ connectionString: url });

  beforeAll(async () => {
    if (!url) {
      throw new Error('TEST_DATABASE_URL is not set; see docs/adr/0008-local-postgres.md');
    }
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('runs Postgres 18 or later', async () => {
    const { rows } = await client.query<{ v: string }>(
      "select current_setting('server_version_num') as v",
    );
    expect(Number(rows[0]?.v)).toBeGreaterThanOrEqual(180000);
  });

  it('generates version 7 UUIDs natively', async () => {
    const { rows } = await client.query<{ id: string }>('select uuidv7()::text as id');
    expect(rows[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
