import { describe, expect, it } from 'vitest';
import { GEO_VERSION, GEOGRAPHY, geoFile, geoHash, geoIndex, placeNames } from './index';

describe('geography', () => {
  it('has 8 divisions, 64 districts, and the upazilas with the Dhaka and Chattogram thanas', () => {
    expect(GEOGRAPHY.divisions).toHaveLength(8);
    expect(GEOGRAPHY.districts).toHaveLength(64);
    const thanas = GEOGRAPHY.areas.filter((a) => a.kind === 'thana');
    expect(thanas.filter((a) => a.districtId === 47)).toHaveLength(50);
    expect(thanas.filter((a) => a.districtId === 8)).toHaveLength(15);
    expect(GEOGRAPHY.areas.length).toBeGreaterThan(500);
  });

  it('keeps IDs and codes unique and every reference valid', () => {
    for (const list of [GEOGRAPHY.divisions, GEOGRAPHY.districts, GEOGRAPHY.areas]) {
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
      expect(new Set(list.map((x) => x.code)).size).toBe(list.length);
      for (const x of list) {
        expect(x.en.trim()).toBe(x.en);
        expect(x.bn.length).toBeGreaterThan(0);
      }
    }
    const g = geoIndex();
    for (const d of GEOGRAPHY.districts) expect(g.division(d.divisionId)).toBeDefined();
    for (const a of GEOGRAPHY.areas) {
      expect(g.district(a.districtId)).toBeDefined();
      expect(a.code.startsWith(`${g.district(a.districtId)?.code}.`)).toBe(true);
    }
  });

  it('names the browser file after a hash of the data', () => {
    expect(geoHash(JSON.stringify(GEOGRAPHY))).toBe(GEO_VERSION);
    const file = geoFile();
    expect(file.v).toBe(GEO_VERSION);
    expect(file.a.length).toBe(GEOGRAPHY.areas.filter((a) => a.active !== false).length);
  });

  it('checks that an area belongs to its district and division', () => {
    const dhanmondi = GEOGRAPHY.areas.find((a) => a.code === 'dhaka.dhanmondi');
    expect(dhanmondi).toBeDefined();
    const place = { divisionId: 6, districtId: 47, areaId: dhanmondi?.id ?? 0 };
    expect(placeNames(place)?.area).toEqual({ bn: 'ধানমন্ডি', en: 'Dhanmondi' });
    expect(placeNames({ ...place, districtId: 41 })).toBeNull();
    expect(placeNames({ ...place, divisionId: 1 })).toBeNull();
    expect(placeNames({ ...place, areaId: 99_999 })).toBeNull();
  });
});
