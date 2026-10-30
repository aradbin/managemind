var START = { Profit: {}, 'Last month': { range: 'last' }, 'Last 30 days': { range: 'l30' }, 'Export menu': { exp: 'stmt' }, 'Nothing in these dates': { range: 'custom', from: '2026-01-01', to: '2026-01-31' } };
function plOf(t, days) {
  var exp = EXPENSES.map(function (e) { return [e[0], Math.round(e[1] * days / 30 / 10) * 10]; });
  var x = { net: t.net, ret: t.ret, cogs: t.cogs, del: t.del, fees: t.orders * 70, failed: Math.round(t.orders * 0.06) * 130, loss: Math.round(1850 * days / 30 / 10) * 10, exp: exp, expTotal: exp.reduce(function (a, e) { return a + e[1]; }, 0) };
  x.gp = x.net - x.ret - x.cogs; x.dr = x.del - x.fees - x.failed; x.np = x.gp + x.dr - x.loss - x.expTotal;
  return x;
}
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Profit');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    reportVals(vals, s, up);
    var R = rangeOf(s, up); vals.rg = R.rg; vals.hasRange = true;
    if (!R.hasData) { vals.noData = true; if (!R.valid) vals.noDataText = 'The end date comes before the start.'; return finish(vals); }
    var c = plOf(sumDays(R.from, R.to), R.days), pf = addDays(R.from, -R.days), p = plOf(sumDays(pf, addDays(R.from, -1)), R.days);
    var hasPrev = pf >= FIRST_DAY;
    vals.stats = [stat('Net sales', money(c.net), hasPrev ? change(c.net, p.net) : null), stat('Gross profit', money(c.gp), hasPrev ? change(c.gp, p.gp) : null), stat('Expenses', money(c.expTotal), null), stat('Net profit', money(c.np), hasPrev ? change(c.np, p.np) : null)];
    vals.notes.push(note('8 delivered units had no cost, so profit is overstated. Set their costs on the products, or receive them on a purchase order.', 'warn'));
    var line = function (label, key, o) {
      o = o || {}; var neg = o.neg, cv = c[key], pv = p[key], ch = change(cv, pv);
      var fmt = function (v) { return neg ? '−' + money(v) : money(v); };
      return row([first(label, { bold: o.bold, indent: o.indent }), cell(fmt(cv), { bold: o.bold }), cell(hasPrev ? fmt(pv) : '—', { color: 'var(--muted-foreground)' }), cell(hasPrev ? ch.text : '—', { color: neg ? 'var(--muted-foreground)' : ch.color })], { total: o.bold, rule: o.rule });
    };
    vals.blocks.push(table(s, up, toast, 'stmt', 'Profit and loss', ['Line', 'This period', 'Before', 'Change'], [
      line('Net sales', 'net'), line('Less returns', 'ret', { neg: true, indent: true }), line('Less cost of goods sold', 'cogs', { neg: true, indent: true }), line('Gross profit', 'gp', { bold: true }),
      line('Delivery income', 'del'), line('Less courier fees', 'fees', { neg: true, indent: true }), line('Less failed deliveries', 'failed', { neg: true, indent: true }), line('Delivery result', 'dr', { bold: true }),
      line('Less stock losses', 'loss', { neg: true, indent: true }), line('Less expenses', 'expTotal', { neg: true, indent: true }), line('Net profit', 'np', { bold: true, rule: true })
    ], { sub: rangeText(R.from, R.to) + (hasPrev ? ', beside the ' + R.days + ' days before.' : '.'), hint: 'VAT collected in the period: ' + money(Math.round(c.net * 0.05)) + '. It is not part of sales.' }));
    var er = c.exp.slice().sort(function (x, y) { return y[1] - x[1]; }).map(function (e) { return row([first(e[0]), cell(money(e[1])), cell(pct(e[1], c.expTotal), { color: 'var(--muted-foreground)' })]); });
    er.push(row([first('Total', { bold: true }), cell(money(c.expTotal), { bold: true }), cell('100%', { bold: true })], { total: true }));
    vals.blocks.push(table(s, up, toast, 'exp', 'Expenses by category', ['Category', 'Amount', 'Share'], er, { link: L('ExpenseReport'), linkText: 'Expenses report' }));
    return finish(vals);
  }
}
