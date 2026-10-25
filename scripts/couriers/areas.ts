// The couriers' area lists (phase-7-plan §3.6), run weekly by
// .github/workflows/courier-areas.yml with the platform's own courier
// tokens and the migration role. Each list is fetched, stored (places the
// courier dropped are retired), and our unmatched areas are matched by name
// within the district; Platform → Courier areas shows the rest.
//
//   pnpm --filter @managemind/scripts couriers:areas [pathao|redx]
//
// Needs DATABASE_URL_MIGRATIONS (or DATABASE_URL), and for Pathao
// PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME, PATHAO_PASSWORD
// (PATHAO_MODE=sandbox for its sandbox); for RedX REDX_TOKEN (REDX_MODE).
// A courier without its secrets is skipped with a warning.
import { matchCourierAreas, storeCourierPlaces } from '@managemind/core';
import { pathaoCourier, redxCourier } from '@managemind/providers/couriers';
import type { AreaCourier } from '@managemind/shared/orders';
import pg from 'pg';

const env = process.env;
const mode = (v: string | undefined) => (v === 'sandbox' ? 'sandbox' : 'live');

function placesOf(courier: AreaCourier) {
  if (courier === 'pathao') {
    const { PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME, PATHAO_PASSWORD } = env;
    if (!PATHAO_CLIENT_ID || !PATHAO_CLIENT_SECRET || !PATHAO_USERNAME || !PATHAO_PASSWORD) {
      return null;
    }
    return pathaoCourier({
      mode: mode(env.PATHAO_MODE),
      clientId: PATHAO_CLIENT_ID,
      clientSecret: PATHAO_CLIENT_SECRET,
      username: PATHAO_USERNAME,
      password: PATHAO_PASSWORD,
    }).places();
  }
  if (!env.REDX_TOKEN) return null;
  return redxCourier({ mode: mode(env.REDX_MODE), token: env.REDX_TOKEN }).places();
}

export async function syncCourier(client: pg.Client, courier: AreaCourier): Promise<boolean> {
  const places = placesOf(courier);
  if (!places) {
    console.warn(`::warning::${courier}: no platform credentials; its areas were not fetched`);
    return false;
  }
  const { stored, retired } = await storeCourierPlaces(client, courier, places);
  const matched = await matchCourierAreas(client, courier);
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from ref.areas a
      where a.active and not exists
        (select 1 from ref.courier_area_map m where m.area_id = a.id and m.courier = $1)`,
    [courier],
  );
  console.log(
    `${courier}: ${stored} places stored, ${retired} retired, ${matched} areas matched, ${rows[0]?.n ?? 0} left for review`,
  );
  return true;
}

async function main() {
  const url = env.DATABASE_URL_MIGRATIONS ?? env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL_MIGRATIONS or DATABASE_URL');
  const only = process.argv[2];
  const couriers: AreaCourier[] =
    only === 'pathao' || only === 'redx' ? [only] : ['pathao', 'redx'];
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const courier of couriers) await syncCourier(client, courier);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
