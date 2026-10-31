var START = { 'COD outstanding': {}, 'Export menu': { exp: 'hold' } };
var HOLD = [['Steadfast', 18, 42350, [31200, 8400, 2750, 0], 12], ['Pathao', 11, 26890, [14300, 9840, 0, 2750], 34], ['RedX', 3, 6120, [6120, 0, 0, 0], 4], ['Own riders', 4, 7980, [5480, 2500, 0, 0], 9]];
var OLDEST = [['1019', 'Pathao', 'PT-23K8QW', '2026-09-25', 2750], ['1031', 'Steadfast', 'SF-88112031', '2026-10-14', 2750], ['1034', 'Own rider: Babul', '', '2026-10-17', 2500], ['1036', 'Pathao', 'PT-25M1ZD', '2026-10-18', 3640], ['1040', 'Steadfast', 'SF-88140412', '2026-10-19', 4200]];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'COD outstanding');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    reportVals(vals, s, up);
    vals.hasRange = false; vals.rg = rangeOf(s, up).rg;
    var tot = HOLD.reduce(function (a, h) { return a + h[2]; }, 0), parcels = HOLD.reduce(function (a, h) { return a + h[1]; }, 0);
    var ages = [0, 1, 2, 3].map(function (i) { return HOLD.reduce(function (a, h) { return a + h[3][i]; }, 0); });
    vals.stats = [stat('Outstanding', money(tot)), stat('Parcels', count(parcels)), stat('Over 30 days', money(ages[3])), stat('Oldest', '34 days')];
    vals.notes.push(note('Couriers: what they owe for parcels no payout covers, less their fee. Own riders: orders delivered without the cash marked as received.'));
    var age = function (v, i) { return cell(v ? money(v) : '—', { color: !v ? 'var(--muted-foreground)' : i === 3 ? 'var(--destructive)' : i === 2 ? 'var(--warn)' : 'var(--foreground)', bold: v > 0 && i >= 2 }); };
    var rows = HOLD.map(function (h) { return row([first(h[0]), cell(count(h[1])), cell(money(h[2]), { bold: true })].concat(h[3].map(age), [cell(h[4] + ' days', { color: h[4] > 30 ? 'var(--destructive)' : 'var(--foreground)' })])); });
    rows.push(row([first('Total', { bold: true }), cell(count(parcels), { bold: true }), cell(money(tot), { bold: true })].concat(ages.map(function (v) { return cell(money(v), { bold: true }); }), [cell('34 days', { bold: true })]), { total: true }));
    vals.blocks.push(table(s, up, toast, 'hold', 'Who holds it', ['Held by', 'Parcels', 'Amount', '0–7 days', '8–14 days', '15–30 days', 'Over 30 days', 'Oldest'], rows, { full: true, sub: 'Days since delivery.' }));
    vals.blocks.push(table(s, up, toast, 'old', 'Oldest parcels', ['Order', 'Held by', 'Delivered', 'Amount', 'Days'], OLDEST.map(function (o) {
      var d = dayCount(o[3], TODAY) - 1;
      return row([first('#' + o[0] + (o[2] ? ' · ' + o[2] : '')), cell(o[1]), cell(short(o[3])), cell(money(o[4]), { bold: true }), cell(d + ' days', { color: d > 30 ? 'var(--destructive)' : d > 14 ? 'var(--warn)' : 'var(--foreground)', bold: d > 14 })]);
    }), { full: true, link: L('CodReconciliation'), linkText: 'Open COD reconciliation' }));
    return finish(vals);
  }
}
