var START = { Expenses: {}, 'Since July': { range: 'custom', from: '2026-07-01', to: '2026-10-29' }, 'Export menu': { exp: 'month' }, 'Nothing in these dates': { range: 'custom', from: '2026-01-01', to: '2026-01-31' } };
var VARY = { Rent: [1, 1, 1, 1], Salaries: [1, 1, 1.08, 1.08], 'Facebook ads': [0.7, 0.85, 1.1, 1.45], Packaging: [0.8, 0.9, 1, 1.3], 'Electricity and internet': [1.1, 1.15, 1, 0.95], Transport: [0.9, 1, 1.2, 1.1], Other: [0.6, 1.4, 0.8, 1] };
function monthAmount(cat, base, m, from, to) {
  var mm = '2026-' + String(m + 7).padStart(2, '0'), start = mm + '-01', end = addDays(m === 3 ? '2026-11-01' : '2026-' + String(m + 8).padStart(2, '0') + '-01', -1);
  if (m === 3) end = '2026-10-29';
  var a = start < from ? from : start, z = end > to ? to : end;
  if (a > z) return 0;
  var full = dayCount(start, m === 3 ? '2026-10-31' : end);
  return Math.round(base * VARY[cat][m] * dayCount(a, z) / full / 10) * 10;
}
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Expenses');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    reportVals(vals, s, up);
    var R = rangeOf(s, up); vals.rg = R.rg; vals.hasRange = true;
    if (!R.hasData) { vals.noData = true; vals.noDataText = R.valid ? 'Nothing in these dates. Expenses start on 1 Jul 2026: import older ones to fill the year.' : 'The end date comes before the start.'; return finish(vals); }
    var months = [0, 1, 2, 3].filter(function (m) { return EXPENSES.some(function (e) { return monthAmount(e[0], e[1], m, R.from, R.to) > 0; }); });
    var grid = EXPENSES.map(function (e) { return { name: e[0], vals: months.map(function (m) { return monthAmount(e[0], e[1], m, R.from, R.to); }) }; });
    grid.forEach(function (g) { g.total = g.vals.reduce(function (a, v) { return a + v; }, 0); });
    grid.sort(function (a, c) { return c.total - a.total; });
    var total = grid.reduce(function (a, g) { return a + g.total; }, 0);
    var mtot = months.map(function (m, i) { return grid.reduce(function (a, g) { return a + g.vals[i]; }, 0); });
    vals.stats = [stat('Spent', money(total)), stat('Per day', money(Math.round(total / R.days))), stat('Biggest', grid[0].name), stat('Categories', count(grid.length))];
    var rows = grid.map(function (g) { return row([first(g.name)].concat(g.vals.map(function (v) { return cell(v ? money(v) : '—', { color: v ? 'var(--foreground)' : 'var(--muted-foreground)' }); }), [cell(money(g.total), { bold: true })])); });
    rows.push(row([first('Total', { bold: true })].concat(mtot.map(function (v) { return cell(money(v), { bold: true }); }), [cell(money(total), { bold: true })]), { total: true }));
    vals.blocks.push(table(s, up, toast, 'month', 'By category and month', ['Category'].concat(months.map(function (m) { return MONTHS[m + 6].slice(0, 3) + (R.from > '2026-' + String(m + 7).padStart(2, '0') + '-01' || (m === 3 && R.to < '2026-10-31') ? '*' : ''); }), ['Total']), rows, { full: true, hint: '* Part of the month, inside the dates you chose.' }));
    return finish(vals);
  }
}
