var START = { Dashboard: {}, 'Last 30 days as a table': { asTable: true }, 'Usage check missing': { noUsage: true } };
// name, used, limit, unit
var FREE = [['Workers requests (daily)', 61240, 100000, 'requests'], ['D1 rows read (daily)', 3900000, 5000000, 'rows'], ['D1 rows written (daily)', 41800, 100000, 'rows'],
  ['KV writes (daily)', 640, 1000, 'writes'], ['R2 storage', 6.2, 10, 'GB'], ['Queues operations (daily)', 3900, 10000, 'operations']];
// store id, orders this month, products, emails this month, storage MB, domains
var USE = [['t2', 2140, 1320, 6210, 2310, 2], ['t7', 1080, 640, 3020, 1880, 1], ['t1', 482, 412, 1210, 820, 2], ['t4', 316, 205, 940, 410, 2], ['t3', 288, 1720, 610, 960, 1],
  ['t10', 241, 96, 520, 140, 1], ['t6', 0, 380, 12, 1210, 1], ['t5', 6, 22, 30, 45, 0], ['t9', 0, 0, 2, 0, 0]];
var SALES = (function () { var out = [], seed = 11; for (var i = 30; i >= 1; i--) { seed = (seed * 9301 + 49297) % 233280; var d = addDays(TODAY, -i), dow = new Date(d + 'T12:00:00Z').getUTCDay(); var base = 150000 + (dow === 5 ? -40000 : 0) + (i < 8 ? 20000 : 0); var net = Math.round((base + seed / 233280 * 70000) / 10) * 10; out.push({ d: d, net: net, orders: Math.round(net / 860) }); } return out; })();
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Dashboard');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var stores = P('PlatformStores');
    vals.stores = [['Active', 8], ['Still setting up', 3], ['Suspended', 1], ['Closed', 1]].map(function (x) { return { label: x[0], value: count(x[1]), href: stores, aria: x[0] + ': ' + x[1] + ' stores' }; });
    vals.hasUsage = !s.noUsage; vals.noUsage = Boolean(s.noUsage);
    vals.free = FREE.map(function (l) {
      var share = l[1] / l[2], near = share > 0.7, p = Math.round(share * 100);
      var fmt = function (v) { return l[3] === 'GB' ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : count(Math.round(v)); };
      return { name: l[0], text: fmt(l[1]) + ' / ' + fmt(l[2]) + ' ' + l[3] + ' (' + p + '%)', pct: Math.min(p, 100) + '%', color: near ? 'var(--destructive)' : 'var(--primary)', near: near };
    });
    vals.dead = 'Events 0 · Import chunks 2';
    var last = SALES[SALES.length - 1], month = SALES.filter(function (x) { return x.d >= '2026-10-01'; });
    var mNet = month.reduce(function (a, x) { return a + x.net; }, 0), mOrd = month.reduce(function (a, x) { return a + x.orders; }, 0);
    vals.sales = [{ label: 'Yesterday', value: money(last.net), note: plural(last.orders, 'order', 'orders') }, { label: 'This month', value: money(mNet), note: plural(mOrd, 'order', 'orders') }];
    var max = Math.max.apply(null, SALES.map(function (x) { return x.net; })), top = Math.ceil(max / 50000) * 50000;
    vals.trend = {
      ticks: [0, 0.5, 1].map(function (f) { return { pos: f * 100 + '%', label: f ? '৳' + Math.round(top * f / 1000) + 'K' : '৳0' }; }),
      bars: SALES.map(function (x, i) { return { h: (x.net / top * 100).toFixed(1) + '%', tip: short(x.d) + ': ' + money(x.net) + ' · ' + plural(x.orders, 'order', 'orders'), xl: i % 5 === 2 ? short(x.d) : '' }; }),
      rows: SALES.slice().reverse().map(function (x) { return { day: short(x.d), orders: count(x.orders), sales: money(x.net) }; }),
      asTable: Boolean(s.asTable), asChart: !s.asTable, toggleText: s.asTable ? 'Show as a chart' : 'Show as a table', toggle: function () { up({ asTable: !s.asTable }); }
    };
    vals.money = [{ label: 'Overdue', value: money(5500), note: '2 invoices', color: 'var(--destructive)', href: P('PlatformBilling') }, { label: 'Due this week', value: money(6370), note: '2 invoices', color: 'var(--muted-foreground)', href: P('PlatformBilling') },
      { label: 'Paid this month', value: money(9500), note: '4 invoices', color: 'var(--muted-foreground)', href: P('PlatformBilling') }];
    vals.use = USE.map(function (u) { var t = tById(u[0]); return { name: t[1], href: P('PlatformStore'), orders: count(u[1]), products: count(u[2]), emails: count(u[3]), storage: u[4] >= 1000 ? (u[4] / 1024).toFixed(1) + ' GB' : u[4] + ' MB', domains: String(u[5]) }; });
    return vals;
  }
}
