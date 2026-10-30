var START = { Suppliers: {}, 'Last month': { range: 'last' }, 'Export menu': { exp: 'age' } };
var AGES = { s1: [18000, 12500, 18000, 0], s3: [18650, 7350, 0, 0], s4: [0, 12800, 0, 0], s2: [-5000, 0, 0, 0] };
var BUYS = [['s1', '2026-08-28', 27500, 0], ['s1', '2026-09-05', 0, 20000], ['s1', '2026-10-06', 18000, 0], ['s1', '2026-10-15', 0, 8000], ['s3', '2026-09-28', 15500, 0], ['s3', '2026-10-01', 0, 18260], ['s3', '2026-10-18', 21410, 0], ['s3', '2026-10-22', 7350, 0], ['s4', '2026-10-09', 22800, 0], ['s4', '2026-10-10', 0, 10000], ['s2', '2026-08-02', 30000, 0], ['s2', '2026-08-03', 0, 35000], ['', '2026-10-12', 2400, 2400]];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Suppliers');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    reportVals(vals, s, up);
    var R = rangeOf(s, up); vals.rg = R.rg; vals.hasRange = true;
    var ids = Object.keys(AGES), sum = function (i) { return ids.reduce(function (a, k) { return a + Math.max(0, AGES[k][i]); }, 0); };
    var owed = [0, 1, 2, 3].reduce(function (a, i) { return a + sum(i); }, 0);
    var inR = BUYS.filter(function (x) { return x[1] >= R.from && x[1] <= R.to; });
    var rec = inR.reduce(function (a, x) { return a + x[2]; }, 0), paid = inR.reduce(function (a, x) { return a + x[3]; }, 0);
    vals.stats = [stat('You owe in all', money(owed)), stat('Over 60 days', money(sum(2) + sum(3))), stat('Received in the period', money(rec)), stat('Paid in the period', money(paid))];
    var amt = function (v) { return cell(v ? (v < 0 ? 'Advance ' + money(-v) : money(v)) : '—', { color: v > 0 ? 'var(--foreground)' : 'var(--muted-foreground)' }); };
    var arows = ids.map(function (k) { var a = AGES[k], tot = a[0] + a[1] + a[2] + a[3]; return row([first(sById(k).name), amt(a[0]), amt(a[1]), cell(a[2] ? money(a[2]) : '—', { color: a[2] ? 'var(--warn)' : 'var(--muted-foreground)', bold: a[2] > 0 }), amt(a[3]), amt(tot)]); });
    arows.push(row([first('Total', { bold: true }), cell(money(sum(0)), { bold: true }), cell(money(sum(1)), { bold: true }), cell(money(sum(2)), { bold: true }), cell(money(sum(3)), { bold: true }), cell(money(owed), { bold: true })], { total: true }));
    vals.blocks.push(table(s, up, toast, 'age', 'Dues by age, today', ['Supplier', '0–30 days', '31–60 days', '61–90 days', 'Over 90 days', 'Total'], arows, { full: true, sub: 'Counted from the day goods were received. Advances are left out of the total.' }));
    if (!R.hasData && R.valid) { vals.blocks.push(table(s, up, toast, 'buy', 'Purchases in the period', ['Supplier', 'Receipts', 'Received', 'Paid'], [], { full: true })); return finish(vals); }
    var by = {};
    inR.forEach(function (x) { var o = by[x[0]] || (by[x[0]] = [0, 0, 0]); if (x[2]) o[0]++; o[1] += x[2]; o[2] += x[3]; });
    var prow = Object.keys(by).map(function (k) { var o = by[k]; return row([first(k ? sById(k).name : 'Without a supplier', { color: k ? 'var(--foreground)' : 'var(--muted-foreground)' }), cell(count(o[0])), cell(money(o[1])), cell(money(o[2]))]); });
    if (prow.length) prow.push(row([first('Total', { bold: true }), cell(count(inR.filter(function (x) { return x[2]; }).length), { bold: true }), cell(money(rec), { bold: true }), cell(money(paid), { bold: true })], { total: true }));
    vals.blocks.push(table(s, up, toast, 'buy', 'Purchases in the period', ['Supplier', 'Receipts', 'Received', 'Paid'], prow, { full: true, sub: rangeText(R.from, R.to), empty: 'Nothing received or paid in these dates.' }));
    return finish(vals);
  }
}
