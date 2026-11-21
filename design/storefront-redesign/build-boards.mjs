// Regenerates the boards that are copies of other boards. Run it after
// changing any board named below, before checking and publishing:
//   node design/storefront-redesign/build-boards.mjs [project dir]
//
// 1. Shared scripts. Some desktop boards run exactly the same logic as their
//    phone board; only the markup differs. The phone board holds the script:
//    it is copied into the desktop board, with links to phone boards turned
//    into links to desktop boards and the desktop board's own $preview kept.
// 2. Bangla boards. Boards with a `bn` tweak carry both languages; their
//    Bangla copy (`<Name>Bn.dc.html`) is the same file with `bn` on by
//    default, `lang="bn"` and a Bangla title.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = process.argv[2] ?? join(here, 'canvas', 'project');
const read = (name) => readFileSync(join(project, `${name}.dc.html`), 'utf8');
const write = (name, html) => {
  writeFileSync(join(project, `${name}.dc.html`), html);
  console.log(`${name}.dc.html`);
};

// Desktop board ← phone board whose script it shares.
const shared = {
  Listing: 'ListingPhone',
  Search: 'SearchPhone',
  Checkout: 'CheckoutPhone',
  Thanks: 'ThanksPhone',
  Track: 'TrackPhone',
  Account: 'AccountPhone',
};

// Phone board name → desktop board name, for links inside copied scripts.
const desktopOf = {
  HomePhone: 'Main',
  ListingPhone: 'Listing',
  SearchPhone: 'Search',
  ProductPhone: 'Product',
  CartPhone: 'Cart',
  CheckoutPhone: 'Checkout',
  ThanksPhone: 'Thanks',
  TrackPhone: 'Track',
  AccountPhone: 'Account',
};

const scriptStart = '<script type="text/x-dc"';
const previewOf = (html) => html.match(/"\$preview":\{[^}]*\}/)?.[0];

for (const [desktop, phone] of Object.entries(shared)) {
  const target = read(desktop);
  const source = read(phone);
  const preview = previewOf(target);
  if (!preview) throw new Error(`${desktop}: no $preview`);
  let script = source.slice(source.indexOf(scriptStart));
  script = script.replace(/"\$preview":\{[^}]*\}/, preview);
  script = script.replace(/\b([A-Za-z]+Phone)(Bn)?\.dc\.html/g, (whole, name, bn) =>
    desktopOf[name] ? `${desktopOf[name]}${bn ?? ''}.dc.html` : whole,
  );
  write(desktop, target.slice(0, target.indexOf(scriptStart)) + script);
}

// Board → Bangla title of its Bangla copy.
const bangla = {
  Main: 'হোম (বাংলা)',
  HomePhone: 'হোম, ফোন (বাংলা)',
  Listing: 'ক্যাটাগরি (বাংলা)',
  ListingPhone: 'ক্যাটাগরি, ফোন (বাংলা)',
  Search: 'সার্চ (বাংলা)',
  SearchPhone: 'সার্চ, ফোন (বাংলা)',
  Product: 'পণ্য (বাংলা)',
  ProductPhone: 'পণ্য, ফোন (বাংলা)',
  Cart: 'কার্ট (বাংলা)',
  CartPhone: 'কার্ট, ফোন (বাংলা)',
  Checkout: 'চেকআউট (বাংলা)',
  CheckoutPhone: 'চেকআউট, ফোন (বাংলা)',
  Thanks: 'ধন্যবাদ (বাংলা)',
  ThanksPhone: 'ধন্যবাদ, ফোন (বাংলা)',
  Track: 'অর্ডার ট্র্যাক (বাংলা)',
  TrackPhone: 'অর্ডার ট্র্যাক, ফোন (বাংলা)',
  Account: 'অ্যাকাউন্ট (বাংলা)',
  AccountPhone: 'অ্যাকাউন্ট, ফোন (বাংলা)',
  States: 'লোডিং ও সমস্যার অবস্থা, ফোন (বাংলা)',
};

const swap = (text, from, to, name) => {
  if (!text.includes(from)) throw new Error(`${name}: expected ${from}`);
  return text.replace(from, to);
};

for (const [name, title] of Object.entries(bangla)) {
  let html;
  try {
    html = read(name);
  } catch {
    continue;
  }
  if (!html.includes('"bn":{"editor":"boolean","default":false}')) {
    console.log(`skipped ${name}: no bn tweak yet`);
    continue;
  }
  html = swap(html, '<html lang="en">', '<html lang="bn">', name);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  html = swap(html, '"bn":{"editor":"boolean","default":false}', '"bn":{"editor":"boolean","default":true}', name);
  write(`${name}Bn`, html);
}
