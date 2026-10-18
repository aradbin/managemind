// Bangladesh geography (phase-4-plan §3.2): 8 divisions, 64 districts and
// the areas shoppers and couriers use, the upazilas, with the metropolitan
// thanas of Dhaka and Chattogram. `bd.json` is the source: a migration loads
// it into the `ref` schema, and shoppers' browsers get it as a static file.
// IDs and codes are stable: an area is retired with `active: false`, never
// renumbered, so Phase 7 can map codes to each courier's own area IDs.
import data from './bd.json' with { type: 'json' };
import { GEO_VERSION } from './version';

export { GEO_VERSION, geoFilePath } from './version';

export interface Division {
  id: number;
  code: string;
  en: string;
  bn: string;
}
export interface District {
  id: number;
  divisionId: number;
  code: string;
  en: string;
  bn: string;
}
export const AREA_KINDS = ['upazila', 'thana'] as const;
export type AreaKind = (typeof AREA_KINDS)[number];
export interface Area {
  id: number;
  districtId: number;
  code: string;
  kind: AreaKind;
  en: string;
  bn: string;
  active?: boolean;
}

export interface Geography {
  source: string;
  divisions: Division[];
  districts: District[];
  areas: Area[];
}

export const GEOGRAPHY = data as Geography;

/** FNV-1a, 32 bits, as 8 hex digits: enough to tell versions of one file apart. */
export function geoHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The browser file: arrays instead of objects, active areas only, so the
 * checkout's three dropdowns load about 15 KB gzip and no API call.
 * `d` divisions [id, bn, en], `s` districts [id, divisionId, bn, en],
 * `a` areas [id, districtId, bn, en].
 */
export interface GeoFile {
  v: string;
  d: [number, string, string][];
  s: [number, number, string, string][];
  a: [number, number, string, string][];
}

export function geoFile(geo: Geography = GEOGRAPHY): GeoFile {
  return {
    v: GEO_VERSION,
    d: geo.divisions.map((d) => [d.id, d.bn, d.en]),
    s: geo.districts.map((d) => [d.id, d.divisionId, d.bn, d.en]),
    a: geo.areas.filter((a) => a.active !== false).map((a) => [a.id, a.districtId, a.bn, a.en]),
  };
}

export interface GeoIndex {
  division(id: number): Division | undefined;
  district(id: number): District | undefined;
  area(id: number): Area | undefined;
  districtsOf(divisionId: number): District[];
  areasOf(districtId: number): Area[];
}

let index: GeoIndex | undefined;

/** Lookups by ID, built once per isolate. */
export function geoIndex(): GeoIndex {
  if (index) return index;
  const divisions = new Map(GEOGRAPHY.divisions.map((d) => [d.id, d]));
  const districts = new Map(GEOGRAPHY.districts.map((d) => [d.id, d]));
  const areas = new Map(GEOGRAPHY.areas.map((a) => [a.id, a]));
  index = {
    division: (id) => divisions.get(id),
    district: (id) => districts.get(id),
    area: (id) => areas.get(id),
    districtsOf: (id) => GEOGRAPHY.districts.filter((d) => d.divisionId === id),
    areasOf: (id) => GEOGRAPHY.areas.filter((a) => a.districtId === id && a.active !== false),
  };
  return index;
}

/** An address's place, by ID; the order keeps the names (§3.6). */
export interface Place {
  divisionId: number;
  districtId: number;
  areaId: number;
}

export interface PlaceNames {
  division: { bn: string; en: string };
  district: { bn: string; en: string };
  area: { bn: string; en: string };
}

/**
 * The names of a place, or null when the area is unknown, retired, or not in
 * that district and division: an area outside the list can't be typed in.
 */
export function placeNames(place: Place): PlaceNames | null {
  const g = geoIndex();
  const area = g.area(place.areaId);
  const district = g.district(place.districtId);
  const division = g.division(place.divisionId);
  if (!area || area.active === false || !district || !division) return null;
  if (area.districtId !== district.id || district.divisionId !== division.id) return null;
  const pick = (x: { bn: string; en: string }) => ({ bn: x.bn, en: x.en });
  return { division: pick(division), district: pick(district), area: pick(area) };
}
