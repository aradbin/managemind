var START = { Sales: {}, 'By week': { by: 'week', range: 'l30' }, 'By month': { by: 'month', range: 'custom', from: '2026-07-01', to: '2026-10-29' }, 'Last month': { range: 'last' }, 'Custom dates': { range: 'custom', rpop: true, from: '2026-10-10', to: '2026-10-20' }, 'Export menu': { exp: 'period' }, 'Sorted by margin': { sort: 'margin' }, 'Nothing in these dates': { range: 'custom', from: '2026-01-01', to: '2026-01-31' } };
function bucketKey(d, by) {
  if (by === 'month') return d.slice(0, 7) + '-01';
  if (by === 'week') { var dow = (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7; return addDays(d, -dow); }
  return d;
}
function niceMax(v) { var p = Math.pow(10, Math.floor(Math.log10(v))); var m = v / p; return ([1.2, 1.6, 2, 3, 4, 6, 8, 10].filter(function (x) { return x >= m; })[0]) * p; }
function axis(v) { return v >= 100000 ? '৳' + Math.round(v / 1000) + 'K' : v >= 10000 ? '৳' + Math.round(v / 1000) + 'K' : money(v); }
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Sales');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    reportVals(vals, s, up);
    var R = rangeOf(s, up); vals.rg = R.rg; vals.hasRange = true;
    var by = s.by || 'day', sort = s.sort || 'net';
    vals.controls.push(seg('by', 'Show by', [['day', 'Day'], ['week', 'Week'], ['month', 'Month']], by, function (k) { up({ by: k, exp: null }); }));
    vals.notes.push(note('A sale counts on the day its goods were delivered, without VAT. Overview counts orders when they were placed.'));
    if (!R.hasData) { vals.noData = true; if (!R.valid) vals.noDataText = 'The end date comes before the start.'; return finish(vals); }
    var t = sumDays(R.from, R.to), pf = addDays(R.from, -R.days), pt = addDays(R.from, -1), p = sumDays(pf, pt);
    vals.stats = [stat('Orders delivered', count(t.orders), change(t.orders, p.orders)), stat('Units', count(t.units), change(t.units, p.units)),
      stat('Net sales', money(t.net), change(t.net, p.net)), stat('Returns', money(t.ret), null)];
    // Buckets.
    var keys = [], map = {};
    DAYS.forEach(function (x) {
      if (x.d < R.from || x.d > R.to) return;
      var k = bucketKey(x.d, by);
      if (!map[k]) { map[k] = { orders: 0, units: 0, gross: 0, disc: 0, net: 0, ret: 0, del: 0 }; keys.push(k); }
      ['orders', 'units', 'gross', 'disc', 'net', 'ret', 'del'].forEach(function (f) { map[k][f] += x[f]; });
    });
    var label = function (k) { return by === 'month' ? MONTHS[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4) : by === 'week' ? 'Week of ' + short(k) : short(k); };
    var max = niceMax(Math.max.apply(null, keys.map(function (k) { return map[k].net; })));
    var every = keys.length > 20 ? 7 : keys.length > 10 ? 2 : 1;
    vals.hasChart = true;
    vals.chart = {
      title: 'Net sales by ' + by, sub: rangeText(R.from, R.to),
      ticks: [0, 0.25, 0.5, 0.75, 1].map(function (f) { return { pos: f * 100 + '%', label: axis(max * f) }; }),
      bars: keys.map(function (k, i) { var x = map[k]; return { h: (x.net / max * 100).toFixed(1) + '%', tip: label(k) + ': ' + money(x.net) + ' · ' + plural(x.orders, 'order', 'orders'), xl: i % every === 0 ? (by === 'month' ? MONTHS[Number(k.slice(5, 7)) - 1].slice(0, 3) : short(k)) : '' }; })
    };
    var rows = keys.map(function (k) { var x = map[k]; return row([first(label(k)), cell(count(x.orders)), cell(count(x.units)), cell(money(x.gross)), cell(x.disc ? '−' + money(x.disc) : money(0)), cell(money(x.net), { bold: true }), cell(x.ret ? '−' + money(x.ret) : money(0)), cell(money(x.del))]); });
    rows.push(row([first('Total', { bold: true }), cell(count(t.orders), { bold: true }), cell(count(t.units), { bold: true }), cell(money(t.gross), { bold: true }), cell('−' + money(t.disc), { bold: true }), cell(money(t.net), { bold: true }), cell('−' + money(t.ret), { bold: true }), cell(money(t.del), { bold: true })], { total: true }));
    vals.blocks.push(table(s, up, toast, 'period', 'By period', ['Period', 'Orders delivered', 'Units', 'Gross sales', 'Discounts', 'Net sales', 'Returns', 'Delivery income'], rows, { full: true }));
    // By product.
    var prods = PRODUCTS.map(function (x) {
      var net = Math.round(t.net * x[1] / 10) * 10, units = Math.max(1, Math.round(net / x[2])), cogs = x[3] === null ? null : units * x[3];
      return { name: x[0], units: units, ret: Math.round(units * (x[0] === 'Embroidered Kurti' ? 0.06 : x[0] === 'Leather Sandal' ? 0.09 : 0.02)), net: net, cogs: cogs, gp: cogs === null ? null : net - cogs, margin: cogs === null ? null : (net - cogs) / net };
    });
    var keyOf = { net: 'net', units: 'units', profit: 'gp', margin: 'margin' }[sort];
    prods.sort(function (a, c) { return (c[keyOf] === null ? -Infinity : c[keyOf]) - (a[keyOf] === null ? -Infinity : a[keyOf]); });
    vals.controls.push(seg('sort', 'Products by', [['net', 'Net sales'], ['units', 'Units'], ['profit', 'Gross profit'], ['margin', 'Margin']], sort, function (k) { up({ sort: k, exp: null }); }));
    vals.blocks.push(table(s, up, toast, 'product', 'By product', ['Product', 'Units', 'Returned', 'Net sales', 'Cost of goods', 'Gross profit', 'Margin'], prods.map(function (x) {
      return row([first(x.name), cell(count(x.units)), cell(x.ret ? count(x.ret) : '—', { color: x.ret ? 'var(--foreground)' : 'var(--muted-foreground)' }), cell(money(x.net), { bold: true }),
        x.cogs === null ? cell(x.units + ' without cost', { color: 'var(--warn)' }) : cell(money(x.cogs)), cell(x.gp === null ? '—' : money(x.gp)), cell(x.margin === null ? '—' : Math.round(x.margin * 100) + '%')]);
    }), { full: true, hint: 'Batik Fatua — Indigo / XL has no cost yet, so its profit isn’t counted.' }));
    return finish(vals);
  }
}
