// The couriers' area lists (phase-7-plan §3.6): stored, retired when a
// courier drops them, and our areas matched by name within the district,
// never over a super admin's match.
import { matchCourierAreas, placeKey, storeCourierPlaces } from '@managemind/core';
import { connect, testUrls } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { ownerUrl } = testUrls('managemind_test_scripts');
let client: pg.Client;
beforeAll(async () => {
  client = await connect(ownerUrl);
});
afterAll(() => client.end());

const mapOf = async (courier: string, areaId: number) =>
  (
    await client.query<{ external_id: number; match: string }>(
      'select external_id, match from ref.courier_area_map where courier = $1 and area_id = $2',
      [courier, areaId],
    )
  ).rows[0] ?? null;

describe('names', () => {
  it('match across spellings and qualifiers', () => {
    expect(placeKey('Chittagong')).toBe(placeKey('Chattogram'));
    expect(placeKey('Comilla Sadar')).toBe('cumilla');
    expect(placeKey('Dhanmondi Thana')).toBe(placeKey('Dhanmondi'));
    expect(placeKey("Cox's Bazar")).toBe('coxsbazar');
  });
});

describe('the weekly sync', () => {
  it('stores Pathao’s places, matches Dhanmondi, and retires what Pathao drops', async () => {
    const r = await storeCourierPlaces(client, 'pathao', [
      { kind: 'city', externalId: 1, parentId: null, name: 'Dhaka' },
      { kind: 'zone', externalId: 52, parentId: 1, name: 'Dhanmondi' },
      { kind: 'zone', externalId: 53, parentId: 1, name: 'Old Zone' },
    ]);
    expect(r.stored).toBe(3);
    expect(await matchCourierAreas(client, 'pathao')).toBeGreaterThan(0);
    expect(await mapOf('pathao', 513)).toEqual({ external_id: 52, match: 'name' });

    await storeCourierPlaces(client, 'pathao', [
      { kind: 'city', externalId: 1, parentId: null, name: 'Dhaka' },
      { kind: 'zone', externalId: 52, parentId: 1, name: 'Dhanmondi' },
    ]);
    const { rows } = await client.query<{ active: boolean }>(
      `select active from ref.courier_areas where courier = 'pathao' and external_id = 53`,
    );
    expect(rows[0]?.active).toBe(false);
  });

  it('keeps an empty answer from retiring the list', async () => {
    expect(await storeCourierPlaces(client, 'pathao', [])).toEqual({ stored: 0, retired: 0 });
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from ref.courier_areas where courier = 'pathao' and external_id = 52 and active`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('matches RedX by district, takes only a single candidate, and keeps manual matches', async () => {
    await storeCourierPlaces(client, 'redx', [
      { kind: 'area', externalId: 7, parentId: null, name: 'Dhanmondi', districtName: 'Dhaka' },
      { kind: 'area', externalId: 8, parentId: null, name: 'Mirpur', districtName: 'Dhaka' },
      { kind: 'area', externalId: 9, parentId: null, name: 'Mirpur', districtName: 'Dhaka' },
    ]);
    const { rows } = await client.query<{ id: number }>(
      `select a.id from ref.areas a join ref.districts d on d.id = a.district_id
        where d.code = 'dhaka' and a.name_en ilike 'mirpur%' limit 1`,
    );
    const mirpur = rows[0]?.id as number;
    await client.query(
      `insert into ref.courier_area_map (area_id, courier, kind, external_id, match)
       values (513, 'redx', 'area', 8, 'manual') on conflict (area_id, courier) do update set external_id = 8, match = 'manual'`,
    );
    await matchCourierAreas(client, 'redx');
    expect(await mapOf('redx', 513)).toEqual({ external_id: 8, match: 'manual' });
    expect(await mapOf('redx', mirpur)).toBeNull();
  });
});
