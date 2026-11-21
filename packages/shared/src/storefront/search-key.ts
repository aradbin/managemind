// The sound key of a title or a query, in Bangla or in Latin letters, so
// "কড়াই", "korai", "karai" and "kadai" meet. The database has the same
// function, app.search_key (migration 0052_search_key.sql), which search
// matches products with; this copy runs in the browser for the header's
// category suggestions. A test in packages/core keeps the two the same.

/** app.search_text: NFC, lowercase, no joiners, long ি and ু made short. */
export function searchText(input: string): string {
  return input
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‌‍]/g, '')
    .replace(/ী/g, 'ি')
    .replace(/ূ/g, 'ু');
}

const translate = (text: string, from: string, to: string) =>
  [...text]
    .map((c) => {
      const i = from.indexOf(c);
      return i < 0 ? c : (to[i] ?? '');
    })
    .join('');

const VOWELS_FROM = 'ইঈিউঊুএেঐৈঔৌঅআাওো';
const VOWELS_TO = 'iiiuuueeiiuu';
const CONSONANTS_FROM = 'কখগঘঙংচছজঝযঞণনটঠতথৎডঢদধপফবভমরলশষসহ';
const CONSONANTS_TO = 'kkggnnccjjjnnnttttTddddpfbbmrlsssh';

export function searchKey(input: string): string {
  let t = searchText(input);
  t = t.replaceAll('ড়', 'R').replaceAll('ঢ়', 'R');
  t = t.replaceAll('য়', '');
  t = t.replaceAll('ক্ষ', 'k').replaceAll('্য', '');
  t = t.replace(/chh|ch/g, 'C').replaceAll('ck', 'k');
  for (const [from, to] of [
    ['kh', 'k'],
    ['gh', 'g'],
    ['jh', 'j'],
    ['th', 't'],
    ['dh', 'd'],
    ['ph', 'f'],
    ['bh', 'b'],
    ['sh', 's'],
    ['ng', 'n'],
    ['ee', 'i'],
    ['oo', 'u'],
    ['x', 'ks'],
  ] as const)
    t = t.replaceAll(from, to);
  t = translate(t, 'cvzqwyao', 'kbjk').replaceAll('C', 'c');
  t = t.replaceAll('ঋ', 'ri').replaceAll('ৃ', 'ri');
  t = translate(t, VOWELS_FROM, VOWELS_TO);
  t = translate(t, CONSONANTS_FROM, CONSONANTS_TO).replaceAll('T', 't');
  t = translate(t, 'e', 'i');
  t = translate(t, '্ঁঃ়', '');
  t = t.replace(/[^a-zR0-9]+/g, ' ');
  t = t.replace(/(.)\1+/g, '$1');
  t = t.replace(/ +/g, ' ').trim();
  return t.includes('R') ? `${t.replaceAll('R', 'r')} ${t.replaceAll('R', 'd')}` : t;
}

/** Whether every word of the query's key starts a word of the title's key (a short word: the whole word). */
export function searchKeyMatches(key: string, query: string): boolean {
  const words = query.split(' ').filter(Boolean);
  if (!words.length) return false;
  const keys = key.split(' ');
  return words.every((w) => keys.some((k) => (w.length <= 2 ? k === w : k.startsWith(w))));
}
