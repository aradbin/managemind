var CRETURNS = [
  { id: 'c1', n: 1047, name: 'Tanvir Hasan', courier: 'Steadfast', cons: 'SF-88190021', reason: 'Customer refused at the door', lines: [['v12', 1]], status: 'returned', since: '2026-10-28 18:10', cost: 0 },
  { id: 'c2', n: 1039, name: 'Moushumi Akter', courier: 'Pathao', cons: 'PT-26Z8LM', reason: 'Couldn’t reach the customer', lines: [['v6', 2]], status: 'coming', since: '2026-10-27 14:00', cost: 0 },
  { id: 'c3', n: 1036, name: 'Jahid Hasan', courier: 'Steadfast', cons: 'SF-88150871', reason: 'Wrong address', lines: [['v10', 1]], status: 'returned', since: '2026-10-27 11:30', cost: 0 },
  { id: 'c4', n: 1031, name: 'Sumi Begum', courier: 'RedX', cons: 'RX-552901', reason: 'Customer refused at the door', lines: [['v5', 1], ['v14', 1]], status: 'received', since: '2026-10-24 16:00', cost: 50 },
  { id: 'c5', n: 1028, name: 'Nasir Uddin', courier: 'Pathao', cons: 'PT-25X1AB', reason: 'The customer cancelled', lines: [['v4', 1]], status: 'received', since: '2026-10-22 12:40', cost: 60 }
];
var CR_ST = { coming: ['On its way back', 'move'], returned: ['Handed back', 'warn'], received: ['Received', 'good'] };
var START = { 'Courier returns': {}, Received: { tab: 'received' }, 'Mark received': { recv: 'c1' }, 'Some damaged': { recv: 'c3', rv: { bad: [1], cost: '60' } } };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Courier returns');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var all = s.list || CRETURNS;
    var tab = s.tab || 'open';
    var q = (s.q || '').trim().toLowerCase().replace(/^#/, '');
    var base = all.filter(function (c) { return !q || String(c.n).indexOf(q) !== -1 || c.name.toLowerCase().indexOf(q) !== -1 || c.cons.toLowerCase().indexOf(q) !== -1; });
    var inTab = function (c, t) { return t === 'received' ? c.status === 'received' : c.status !== 'received'; };
    vals.tabs = [['open', 'Coming back'], ['received', 'Received']].map(function (t) { var n = base.filter(function (c) { return inTab(c, t[0]); }).length; return { label: t[1], count: n ? String(n) : '', on: tab === t[0] ? 'true' : 'false', pick: function () { up({ tab: t[0] }); } }; });
    var list = base.filter(function (c) { return inTab(c, tab); });
    var goods = function (c) { return c.lines.reduce(function (a, l) { return a + l[1] * PRICE[l[0]]; }, 0); };
    var rowOf = function (c) {
      var st = CR_ST[c.status], tn = TONE[st[1]];
      return { n: '#' + c.n, name: c.name, courier: c.courier, cons: c.cons, reason: c.reason, since: when(c.since), items: itemsText(c.lines), value: money(goods(c)),
        chip: { label: st[0], bg: tn[0], fg: tn[1], edge: 'transparent' }, open: c.status !== 'received', done: c.status === 'received',
        cost: c.cost ? money(c.cost) + ' return cost' : 'No return cost', meta: c.courier + ' · ' + c.cons, aria: 'Mark the parcel for #' + c.n + ' received',
        receive: function () { up({ recv: c.id, rv: null }); } };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyText = q ? 'No parcels match.' : tab === 'open' ? 'Nothing is coming back.' : 'No parcels received yet.';
    vals.emptyCanReset = Boolean(q); vals.emptyReset = function () { up({ q: '' }); };
    vals.hasFilters = Boolean(q); vals.clearAll = function () { up({ q: '' }); };
    vals.q = s.q || ''; vals.onQ = function (e) { up({ q: e.target.value }); };
    var open = all.filter(function (c) { return c.status !== 'received'; });
    vals.summary = plural(open.length, 'parcel', 'parcels') + ' coming back · ' + money(open.reduce(function (a, c) { return a + goods(c); }, 0)) + ' in goods';

    // Mark received.
    var c = s.recv ? all.filter(function (x) { return x.id === s.recv; })[0] : null;
    var rv = s.rv || (c ? { bad: c.lines.map(function () { return 0; }), cost: '60' } : null);
    vals.rv = { open: Boolean(c), sub: c ? '#' + c.n + ' · ' + c.courier + ' ' + c.cons : '' };
    if (c) {
      var setR = function (patch) { up({ rv: Object.assign({}, rv, patch) }); };
      vals.rv.lines = c.lines.map(function (l, i) {
        var v = vById(l[0]), bad = rv.bad[i];
        return { title: v.t, opts: v.o || v.sku, qty: l[1] + ' ×', good: String(l[1] - bad), bad: String(bad), aria: 'Damaged ' + label(v),
          dec: function () { if (bad > 0) setR({ bad: rv.bad.map(function (x, j) { return j === i ? x - 1 : x; }) }); }, inc: function () { if (bad < l[1]) setR({ bad: rv.bad.map(function (x, j) { return j === i ? x + 1 : x; }) }); },
          decDis: bad <= 0, incDis: bad >= l[1], status: bad ? (l[1] - bad) + ' back in stock · ' + bad + ' damaged' : 'All back in stock', statusColor: bad ? 'var(--warn)' : 'var(--success)' };
      });
      vals.rv.cost = rv.cost; vals.rv.onCost = function (e) { setR({ cost: e.target.value }); };
      var back = c.lines.reduce(function (a, l, i) { return a + l[1] - rv.bad[i]; }, 0), dmg = rv.bad.reduce(function (a, x) { return a + x; }, 0);
      vals.rv.summary = (back ? plural(back, 'item goes', 'items go') + ' back in stock' : 'Nothing goes back in stock') + (dmg ? '. ' + plural(dmg, 'damaged item is', 'damaged items are') + ' written off as Damaged.' : '.');
      vals.rv.save = function () {
        var cost = num(rv.cost) || 0;
        up({ list: all.map(function (x) { return x.id === c.id ? Object.assign({}, x, { status: 'received', cost: cost }) : x; }), recv: null, rv: null, toast: toast('Received. ' + plural(back, 'item is', 'items are') + ' back in stock' + (cost ? ', ' + money(cost) + ' return cost recorded.' : '.')) });
      };
    } else { vals.rv.lines = []; vals.rv.cost = ''; vals.rv.onCost = function () {}; vals.rv.summary = ''; vals.rv.save = function () {}; }
    vals.closeRecv = function () { up({ recv: null, rv: null }); };
    vals.closeAll = vals.closeRecv;
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ recv: null, rv: null }); } };
    return vals;
  }
}
