// Prints the SQL that loads packages/shared/src/geo/bd.json into the ref
// schema, as idempotent upserts. When the dataset changes, generate a custom
// migration (`pnpm db:generate --custom --name geography_<change>`) and paste
// this script's output into it; the geography test compares the two.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../../shared/src/geo/bd.json', import.meta.url));
const geo = JSON.parse(readFileSync(file, 'utf8')) as {
  divisions: { id: number; code: string; en: string; bn: string }[];
  districts: { id: number; divisionId: number; code: string; en: string; bn: string }[];
  areas: {
    id: number;
    districtId: number;
    code: string;
    kind: string;
    en: string;
    bn: string;
    active?: boolean;
  }[];
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const rows = (list: string[]) => list.join(',\n  ');

console.log(`INSERT INTO ref.divisions (id, code, name_bn, name_en) VALUES
  ${rows(geo.divisions.map((d) => `(${d.id}, ${q(d.code)}, ${q(d.bn)}, ${q(d.en)})`))}
ON CONFLICT (id) DO UPDATE SET code = excluded.code, name_bn = excluded.name_bn, name_en = excluded.name_en;
--> statement-breakpoint
INSERT INTO ref.districts (id, division_id, code, name_bn, name_en) VALUES
  ${rows(geo.districts.map((d) => `(${d.id}, ${d.divisionId}, ${q(d.code)}, ${q(d.bn)}, ${q(d.en)})`))}
ON CONFLICT (id) DO UPDATE SET division_id = excluded.division_id, code = excluded.code,
  name_bn = excluded.name_bn, name_en = excluded.name_en;
--> statement-breakpoint
INSERT INTO ref.areas (id, district_id, code, kind, name_bn, name_en, active) VALUES
  ${rows(
    geo.areas.map(
      (a) =>
        `(${a.id}, ${a.districtId}, ${q(a.code)}, ${q(a.kind)}, ${q(a.bn)}, ${q(a.en)}, ${a.active !== false})`,
    ),
  )}
ON CONFLICT (id) DO UPDATE SET district_id = excluded.district_id, code = excluded.code,
  kind = excluded.kind, name_bn = excluded.name_bn, name_en = excluded.name_en, active = excluded.active;`);
