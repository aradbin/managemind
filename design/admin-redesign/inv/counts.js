var START = {
  Counts: {}, 'In review': { st: 'review' }, 'Row menu': { menu: 'sc7' }, 'New count': { form: true }, 'New count: a category': { form: true, kind: 'category', cat: 'Kurti' },
  'New count: items I choose': { form: true, kind: 'variants', chosen: ['v12', 'v13'] }, 'Cancel count': { confirm: 'sc7' }
};
var KINDS = [
  ['all', 'Everything at this location', 'All the tracked items. Best done when the shop is closed.'],
  ['category', 'A category', 'One shelf or section, like Panjabi or Saree.'],
  ['tag', 'Products with a tag', 'Like eid, to check before a big sale.'],
  ['variants', 'Items I choose', 'A few items you want to check.']
];

class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Counts');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var counts = s.counts || COUNTS;
    var st = s.st || 'all';
    vals.tabs = [['all', 'All'], ['counting', 'Counting'], ['review', 'In review'], ['applied', 'Applied'], ['cancelled', 'Cancelled']].map(function (t) {
      return { label: t[1], count: String(t[0] === 'all' ? counts.length : counts.filter(function (c) { return c.status === t[0]; }).length), on: st === t[0] ? 'true' : 'false', pick: function () { up({ st: t[0], menu: null }); } };
    });
    var list = counts.filter(function (c) { return st === 'all' || c.status === st; });
    var rowOf = function (c) {
      var d = countDiff(c), menuOpen = s.menu === c.id;
      var open = c.status === 'counting' || c.status === 'review';
      return {
        ref: c.ref, what: scopeText(c), badge: badgeOf(COUNT_STATUS, c.status),
        progress: d.counted + ' of ' + c.lines.length + ' counted', pct: Math.round(d.counted / c.lines.length * 100) + '%', progColor: d.counted === c.lines.length ? 'var(--success)' : 'var(--primary)',
        diff: c.status === 'counting' || c.status === 'cancelled' ? '—' : d.lines === 0 ? 'Everything matches' : plural(d.lines, 'item', 'items') + ', ' + signed(d.units) + ' units',
        diffColor: d.lines && c.status !== 'counting' && c.status !== 'cancelled' ? 'var(--foreground)' : 'var(--muted-foreground)',
        hasDiff: !(c.status === 'counting' || c.status === 'cancelled'),
        started: short(c.created), aria: 'Open ' + c.ref, menuOpen: menuOpen, menuAria: 'Actions for ' + c.ref, toggleMenu: function () { up({ menu: menuOpen ? null : c.id }); },
        canCancel: open, ask: function () { up({ menu: null, confirm: c.id }); },
        meta: scopeText(c) + ' · ' + short(c.created)
      };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyText = st === 'all' ? 'No counts yet.' : 'No counts here.';
    vals.emptyCanReset = st !== 'all';
    vals.emptyReset = function () { up({ st: 'all' }); };
    var mOpen = s.menu ? counts.filter(function (c) { return c.id === s.menu; })[0] : null;
    vals.menuOpen = Boolean(mOpen);
    vals.mx = rowOf(mOpen || counts[0]);
    var cf = s.confirm ? counts.filter(function (c) { return c.id === s.confirm; })[0] : null;
    vals.confirmOpen = Boolean(cf);
    vals.confirmTitle = cf ? 'Cancel ' + cf.ref + '?' : '';
    vals.doCancel = function () { up({ counts: counts.map(function (c) { return c.id === cf.id ? Object.assign({}, c, { status: 'cancelled' }) : c; }), confirm: null, toast: toast('Count cancelled.') }); };
    vals.cancelConfirm = function () { up({ confirm: null }); };

    // New count.
    var kind = s.kind || 'all';
    var cats = [], tags = [];
    VARIANTS.forEach(function (v) { if (v.track && cats.indexOf(v.cat) === -1) cats.push(v.cat); v.tags.forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); }); });
    var tracked = VARIANTS.filter(function (v) { return v.track; });
    var chosen = s.chosen || [];
    var allCombos = {};
    var combo = function (key, cfg) {
      var open = s.combo === key;
      var ql = open ? (s.cq || '').trim().toLowerCase() : '';
      var opts = cfg.options.filter(function (o) { return !ql || (o.label + ' ' + (o.sub || '')).toLowerCase().indexOf(ql) !== -1; });
      var cur = cfg.options.filter(function (o) { return o.v === cfg.current; })[0];
      var obj = {
        open: open, aria: open ? 'true' : 'false', title: cfg.title, ph: cfg.ph, query: open ? (s.cq || '') : '', none: opts.length === 0, disabled: false,
        display: cur ? cur.label : cfg.placeholder, color: cur ? 'var(--foreground)' : 'var(--muted-foreground)',
        toggle: function () { up({ combo: open ? null : key, cq: '' }); }, onQuery: function (e) { up({ cq: e.target.value }); },
        items: opts.map(function (o) { var on = o.v === cfg.current; return { label: o.label, sub: o.sub || '', hasSub: Boolean(o.sub), check: on ? '1' : '0', aria: on ? 'true' : 'false', pick: function () { cfg.onPick(o.v); } }; })
      };
      allCombos[key] = obj;
      return obj;
    };
    var nf = {
      open: Boolean(s.form),
      kinds: KINDS.map(function (k) {
        var on = kind === k[0];
        return { label: k[1], sub: k[0] === 'all' ? 'All ' + tracked.length + ' tracked items. Best done when the shop is closed.' : k[2], aria: on ? 'true' : 'false', on: on, pick: function () { up({ kind: k[0] }); } };
      }),
      isCat: kind === 'category', isTag: kind === 'tag', isItems: kind === 'variants',
      cat: combo('cat', { title: 'Category', ph: 'Search categories', placeholder: 'Choose a category', current: s.cat || '', options: cats.map(function (c) { return { v: c, label: c, sub: plural(tracked.filter(function (v) { return v.cat === c; }).length, 'item', 'items') }; }), onPick: function (v) { up({ cat: v, combo: null }); } }),
      tag: combo('tag', { title: 'Tag', ph: 'Search tags', placeholder: 'Choose a tag', current: s.tag || '', options: tags.map(function (t) { return { v: t, label: t, sub: plural(tracked.filter(function (v) { return v.tags.indexOf(t) !== -1; }).length, 'item', 'items') }; }), onPick: function (v) { up({ tag: v, combo: null }); } }),
      item: combo('item', { title: 'Add an item', ph: 'Search titles and SKUs', placeholder: 'Add an item', current: '', options: tracked.filter(function (v) { return chosen.indexOf(v.id) === -1; }).map(function (v) { return { v: v.id, label: label(v), sub: v.sku }; }), onPick: function (v) { up({ chosen: chosen.concat([v]), combo: null }); } }),
      chips: chosen.map(function (id) { var v = vById(id); return { label: label(v), removeAria: 'Remove ' + label(v), remove: function () { up({ chosen: chosen.filter(function (x) { return x !== id; }) }); } }; }),
      hasChips: chosen.length > 0,
      note: s.note || '', onNote: function (e) { up({ note: e.target.value }); }
    };
    var n = kind === 'all' ? tracked.length : kind === 'category' ? (s.cat ? tracked.filter(function (v) { return v.cat === s.cat; }).length : 0) : kind === 'tag' ? (s.tag ? tracked.filter(function (v) { return v.tags.indexOf(s.tag) !== -1; }).length : 0) : chosen.length;
    nf.cant = n === 0;
    nf.summary = n ? plural(n, 'item', 'items') + ' to count. Counters won’t see how many there should be.' : '';
    nf.hasSummary = n > 0;
    nf.start = function () {
      if (!n) return;
      var c = { id: 'sc8', ref: 'SC-0008', status: 'counting', scope: [kind, kind === 'category' ? s.cat : kind === 'tag' ? s.tag : String(n)], created: TODAY, note: (s.note || '').trim(), lines: [] };
      for (var i = 0; i < n; i++) c.lines.push(['v1', 0, null]);
      up({ counts: [c].concat(counts), form: false, kind: null, cat: null, tag: null, chosen: null, note: '', st: 'all', toast: toast('SC-0008 started. Open it to count.') });
    };
    vals.nf = nf;
    var active = allCombos[s.combo] || null;
    vals.comboOpen = Boolean(active) && Boolean(s.form);
    vals.cbd = active || nf.cat;
    vals.closeCombo = function () { up({ combo: null }); };
    vals.comboEsc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); up({ combo: null }); } };
    vals.newCount = function () { up({ form: true, kind: 'all' }); };
    vals.closeForm = function () { up({ form: false, combo: null }); };
    var reset = { menu: null, form: false, combo: null, confirm: null };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ menu: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(s.combo ? { combo: null } : reset); } };
    return vals;
  }
}
