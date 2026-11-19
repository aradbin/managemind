// Renders a board to a PNG without the canvas, using a stand-in for the canvas
// runtime (holes, sc-if, sc-for, dc-import; no live events). Good for checking
// layout and measuring content; spacing can differ slightly from the canvas.
//   node design/storefront-redesign/render-board.mjs <project dir> <Board> ['<props json>'] <out.png> [handler ...]
// Handlers run in order before the shot: `place`, `tabs.1.pick`, `setPhone=0171…`
// (passed as an input's change event) or `setQuery~pan` (passed as a plain value).
// NATURAL=1 prints the content's own height instead of taking a shot; TEXT=1
// also prints the visible text. Needs Playwright with Chromium installed.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const load = (p) => { try { return require(p); } catch { return null; } };
const { chromium } = load('playwright') ?? load('/opt/node-tools/node_modules/playwright/index.js');
const [dir, board, propsJson = '{}', out, ...actions] = process.argv.slice(2);
const files = {};
for (const n of readdirSync(dir)) if (n.endsWith('.dc.html')) files[n.replace('.dc.html', '')] = readFileSync(join(dir, n), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.setContent('<!doctype html><html><head></head><body></body></html>');
const info = await page.evaluate(async ({ files, board, props, actions }) => {
  class DCLogic { constructor(p) { this.props = p; this.state = {}; } setState(o) { this.state = Object.assign({}, this.state, o); } }
  window.__noop = 1;
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const parse = (src) => {
    const script = src.match(/<script type="text\/x-dc"[^>]*data-props='([^']*)'[^>]*>([\s\S]*?)<\/script>/);
    const markup = src.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1];
    const helmet = (markup.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ''])[1];
    return { dp: JSON.parse(script[1]), code: script[2], body: markup.replace(/<helmet>[\s\S]*?<\/helmet>/, ''), helmet };
  };
  const helmets = new Set();
  const render = (name, props, acts = []) => {
    const f = parse(files[name]);
    helmets.add(f.helmet);
    const full = {};
    for (const [k, v] of Object.entries(f.dp)) if (k[0] !== '$' && v && 'default' in v) full[k] = v.default;
    Object.assign(full, props);
    const C = new Function('DCLogic', f.code + '\nreturn Component;')(DCLogic);
    const c = new C(full); c.props = full;
    if (c.componentDidMount) { /* skip listeners */ }
    for (const a of acts) {
      const v = c.renderVals(); const raw = a.includes('~'); const [n, val] = a.split(raw ? '~' : '=');
      const fn = get(v, n); if (typeof fn === 'function') fn(raw ? val : { target: { value: val ?? '' }, preventDefault() {} });
    }
    const vals = c.renderVals();
    const tpl = document.createElement('template');
    tpl.innerHTML = f.body;
    const hole = (expr, scope) => {
      const e = expr.trim();
      if (/^(true|false|-?\d+(\.\d+)?|'.*'|".*")$/.test(e)) return JSON.parse(e.replace(/^'|'$/g, '"'));
      const root = e.split('.')[0];
      return root in scope ? get(scope, e) : get(vals, e);
    };
    const interp = (s, scope) => s.replace(/\{\{([^}]+)\}\}/g, (_, e) => { const v = hole(e, scope); return v == null ? '' : String(v); });
    const walk = (node, scope) => {
      for (const ch of [...node.childNodes]) {
        if (ch.nodeType === 3) { if (ch.data.includes('{{')) ch.data = interp(ch.data, scope); continue; }
        if (ch.nodeType !== 1) continue;
        const tag = ch.tagName.toLowerCase();
        if (tag === 'sc-if') {
          const v = hole(ch.getAttribute('value').replace(/^\{\{|\}\}$/g, ''), scope);
          if (v) { walk(ch, scope); ch.replaceWith(...ch.childNodes); } else ch.remove();
          continue;
        }
        if (tag === 'sc-for') {
          const list = hole(ch.getAttribute('list').replace(/^\{\{|\}\}$/g, ''), scope) || [];
          const as = ch.getAttribute('as'); const frag = document.createDocumentFragment();
          for (const item of list) { const clone = ch.cloneNode(true); walk(clone, Object.assign({}, scope, { [as]: item })); frag.append(...clone.childNodes); }
          ch.replaceWith(frag); continue;
        }
        if (tag === 'dc-import') {
          const p = {};
          for (const at of [...ch.attributes]) {
            if (['name', 'hint-size'].includes(at.name)) continue;
            const key = at.name.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
            const m = at.value.match(/^\{\{([^}]+)\}\}$/);
            p[key] = m ? hole(m[1], scope) : interp(at.value, scope);
          }
          const wrap = document.createElement('div');
          wrap.innerHTML = render(ch.getAttribute('name'), p);
          ch.replaceWith(...wrap.childNodes); continue;
        }
        for (const at of [...ch.attributes]) {
          if (/^on[A-Z]/.test(at.name) || /^on[a-z]+$/.test(at.name)) { ch.removeAttribute(at.name); continue; }
          if (at.value.includes('{{')) {
            const m = at.value.match(/^\{\{([^}]+)\}\}$/);
            const v = m ? hole(m[1], scope) : interp(at.value, scope);
            if (at.name === 'checked' || at.name === 'disabled' || at.name === 'open') { if (v && v !== 'false') ch.setAttribute(at.name, ''); else ch.removeAttribute(at.name); }
            else ch.setAttribute(at.name, v == null ? '' : String(v));
          }
        }
        walk(ch, scope);
        if (tag === 'select' && ch.getAttribute('value') != null) { /* select value */ }
        if (tag === 'textarea' && ch.getAttribute('value')) ch.textContent = ch.getAttribute('value');
      }
    };
    walk(tpl.content, {});
    const d = document.createElement('div'); d.append(tpl.content);
    return d.innerHTML;
  };
  const html = render(board, props, actions);
  document.head.innerHTML = [...helmets].join('\n');
  document.body.innerHTML = html;
  const f = parse(files[board]);
  await document.fonts.ready;
  return f.dp.$preview;
}, { files, board, props: JSON.parse(propsJson), actions });
await page.setViewportSize({ width: info.width, height: Number(process.env.H || info.height) });
await page.waitForTimeout(800);
if (!process.env.NATURAL) await page.screenshot({ path: out, fullPage: true });
const h = await page.evaluate((natural) => {
  if (natural) { const r = document.body.firstElementChild; r.style.minHeight = '0'; for (const el of r.querySelectorAll('[style*="sticky"]')) el.style.position = 'static'; return Math.ceil(r.getBoundingClientRect().height); }
  return document.documentElement.scrollHeight;
}, !!process.env.NATURAL);
console.log(out, info.width + 'x' + h, 'frame', info.height);
if (process.env.TEXT) console.log(await page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('[aria-label],[placeholder]')].map((e) => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('placeholder') || '')).join('\n')));
await browser.close();
