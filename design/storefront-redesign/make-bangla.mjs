// Writes the Bangla phone boards (`<Name>Bn.dc.html`) from their English
// boards. Each of those boards carries both languages behind a `bn` tweak;
// the Bangla board is the same file with `bn` on by default, `lang="bn"`
// and a Bangla title. Run it after editing any of the source boards:
// `node design/storefront-redesign/make-bangla.mjs [project dir]`.
// HomePhoneBn.dc.html is hand-written and is not touched.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = process.argv[2] ?? join(here, 'canvas', 'project');

const boards = {
  CartPhone: 'কার্ট, ফোন (বাংলা)',
  ProductPhone: 'পণ্য, ফোন (বাংলা)',
  CheckoutPhone: 'চেকআউট, ফোন (বাংলা)',
  TrackPhone: 'অর্ডার ট্র্যাক, ফোন (বাংলা)',
  AccountPhone: 'অ্যাকাউন্ট, ফোন (বাংলা)',
};

const swap = (text, from, to, name) => {
  if (!text.includes(from)) throw new Error(`${name}: expected ${from}`);
  return text.replace(from, to);
};

for (const [name, title] of Object.entries(boards)) {
  let html = readFileSync(join(project, `${name}.dc.html`), 'utf8');
  html = swap(html, '<html lang="en">', '<html lang="bn">', name);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  html = swap(html, '"bn":{"editor":"boolean","default":false}', '"bn":{"editor":"boolean","default":true}', name);
  writeFileSync(join(project, `${name}Bn.dc.html`), html);
  console.log(`${name}Bn.dc.html`);
}
