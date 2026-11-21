// The browser's copy of the sound key (shared storefront/search-key.ts) must
// give what the database's app.search_key gives (migration 0052).
import { searchKey, searchKeyMatches } from '@managemind/shared/storefront/search-key';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectApp } from './setup';

let app: pg.Client;
beforeAll(async () => {
  app = await connectApp();
});
afterAll(() => app.end());

const WORDS = [
  'কড়াই',
  'korai',
  'kadai',
  'মসুর ডাল',
  'moshur daal',
  'সরিষার তেল',
  'shorishar tel',
  'সিলেটী চা পাতা',
  'পেঁয়াজ',
  'piyaj',
  'ব্যাগ',
  'লক্ষ্মী',
  'বাংলা',
  'নন-স্টিক ফ্রাইং প্যান',
  'Non-stick Frying Pan',
  'শাড়ী',
  'মুড়ি',
  'ঋতু',
  'কৃষি',
  'ঐতিহ্য',
  'ক্‍ষ',
  'Chicken 65',
  'Sheikh Bhai',
  'zoo xylophone quick',
];

describe('searchKey', () => {
  it('gives what app.search_key gives', async () => {
    const { rows } = await app.query<{ w: string; k: string }>(
      'select w, app.search_key(w) as k from unnest($1::text[]) w',
      [WORDS],
    );
    for (const r of rows) expect(searchKey(r.w), r.w).toBe(r.k);
  });

  it('matches as app.search_key_matches does', async () => {
    const pairs: [string, string][] = [
      ['লাল নন-স্টিক কড়াই', 'kadai'],
      ['লাল নন-স্টিক কড়াই', 'korai nil'],
      ['চাল', 'cha'],
      ['চা পাতা', 'cha'],
      ['চাল ও ডাল', 'chal'],
    ];
    for (const [title, q] of pairs) {
      const { rows } = await app.query<{ m: boolean }>(
        'select app.search_key_matches(app.search_key($1), app.search_key($2)) as m',
        [title, q],
      );
      expect(searchKeyMatches(searchKey(title), searchKey(q)), `${title} / ${q}`).toBe(rows[0]?.m);
    }
  });
});
