// Reports: a day-by-day history from July, the date range, and the pieces every report table is made of.
var DAYS = (function () {
  var seed = 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  var out = [], d = Date.UTC(2026, 6, 1), end = Date.UTC(2026, 9, 29);
  for (; d <= end; d += 86400000) {
    var iso = new Date(d).toISOString().slice(0, 10), dow = new Date(d).getUTCDay();
    var boost = iso >= '2026-10-10' && iso <= '2026-10-20' ? 1.35 : 1; // the Puja week
    var orders = Math.round((dow === 5 ? 6 : 10 + rnd() * 7) * boost * (iso >= '2026-09-01' ? 1.1 : 1));
    var units = Math.round(orders * (1.3 + rnd() * 0.4));
    var gross = Math.round(orders * (2300 + rnd() * 900) / 10) * 10;
    var disc = Math.round(gross * (0.03 + rnd() * 0.04) / 10) * 10;
    var ret = rnd() < 0.3 ? Math.round((1200 + rnd() * 2500) / 10) * 10 : 0;
    out.push({ d: iso, orders: orders, units: units, gross: gross, disc: disc, net: gross - disc, ret: ret, del: orders * 85, cogs: Math.round((gross - disc) * (0.5 + rnd() * 0.06)) });
  }
  return out;
})();
var FIRST_DAY = '2026-07-01';
var PRESETS = [['this', 'This month', '2026-10-01', '2026-10-29'], ['last', 'Last month', '2026-09-01', '2026-09-30'], ['l30', 'Last 30 days', '2026-09-30', '2026-10-29']];
function addDays(iso, n) { return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function dayCount(from, to) { return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1; }
function rangeText(from, to) { return short(from) + (from.slice(0, 4) !== to.slice(0, 4) ? ', ' + from.slice(0, 4) : '') + ' – ' + short(to) + ', ' + to.slice(0, 4); }
function sumDays(from, to) {
  var t = { orders: 0, units: 0, gross: 0, disc: 0, net: 0, ret: 0, del: 0, cogs: 0, n: 0 };
  DAYS.forEach(function (x) { if (x.d >= from && x.d <= to) { t.n++; Object.keys(x).forEach(function (k) { if (k !== 'd') t[k] += x[k]; }); } });
  return t;
}
function pct(part, whole) { return whole ? (Math.round(part / whole * 1000) / 10).toLocaleString('en-US') + '%' : '—'; }
function count(v) { return Number(v).toLocaleString('en-US'); }
function change(now, before) {
  if (!before) return { text: '—', color: 'var(--muted-foreground)' };
  var c = Math.round((now - before) / Math.abs(before) * 1000) / 10;
  return { text: (c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c).toLocaleString('en-US') + '%', color: c > 0 ? 'var(--success)' : c < 0 ? 'var(--destructive)' : 'var(--muted-foreground)' };
}
// The date range: a preset or a custom from/to. Returns the range and its controls.
function rangeOf(s, up) {
  var key = s.range || 'this', p = PRESETS.filter(function (x) { return x[0] === key; })[0];
  var from = p ? p[2] : s.from || '2026-10-01', to = p ? p[3] : s.to || '2026-10-29';
  var valid = from <= to;
  return {
    from: from, to: to, valid: valid, days: valid ? dayCount(from, to) : 0, hasData: valid && to >= FIRST_DAY,
    rg: {
      presets: PRESETS.map(function (x) { return { label: x[1], on: key === x[0] ? 'true' : 'false', pick: function () { up({ range: x[0], rpop: false, exp: null }); } }; })
        .concat([{ label: 'Custom', on: key === 'custom' ? 'true' : 'false', pick: function () { up({ range: 'custom', rpop: true, from: from, to: to, exp: null }); } }]),
      text: valid ? rangeText(from, to) : 'Check the dates', isCustom: key === 'custom', open: Boolean(s.rpop), aria: s.rpop ? 'true' : 'false',
      toggle: function () { up({ rpop: !s.rpop, range: 'custom', from: from, to: to }); },
      from: from, to: to, onFrom: function (e) { up({ from: e.target.value, range: 'custom' }); }, onTo: function (e) { up({ to: e.target.value, range: 'custom' }); },
      bad: !valid, badAria: valid ? 'false' : 'true'
    }
  };
}
// A table cell, a row, a table. Figures are right-aligned.
function cell(text, o) { o = o || {}; return { text: String(text), align: o.left ? 'left' : 'right', weight: o.bold ? '600' : '400', color: o.color || 'var(--foreground)', indent: o.indent ? '28px' : '' }; }
function first(text, o) { o = o || {}; o.left = true; return cell(text, o); }
function row(cells, o) { o = o || {}; return { cells: cells, bg: o.total ? 'color-mix(in oklch, var(--muted) 50%, transparent)' : 'transparent', border: o.rule ? '2px solid var(--border)' : '1px solid var(--border)' }; }
function table(s, up, toast, id, caption, head, rows, o) {
  o = o || {};
  var open = s.exp === id;
  var exp = function (fmt) { return function () { up({ exp: null, toast: toast('Exported “' + caption + '” as ' + fmt + '.') }); }; };
  return {
    isTable: true, isHeading: false, text: '', id: id, caption: caption, sub: o.sub || '', hasSub: Boolean(o.sub), span: o.full ? '1 / -1' : 'auto',
    head: head.map(function (h, i) { return { text: h, align: i ? 'right' : 'left' }; }), rows: rows,
    none: rows.length === 0, has: rows.length > 0, emptyText: o.empty || 'Nothing in these dates.',
    hint: o.hint || '', hasHint: Boolean(o.hint), link: o.link || '', linkText: o.linkText || '', hasLink: Boolean(o.link),
    expOpen: open, expAria: open ? 'true' : 'false', expLabel: 'Export ' + caption, toggleExp: function () { up({ exp: open ? null : id }); },
    toExcel: exp('Excel'), toCsv: exp('CSV')
  };
}
function heading(text) { return { isTable: false, isHeading: true, text: text, id: 'h-' + text, caption: '', sub: '', hasSub: false, span: '1 / -1', head: [], rows: [], none: false, has: false, emptyText: '', hint: '', hasHint: false, link: '', linkText: '', hasLink: false, expOpen: false, expAria: 'false', expLabel: '', toggleExp: function () {}, toExcel: function () {}, toCsv: function () {} }; }
function stat(label, value, ch) { return { label: label, value: value, sub: ch ? ch.text + ' vs. before' : '', hasSub: Boolean(ch) && ch.text !== '—', subColor: ch ? ch.color : '' }; }
function seg(id, label, opts, cur, pick) { return { id: id, label: label, opts: opts.map(function (o) { return { label: o[1], on: cur === o[0] ? 'true' : 'false', pick: function () { pick(o[0]); } }; }) }; }
// Everything a report page shows, empty to start.
function reportVals(vals, s, up) {
  vals.controls = []; vals.hasControls = false; vals.notes = []; vals.stats = []; vals.hasStats = false; vals.blocks = [];
  vals.hasChart = false; vals.chart = { title: '', sub: '', bars: [], ticks: [] }; vals.noData = false; vals.noDataText = 'Nothing in these dates. Sales start on 1 Jul 2026.';
  vals.closePop = function () { up({ exp: null, rpop: false }); };
  vals.closeAll = function () { up({ exp: null, rpop: false }); };
  vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ exp: null, rpop: false }); } };
}
function finish(vals) {
  vals.hasControls = vals.controls.length > 0; vals.hasStats = vals.stats.length > 0; vals.hasNotes = vals.notes.length > 0;
  return vals;
}
function note(text, tone) { return { text: text, warn: tone === 'warn', info: tone !== 'warn' }; }
// Sell-through by product: share of net sales, and its cost share.
var PRODUCTS = [['Embroidered Kurti', 0.19, 1850, 890], ['Cotton Panjabi', 0.17, 1450, 655], ['Tangail Cotton Saree', 0.14, 2950, 1350], ['Cotton Three-piece', 0.13, 2400, 1100], ['Jamdani Saree', 0.11, 12500, 4200],
  ['Silk Panjabi', 0.09, 3200, 1450], ['Leather Sandal', 0.06, 1650, 950], ['Batik Fatua', 0.05, 990, null], ['Kids Panjabi', 0.04, 850, 380], ['Prayer Cap', 0.02, 150, 60]];
var EXPENSES = [['Rent', 45000], ['Salaries', 68000], ['Facebook ads', 21500], ['Packaging', 4800], ['Electricity and internet', 6200], ['Transport', 3400], ['Other', 2900]];
function L(name) { return name + (ROOT === 'mm' ? 'Phone' : '') + '.dc.html'; }
