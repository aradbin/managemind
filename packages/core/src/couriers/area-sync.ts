// The couriers' own area lists, and our areas matched to them (phase-7-plan
// §3.6). The weekly job (scripts/couriers) stores each list and matches by
// name within a district; super admins review what it couldn't match. The
// lists are the same for every merchant, so this is platform data in `ref`.
import { AppError } from '@managemind/shared';
import type { AreaCourier } from '@managemind/shared/orders';
import { sql } from 'drizzle-orm';
import { type Actor, requirePlatformRole } from '../access';
import { type PlatformTx, recordPlatformAudit } from '../platform';
import type { DbClient } from '../tenant';

export interface CourierPlaceRow {
  kind: 'city' | 'zone' | 'area';
  externalId: number;
  parentId: number | null;
  name: string;
  nameBn?: string | null;
  districtName?: string | null;
  postCode?: string | null;
}

/** District spellings couriers use for ours (the 2018 renaming, and common variants). */
const DISTRICT_ALIASES: Record<string, string> = {
  chittagong: 'chattogram',
  comilla: 'cumilla',
  barisal: 'barishal',
  jessore: 'jashore',
  bogra: 'bogura',
  chapainawabganj: 'chapainawabganj',
  nawabganj: 'chapainawabganj',
  moulvibazar: 'maulvibazar',
  netrokona: 'netrakona',
  jhalakati: 'jhalokati',
  coxsbazaar: 'coxsbazar',
};

/** A name for matching: lower case letters only, without words that only qualify it. */
export function placeKey(name: string): string {
  const plain = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(sadar|thana|upazila|upazilla|city|metro|model|police station|ps)\b/g, '')
    .replace(/[^a-z]/g, '');
  return DISTRICT_ALIASES[plain] ?? plain;
}

/**
 * Stores one courier's list, as fetched now. Places it no longer lists are
 * retired, never deleted: bookings and matches point at them.
 */
export async function storeCourierPlaces(
  client: DbClient,
  courier: AreaCourier,
  places: AsyncIterable<CourierPlaceRow> | Iterable<CourierPlaceRow>,
): Promise<{ stored: number; retired: number }> {
  const started = (await client.query<{ now: Date }>('select now()')).rows[0]?.now as Date;
  let stored = 0;
  for await (const p of places) {
    await client.query(
      `insert into ref.courier_areas
         (courier, kind, external_id, parent_id, name, name_bn, district_name, post_code, active, fetched_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true, clock_timestamp())
       on conflict (courier, kind, external_id) do update
         set parent_id = excluded.parent_id, name = excluded.name, name_bn = excluded.name_bn,
             district_name = excluded.district_name, post_code = excluded.post_code,
             active = true, fetched_at = excluded.fetched_at`,
      [
        courier,
        p.kind,
        p.externalId,
        p.parentId,
        p.name.slice(0, 200),
        p.nameBn ?? null,
        p.districtName ?? null,
        p.postCode ?? null,
      ],
    );
    stored++;
  }
  // An empty answer is a courier problem, not a list with nothing in it.
  if (stored === 0) return { stored, retired: 0 };
  const retired = await client.query(
    `update ref.courier_areas set active = false
      where courier = $1 and active and fetched_at < $2`,
    [courier, started],
  );
  return { stored, retired: retired.rowCount ?? 0 };
}

/**
 * Matches our areas that have no match yet by name within the district:
 * Pathao's zone under the city named like our district, or RedX's area in
 * our district. Only a single candidate is taken; manual matches are never
 * touched.
 */
