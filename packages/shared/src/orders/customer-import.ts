// Customer imports (phase-4-plan §3.10): rows from CSV or Excel, matched by
// phone. Headers are recognized in English and Bangla, and WooCommerce's
// customer export works as it is. Districts and areas are matched by name
// in either language; a row whose area doesn't match keeps its address as
// text in the note and gets a warning, since couriers need the area.
import { z } from 'zod';
import { normalizeTag } from '../catalog/text';
import { type Area, GEOGRAPHY, geoIndex } from '../geo/index';
import { normalizePhone } from '../phone';

export const CUSTOMER_IMPORT_LIMITS = { rows: 20_000, chunk: 500 } as const;

/** Header aliases, lowercased; the first matching column wins. */
const HEADERS = {
  name: ['name', 'full name', 'customer name', 'customer', 'নাম'],
  firstName: ['first name', 'billing first name', 'first_name', 'billing_first_name'],
  lastName: ['last name', 'billing last name', 'last_name', 'billing_last_name'],
  phone: [
    'phone',
    'mobile',
    'phone number',
    'mobile number',
    'billing phone',
    'billing_phone',
    'ফোন',
    'মোবাইল',
  ],
  email: ['email', 'e-mail', 'email address', 'billing email', 'billing_email', 'ইমেইল'],
  address: [
    'address',
    'street',
    'address line',
    'address 1',
    'billing address 1',
    'billing_address_1',
    'ঠিকানা',
  ],
  address2: ['address 2', 'billing address 2', 'billing_address_2'],
  area: [
    'area',
    'thana',
    'upazila',
    'police station',
    'city',
    'billing city',
    'billing_city',
    'থানা',
    'উপজেলা',
    'এলাকা',
  ],
  district: ['district', 'zilla', 'billing state', 'billing_state', 'state', 'জেলা'],
  division: ['division', 'বিভাগ'],
  tags: ['tags', 'tag', 'group', 'groups', 'ট্যাগ'],
  note: ['note', 'notes', 'comment', 'নোট'],
} as const;
export type CustomerField = keyof typeof HEADERS;

/** Which column holds each field, from the header row. */
export function mapCustomerHeaders(
  headers: readonly string[],
): Partial<Record<CustomerField, number>> {
  const lower = headers.map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
  const out: Partial<Record<CustomerField, number>> = {};
  for (const [field, aliases] of Object.entries(HEADERS) as [CustomerField, readonly string[]][]) {
    const i = lower.findIndex((h) => aliases.includes(h));
    if (i >= 0) out[field] = i;
  }
  return out;
}

const fold = (s: string) =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/\b(sadar|thana|upazila|district|zila|zilla)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

let byName: { districts: Map<string, number>; areas: Map<string, Area[]> } | undefined;
function names() {
  if (byName) return byName;
  const districts = new Map<string, number>();
  for (const d of GEOGRAPHY.districts) {
    districts.set(fold(d.en), d.id);
    districts.set(fold(d.bn), d.id);
  }
  // Old spellings people still type.
  for (const [old, code] of [
    ['comilla', 'cumilla'],
    ['chittagong', 'chattogram'],
    ['barisal', 'barishal'],
    ['jessore', 'jashore'],
    ['bogra', 'bogura'],
    ['coxsbazar', 'coxs-bazar'],
  ] as const) {
    const d = GEOGRAPHY.districts.find((x) => x.code === code);
    if (d) districts.set(old, d.id);
  }
  const areas = new Map<string, Area[]>();
  for (const a of GEOGRAPHY.areas) {
    if (a.active === false) continue;
    for (const n of [fold(a.en), fold(a.bn)]) areas.set(n, [...(areas.get(n) ?? []), a]);
  }
  byName = { districts, areas };
  return byName;
}

/**
 * A place from names: the district and the area within it, or an area
 * whose name is unique in the country when no district is given.
 */
export function matchPlace(
  area: string | undefined,
  district: string | undefined,
): { divisionId: number; districtId: number; areaId: number } | null {
  if (!area?.trim()) return null;
  const n = names();
  const districtId = district ? n.districts.get(fold(district)) : undefined;
  const candidates = n.areas.get(fold(area)) ?? [];
  let hit: Area | undefined;
  if (districtId) hit = candidates.find((a) => a.districtId === districtId);
  else if (candidates.length === 1) hit = candidates[0];
  // "Dhaka" as the area with no thana: no single area to pick.
  if (!hit) return null;
  const d = geoIndex().district(hit.districtId);
  return d ? { divisionId: d.divisionId, districtId: d.id, areaId: hit.id } : null;
}

export const importCustomer = z
  .object({
    row: z.int().min(1),
    phone: z.string().regex(/^\+8801[3-9]\d{8}$/),
    name: z.string().min(1).max(100),
    email: z.email().max(254).nullable(),
    tags: z.array(z.string().max(50)).max(20),
    note: z.string().max(2000).nullable(),
    address: z
      .object({
        divisionId: z.int(),
        districtId: z.int(),
        areaId: z.int(),
        line: z.string().min(1).max(250),
      })
      .nullable(),
  })
  .strict();
export type ImportCustomer = z.infer<typeof importCustomer>;

export interface CustomerRowResult {
  customer: ImportCustomer | null;
  errors: { field: string; code: string; message: string }[];
  warnings: { field: string; code: string; message: string }[];
}

/** One spreadsheet row as a customer to import, with its errors and warnings. */
export function parseCustomerRow(
  cells: readonly unknown[],
  columns: Partial<Record<CustomerField, number>>,
  row: number,
): CustomerRowResult {
  const cell = (f: CustomerField) => {
    const i = columns[f];
    const v = i === undefined ? undefined : cells[i];
    return v === undefined || v === null ? '' : String(v).trim();
  };
  const errors: CustomerRowResult['errors'] = [];
  const warnings: CustomerRowResult['warnings'] = [];
  const phone = normalizePhone(cell('phone'));
  if (!phone)
    errors.push({ field: 'phone', code: 'invalid', message: 'not a Bangladeshi mobile number' });
  const name = (
    cell('name') || [cell('firstName'), cell('lastName')].filter(Boolean).join(' ')
  ).slice(0, 100);
  if (!name) errors.push({ field: 'name', code: 'required', message: 'a name is required' });
  const rawEmail = cell('email').toLowerCase();
  const email = rawEmail && z.email().safeParse(rawEmail).success ? rawEmail : null;
  if (rawEmail && !email)
    warnings.push({ field: 'email', code: 'invalid', message: 'not an email address; left out' });
  const tags = [
    ...new Set(
      cell('tags')
        .split(/[,;|]/)
        .map((t) => normalizeTag(t))
        .filter((t): t is string => t !== null),
    ),
  ].slice(0, 20);
  let note = cell('note') || null;
  const line = [cell('address'), cell('address2')].filter(Boolean).join(', ').slice(0, 250);
  let address: ImportCustomer['address'] = null;
  if (line || cell('area')) {
    const place = matchPlace(cell('area'), cell('district'));
    if (place && line) address = { ...place, line };
    else {
      const text = [line, cell('area'), cell('district'), cell('division')]
        .filter(Boolean)
        .join(', ');
      note = [note, `Address: ${text}`].filter(Boolean).join('\n').slice(0, 2000);
      warnings.push({
        field: 'area',
        code: 'unmatched',
        message: 'the area did not match the list; the address is kept in the note',
      });
    }
  }
  if (errors.length || !phone) return { customer: null, errors, warnings };
  return { customer: { row, phone, name, email, tags, note, address }, errors, warnings };
}
