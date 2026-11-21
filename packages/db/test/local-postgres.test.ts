import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDatabaseLocale } from '../src/migrate';
import { ownerUrl } from './helpers';

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

// Bangla search (phase-3-plan §3.7): under the plain C locale pg_trgm makes no
// trigrams from Bangla text, so every Bangla search finds nothing. This fails
// loudly on such a database instead.
describe('Bangla search', () => {
  const client = new pg.Client({ connectionString: ownerUrl });
  beforeAll(() => client.connect());
  afterAll(() => client.end());

  it('makes trigrams from Bangla text', async () => {
    const { rows } = await client.query<{ n: number }>(
      "select coalesce(array_length(show_trgm('লাল শাড়ি'), 1), 0) as n",
    );
    expect(rows[0]?.n).toBeGreaterThan(0);
  });

  it('folds Bangla spelling variants in app.search_text()', async () => {
    const same = async (a: string, b: string) => {
      const { rows } = await client.query<{ a: string; b: string }>(
        'select app.search_text($1) as a, app.search_text($2) as b',
        [a, b],
      );
      return rows[0]?.a === rows[0]?.b;
    };
    expect(await same('শাড়ী', 'শাড়ি')).toBe(true); // long and short i
    expect(await same('রূপা', 'রুপা')).toBe(true); // long and short u
    expect(await same('শাড়ি', 'শাড়ি')).toBe(true); // precomposed and decomposed ড়
    expect(await same('ক্‍ষ', 'ক্ষ')).toBe(true); // zero-width joiner
    expect(await same('Red SAREE', 'red saree')).toBe(true);
    expect(await same('শাড়ি', 'শাড়া')).toBe(false);
  });

  it('gives Bangla and its Banglish spellings one sound key in app.search_key()', async () => {
    const key = async (text: string) =>
      (await client.query<{ k: string }>('select app.search_key($1) as k', [text])).rows[0]?.k;
    for (const [bangla, ...latin] of [
      ['মসুর ডাল', 'mosur dal', 'moshur daal'],
      ['পেঁয়াজ', 'peyaj', 'piaj'],
      ['ইলিশ মাছ', 'ilish mach', 'ilish maach'],
      ['ঘি', 'ghee'],
      ['জামদানি', 'jamdani'],
    ] as const) {
      for (const spelling of latin) expect(await key(spelling), spelling).toBe(await key(bangla));
    }
    // ড় is written r or d: the key has both.
    expect(await key('কড়াই')).toBe('kri kdi');
    expect(await key('korai')).toBe('kri');
    expect(await key('kadai')).toBe('kdi');
    expect(await key('নন-স্টিক')).toBe(await key('non stick'));
  });

  it('matches every word of a query key at the start of a title key word', async () => {
    const matches = async (title: string, q: string) =>
      (
        await client.query<{ m: boolean }>(
          'select app.search_key_matches(app.search_key($1), app.search_key($2)) as m',
          [title, q],
        )
      ).rows[0]?.m;
    expect(await matches('লাল নন-স্টিক কড়াই', 'kadai')).toBe(true);
    expect(await matches('লাল নন-স্টিক কড়াই', 'korai lal')).toBe(true);
    expect(await matches('লাল নন-স্টিক কড়াই', 'korai nil')).toBe(false);
    // A one- or two-letter word must be the whole word.
    expect(await matches('চাল', 'cha')).toBe(false);
    expect(await matches('চা পাতা', 'cha')).toBe(true);
  });

  it('finds a spelling variant through the trigram index operator', async () => {
    const { rows } = await client.query<{ hit: boolean }>(
      "select app.search_text('শাড়ী') <% app.search_text('লাল জামদানি শাড়ি') as hit",
    );
    expect(rows[0]?.hit).toBe(true);
  });
});

describe('checkDatabaseLocale', () => {
  it('accepts this database and refuses one with the C locale', async () => {
    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    try {
      await expect(checkDatabaseLocale(client)).resolves.toBeUndefined();
      const fake = {
        query: async () => ({ rows: [{ provider: 'c', ctype: 'C', locale: null }] }),
      } as unknown as pg.Client;
      await expect(checkDatabaseLocale(fake)).rejects.toThrow(/no trigrams from Bangla/);
      const builtin = {
        query: async () => ({ rows: [{ provider: 'b', ctype: 'C', locale: 'C.UTF-8' }] }),
      } as unknown as pg.Client;
      await expect(checkDatabaseLocale(builtin)).resolves.toBeUndefined();
    } finally {
      await client.end();
    }
  });
});
