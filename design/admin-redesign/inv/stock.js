var START = {
  Stock: {}, 'Low stock only': { low: true }, 'Row menu': { menu: 'v2' }, 'Adjust stock': { adj: 'v2' },
  'Adjust: damaged': { adj: 'v7', mode: 'damaged', qty: '1', note: 'Torn at the seam' }, 'Adjust: counted': { adj: 'v2', mode: 'count', qty: '3' },
  'Stock history': { hist: 'v2' }
};
var MODE_GROUPS = [
  ['Adds stock', [['received', 'Received new stock'], ['returned', 'Returned by a customer'], ['correction', 'Correction']]],
  ['Takes stock out', [['damaged', 'Damaged'], ['lost', 'Lost'], ['expired', 'Expired'], ['sample', 'Sample, gift or own use']]],
  ['Sets the number', [['count', 'Counted the stock']]]
];
var OUT = ['damaged', 'lost', 'expired', 'sample'];
var REASON_WORD = { received: 'received', returned: 'returned', correction: 'correction', damaged: 'damaged', lost: 'lost', expired: 'expired', sample: 'sample', count: 'count' };
var MOVES = {
  v2: [
    ['2026-10-28', '15:10', 'Sold', -1, 'order #1051', ''],
    ['2026-10-27', '11:32', 'Reserved', -1, 'order #1053', ''],
    ['2026-10-22', '16:05', 'Received', 2, 'received', 'GRN-0031 from Islampur Fabrics'],
    ['2026-10-20', '13:40', 'Sold', -2, 'order #1044', ''],
    ['2026-10-18', '10:15', 'Received', 10, 'received', 'GRN-0029 from Islampur Fabrics'],
    ['2026-10-12', '17:15', 'Adjusted', -2, 'count', 'SC-0005'],
    ['2026-09-28', '14:10', 'Returned', 1, 'returned', 'Order #1011, wrong size']
  ]
};
var COSTS = {
  v2: [['Received', 640, 655, '2026-10-18', '10:15', 6], ['Received', 620, 640, '2026-09-02', '12:00', 2], ['Set by hand', null, 620, '2026-07-14', '09:30', 0]]
};
function movesOf(v, i) {
  if (MOVES[v.id]) return MOVES[v.id];
  var n = (i % 4) + 1;
  return [
    ['2026-10-27', '18:20', 'Sold', -1, 'order #105' + (i % 10), ''],
    ['2026-10-21', '12:05', 'Received', 4 + n * 2, 'received', 'GRN-0030'],
    ['2026-10-14', '15:45', 'Sold', -n, 'order #103' + (i % 10), ''],
    ['2026-09-30', '11:00', 'Adjusted', -1, 'damaged', '']
  ];
}
function costsOf(v) {
  if (COSTS[v.id]) return COSTS[v.id];
  if (v.cost === null) return [];
  return [['Received', Math.round(v.cost * 0.96), v.cost, '2026-10-21', '12:05', Math.max(0, v.oh - 6)]];
}

