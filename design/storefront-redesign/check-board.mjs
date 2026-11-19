// Checks a board without the canvas: runs its script with a stand-in for the
// canvas runtime, optionally calls handlers in order, then reports every
// `{{hole}}` in the markup that renderVals() leaves undefined. List items are
// checked against the first item of their list.
//   node design/storefront-redesign/check-board.mjs <board.dc.html> ['<props json>'] [handler ...]
// A handler is a value path such as `place` or `tabs.1.pick`; `name=value`
// calls it like an input's change event. SHOW=a,b prints those values after.
// Example: node design/storefront-redesign/check-board.mjs \
//   design/storefront-redesign/canvas/project/Checkout.dc.html '{"scenario":"phone_code"}' place
import { readFileSync } from 'node:fs';
const [file, propsJson = '{}', ...actions] = process.argv.slice(2);
const html = readFileSync(file, 'utf8');
const script = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const markup = html.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1];
globalThis.window = { scrollY: 0, scrollTo() {}, addEventListener() {}, removeEventListener() {} };
globalThis.document = { getElementById: () => null };
globalThis.setTimeout = (f) => 0;
class DCLogic { constructor(props) { this.props = props; this.state = {}; } setState(o) { this.state = Object.assign({}, this.state, typeof o === 'function' ? o(this.state) : o); } }
const Component = new Function('DCLogic', script + '\nreturn Component;')(DCLogic);
const props = JSON.parse(propsJson);
const c = new Component(props);
c.props = props;
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
for (const a of actions) {
  const v = c.renderVals();
  const [name, val] = a.split('=');
  const fn = get(v, name);
  if (typeof fn !== 'function') { console.log('NO HANDLER', name); process.exit(1); }
  if (val !== undefined) fn({ target: { value: val }, preventDefault() {} }); else fn({ preventDefault() {}, target: { value: '' } });
}
const vals = c.renderVals();
const loops = {};
for (const m of markup.matchAll(/<sc-for list="\{\{([^}]+)\}\}" as="(\w+)"/g)) (loops[m[2]] ??= []).push(m[1].trim());
const resolve = (path) => {
  const [root, ...rest] = path.split('.');
  if (loops[root]) {
    // The same loop name can serve several lists: fine if any of them has it.
    let last = { v: undefined };
    for (const listPath of loops[root]) {
      const pr = resolve(listPath);
      if (pr.skip) return { skip: true };
      if (!Array.isArray(pr.v)) { last = { bad: 'list not array: ' + listPath }; continue; }
      if (!pr.v.length) return { skip: true };
      const v = rest.length ? get(pr.v[0], rest.join('.')) : pr.v[0];
      if (v !== undefined) return { v };
    }
    return last;
  }
  return { v: get(vals, path) };
};
const missing = new Set();
for (const m of markup.matchAll(/\{\{([^}]+)\}\}/g)) {
  const p = m[1].trim();
  if (/\s|^(true|false|\d)/.test(p)) continue;
  const r = resolve(p);
  if (r.bad) missing.add(p + ' (' + r.bad + ')');
  else if (!r.skip && r.v === undefined) missing.add(p);
}
console.log(missing.size ? 'MISSING: ' + [...missing].join(', ') : 'ok');
const show = process.env.SHOW ? process.env.SHOW.split(',') : [];
for (const k of show) console.log(k, '=', JSON.stringify(get(vals, k)));
