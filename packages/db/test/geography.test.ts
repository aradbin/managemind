// The ref schema (phase-4-plan §3.2): the migration loaded exactly the
// shared dataset, and the app can read it but never change it.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { appUrl, connect, ownerUrl } from './helpers';

const geo = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../shared/src/geo/bd.json', import.meta.url)), 'utf8'),
) as {
  divisions: { id: number }[];
  districts: { id: number }[];
  areas: { id: number; districtId: number; code: string; en: string; bn: string }[];
};

const owner = await connect(ownerUrl);
const app = await connect(appUrl);
afterAll(async () => {
  await owner.end();
  await app.end();
});

describe('ref geography', () => {
  it('holds every division, district and area of the dataset', async () => {
    const count = async (t: string) =>
      Number((await owner.query(`select count(*) as n from ref.${t}`)).rows[0].n);
    expect(await count('divisions')).toBe(geo.divisions.length);
    expect(await count('districts')).toBe(geo.districts.length);
    expect(await count('areas')).toBe(geo.areas.length);
    const { rows } = await owner.query(
      `select id, district_id as "districtId", code, name_en as en, name_bn as bn from ref.areas order by id`,
    );
    expect(rows).toEqual(
      [...geo.areas]
        .sort((a, b) => a.id - b.id)
        .map(({ id, districtId, code, en, bn }) => ({ id, districtId, code, en, bn })),
    );
  });

  // Starting tsx in a child process takes several seconds on a busy runner.
  it('matches what scripts/geo-sql.ts prints (regenerate the migration after a dataset change)', () => {
    const printed = execFileSync('npx', ['tsx', 'scripts/geo-sql.ts'], { encoding: 'utf8' });
    const migrations = fileURLToPath(new URL('../migrations', import.meta.url));
    const latest = execFileSync('sh', ['-c', `cat ${migrations}/*geography*.sql`], {
      encoding: 'utf8',
    });
    expect(latest).toContain(printed.trim());
  }, 30_000);

  it('is readable by the app without a tenant, and not writable', async () => {
    const { rows } = await app.query(
      `select name_en from ref.areas where code = 'dhaka.dhanmondi'`,
    );
    expect(rows).toEqual([{ name_en: 'Dhanmondi' }]);
    await expect(app.query(`update ref.areas set name_en = 'x' where id = 1`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query(`insert into ref.divisions values (99, 'x', 'x', 'x')`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query(`delete from ref.districts`)).rejects.toThrow(/permission denied/);
  });
});