class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Stock');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var vs = s.vs || VARIANTS;
    var moves = s.moves || {};
    var q = (s.q || '').trim().toLowerCase();
    var low = Boolean(s.low);
    var tracked = vs.filter(function (v) { return v.track; });
    var units = tracked.reduce(function (a, v) { return a + v.oh; }, 0);
    var value = tracked.reduce(function (a, v) { return a + v.oh * (v.cost || 0); }, 0);
    var lows = vs.filter(isLow);
    vals.stats = [
      { label: 'Items tracked', value: String(tracked.length) },
      { label: 'Units on hand', value: units.toLocaleString('en-US') },
      { label: 'Value at cost', value: money(value) }
    ];
    vals.lowCount = String(lows.length);
    vals.lowPressed = low ? 'true' : 'false';
    vals.lowStatAria = low ? 'Show all stock' : 'Show only the ' + lows.length + ' items low on stock';

    var list = vs.filter(function (v) {
      return (!low || isLow(v)) && (!q || label(v).toLowerCase().indexOf(q) !== -1 || v.sku.toLowerCase().indexOf(q) !== -1);
    });
    var rowOf = function (v) {
      var a = available(v), menuOpen = s.menu === v.id;
      return {
        title: v.t, opts: v.o, hasOpts: Boolean(v.o), sku: v.sku, onHand: v.track ? String(v.oh) : '—', reserved: v.track ? String(v.rs) : '—',
        avail: v.track ? String(a) : 'Not tracked', isLow: isLow(v), tracked: v.track, untracked: !v.track,
        availColor: !v.track ? 'var(--muted-foreground)' : isLow(v) ? 'var(--destructive)' : 'var(--foreground)', availWeight: v.track ? '600' : '400',
        sub: [v.o, v.sku].filter(Boolean).join(' · '),
        histAria: 'Stock history for ' + label(v), adjustAria: 'Adjust stock for ' + label(v), menuAria: 'Actions for ' + label(v),
        menuOpen: menuOpen, toggleMenu: function () { up({ menu: menuOpen ? null : v.id }); },
        adjust: function () { up({ adj: v.id, mode: 'received', qty: '', note: '', menu: null, hist: null }); },
        history: function () { up({ hist: v.id, menu: null }); }
      };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyText = q || low ? 'No stock matches.' : 'No stock to show.';
    vals.q = s.q || '';
    vals.onQ = function (e) { up({ q: e.target.value }); };
    vals.lowOnly = low;
    vals.lowAria = low ? 'true' : 'false';
    vals.lowBox = low ? 'var(--primary)' : 'var(--background)';
    vals.lowEdge = low ? 'var(--primary)' : 'var(--input)';
    vals.lowText = low ? 'var(--primary-foreground)' : 'var(--foreground)';
    vals.toggleLow = function () { up({ low: !low }); };
    vals.hasFilters = Boolean(q || low);
    vals.clearAll = function () { up({ q: '', low: false }); };
    vals.countText = plural(list.length, 'item', 'items');
    vals.exportStock = function () { up({ toast: toast('Exported stock to Excel.') }); };
    var mOpen = s.menu ? vs.filter(function (v) { return v.id === s.menu; })[0] : null;
    vals.menuOpen = Boolean(mOpen);
    vals.mx = rowOf(mOpen || vs[0]);
    vals.mxTitle = mOpen ? label(mOpen) : '';

    // Adjust stock: what happened, how many, and a note.
    var av = s.adj ? vs.filter(function (v) { return v.id === s.adj; })[0] : null;
    var mode = s.mode || 'received';
    var amt = num(s.qty || '');
    var isCount = mode === 'count';
    var valid = (s.qty || '').trim() !== '' && amt !== null && Number.isInteger(amt) && (isCount ? amt >= 0 : amt > 0);
    var after = av ? (isCount ? amt : OUT.indexOf(mode) !== -1 ? av.oh - amt : av.oh + amt) : 0;
    vals.aj = {
      open: Boolean(av), sub: av ? label(av) : '',
      now: av ? 'Now: ' + av.oh + ' on hand, ' + av.rs + ' reserved.' : '',
      groups: MODE_GROUPS.map(function (g) {
        return {
          label: g[0], modes: g[1].map(function (m) {
            var on = mode === m[0];
            return { label: m[1], aria: on ? 'true' : 'false', on: on, pick: function () { up({ mode: m[0] }); } };
          })
        };
      }),
      isReceived: mode === 'received',
      qtyLabel: isCount ? 'How many there are' : 'Quantity', qty: s.qty || '', onQty: function (e) { up({ qty: e.target.value }); },
      showPreview: Boolean(av) && valid, preview: av && valid ? 'On hand: ' + av.oh + ' → ' + after : '',
      previewColor: after < (av ? av.oh : 0) ? 'var(--destructive)' : 'var(--foreground)',
      negative: Boolean(av) && valid && after < 0, negText: 'That leaves less than none on hand. Check the number.',
      note: s.note || '', onNote: function (e) { up({ note: e.target.value }); },
      cantSave: !valid || after < 0,
      save: function () {
        if (!valid || after < 0) return;
        var delta = after - av.oh;
        var mv = [TODAY, '12:00', isCount ? 'Adjusted' : delta > 0 ? (mode === 'returned' ? 'Returned' : mode === 'received' ? 'Received' : 'Adjusted') : 'Adjusted', delta, REASON_WORD[mode], (s.note || '').trim()];
        var nm = Object.assign({}, moves); nm[av.id] = [mv].concat(moves[av.id] || movesOf(av, vs.indexOf(av)));
        up({ vs: vs.map(function (v) { return v.id === av.id ? Object.assign({}, v, { oh: after }) : v; }), moves: nm, adj: null, qty: '', note: '', toast: toast('Stock updated.') });
      }
    };
    vals.closeAdj = function () { up({ adj: null, qty: '', note: '' }); };

    // Stock history: what it cost, then every change.
    var hv = s.hist ? vs.filter(function (v) { return v.id === s.hist; })[0] : null;
    var hm = hv ? (moves[hv.id] || movesOf(hv, vs.indexOf(hv))) : [];
    var hc = hv ? costsOf(hv) : [];
    vals.hs = {
      open: Boolean(hv), sub: hv ? label(hv) + ' · ' + hv.oh + ' on hand' : '',
      costs: hc.map(function (c) {
        return { source: c[0], change: (c[1] === null ? '—' : money(c[1])) + ' → ' + money(c[2]), meta: short(c[3]) + ', ' + clock(c[4]) + ' · ' + c[5] + ' on hand then' };
      }),
      hasCosts: hc.length > 0, noCosts: hc.length === 0,
      moves: hm.map(function (m) {
        return { type: m[2], qty: m[3] > 0 ? '+' + m[3] : '−' + Math.abs(m[3]), color: m[3] < 0 ? 'var(--destructive)' : 'var(--foreground)', meta: short(m[0]) + ', ' + clock(m[1]) + ' · ' + m[4], note: m[5], hasNote: Boolean(m[5]) };
      }),
      adjust: function () { up({ adj: hv.id, hist: null, mode: 'received', qty: '', note: '' }); }
    };
    vals.closeHist = function () { up({ hist: null }); };

    var reset = { menu: null, adj: null, hist: null, qty: '', note: '' };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ menu: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    return vals;
  }
}