export async function matchCourierAreas(client: DbClient, courier: AreaCourier): Promise<number> {
  const ours = await client.query<{ id: number; name: string; district: string }>(
    `
    select a.id, a.name_en as name, d.name_en as district
      from ref.areas a join ref.districts d on d.id = a.district_id
     where a.active
       and not exists (select 1 from ref.courier_area_map m where m.area_id = a.id and m.courier = $1)`,
    [courier],
  );
  const places = await client.query<{
    external_id: number;
    name: string;
    district: string | null;
  }>(
    courier === 'pathao'
      ? `select z.external_id, z.name, c.name as district
           from ref.courier_areas z
           join ref.courier_areas c on c.courier = z.courier and c.kind = 'city' and c.external_id = z.parent_id
          where z.courier = 'pathao' and z.kind = 'zone' and z.active`
      : `select external_id, name, district_name as district
           from ref.courier_areas where courier = 'redx' and kind = 'area' and active`,
  );
  const byKey = new Map<string, number[]>();
  for (const p of places.rows) {
    if (!p.district) continue;
    const key = `${placeKey(p.district)}/${placeKey(p.name)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), p.external_id]);
  }
  const kind = courier === 'pathao' ? 'zone' : 'area';
  let matched = 0;
  for (const a of ours.rows) {
    const found = byKey.get(`${placeKey(a.district)}/${placeKey(a.name)}`);
    if (found?.length !== 1) continue;
    await client.query(
      `insert into ref.courier_area_map (area_id, courier, kind, external_id, match)
       values ($1, $2, $3, $4, 'name') on conflict do nothing`,
      [a.id, courier, kind, found[0]],
    );
    matched++;
  }
  return matched;
}

export interface AreaReviewRow {
  areaId: number;
  name: string;
  district: string;
  match: { externalId: number; name: string; how: string } | null;
  /** The courier's places with the closest names in the district, best first. */
  suggestions: { externalId: number; name: string; parent: string | null }[];
}

/** Platform → Courier areas (§3.6): our areas with their match, the unmatched first. */
export async function courierAreaReview(
  tx: PlatformTx,
  actor: Actor,
  courier: AreaCourier,
  options: { unmatchedOnly: boolean; districtId?: number | undefined },
): Promise<AreaReviewRow[]> {
  requirePlatformRole(actor, 'support');
  const kind = courier === 'pathao' ? 'zone' : 'area';
  const { rows } = await tx.db.execute<{
    id: number;
    name: string;
    district: string;
    external_id: number | null;
    match_name: string | null;
    how: string | null;
    suggestions: AreaReviewRow['suggestions'] | null;
  }>(sql`
    select a.id, a.name_en as name, d.name_en as district, m.external_id, p.name as match_name,
           m.match as how,
           (select json_agg(s) from (
              select c.external_id as "externalId", c.name, par.name as parent
                from ref.courier_areas c
                left join ref.courier_areas par
                  on par.courier = c.courier and par.kind = 'city' and par.external_id = c.parent_id
               where c.courier = ${courier} and c.kind = ${kind} and c.active
               order by similarity(lower(c.name), lower(a.name_en))
                        + similarity(lower(coalesce(par.name, c.district_name, '')), lower(d.name_en)) desc
               limit 3) s) as suggestions
      from ref.areas a
      join ref.districts d on d.id = a.district_id
      left join ref.courier_area_map m on m.area_id = a.id and m.courier = ${courier}
      left join ref.courier_areas p on p.courier = m.courier and p.kind = m.kind and p.external_id = m.external_id
     where a.active
       and (${options.districtId ?? null}::int is null or a.district_id = ${options.districtId ?? null})
       and (not ${options.unmatchedOnly} or m.area_id is null)
     order by (m.area_id is null) desc, d.name_en, a.name_en
     limit 200`);
  return rows.map((r) => ({
    areaId: r.id,
    name: r.name,
    district: r.district,
    match:
      r.external_id !== null
        ? { externalId: r.external_id, name: r.match_name ?? '', how: r.how ?? 'name' }
        : null,
    suggestions: r.suggestions ?? [],
  }));
}

/** A super admin's match, which the weekly job never overwrites. Audited. */
export async function setCourierAreaMatch(
  tx: PlatformTx,
  actor: Actor,
  courier: AreaCourier,
  areaId: number,
  externalId: number | null,
): Promise<void> {
  requirePlatformRole(actor, 'super_admin');
  const kind = courier === 'pathao' ? 'zone' : 'area';
  if (externalId === null) {
    await tx.db.execute(
      sql`delete from ref.courier_area_map where area_id = ${areaId} and courier = ${courier}`,
    );
  } else {
    const { rows } = await tx.db.execute(sql`
      select 1 from ref.courier_areas
       where courier = ${courier} and kind = ${kind} and external_id = ${externalId} and active`);
    if (!rows.length) throw new AppError('not_found');
    await tx.db.execute(sql`
      insert into ref.courier_area_map (area_id, courier, kind, external_id, match, reviewed_by)
      values (${areaId}, ${courier}, ${kind}, ${externalId}, 'manual', ${actor.userId})
      on conflict (area_id, courier) do update
        set kind = excluded.kind, external_id = excluded.external_id, match = 'manual',
            reviewed_by = excluded.reviewed_by`);
  }
  await recordPlatformAudit(tx, {
    actorType: actor.kind === 'system' ? 'system' : 'platform',
    ...(actor.userId ? { actorId: actor.userId } : {}),
    action: 'courier_area.matched',
    entityType: 'area',
    after: { courier, areaId, externalId },
  });
}
