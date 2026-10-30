var START = { Stock: {}, 'End of September': { asOf: 'sep' }, 'No sale in 90 days': { slow: 90 }, 'Export menu': { exp: 'cat' } };
var LOC = { v1: ['Shop', 'Warehouse'], v8: ['Shop'], v9: ['Shop', 'Warehouse'], v10: ['Warehouse'] };
var LAST_SOLD = { v3: '2026-07-14', v5: '2026-08-21', v11: '2026-09-02', v13: '2026-07-30', v16: null, v12: '2026-09-25', v2: '2026-10-27' };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Stock');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    reportVals(vals, s, up);
    vals.hasRange = false; vals.rg = rangeOf(s, up).rg;
    var asOf = s.asOf || 'today', days = s.slow || 60;
    vals.controls.push(seg('asof', 'Value on', [['today', 'Today'], ['sep', 'End of September'], ['aug', 'End of August']], asOf, function (k) { up({ asOf: k, exp: null }); }));
    vals.controls.push(seg('slow', 'Slow movers: no sale in', [[30, '30 days'], [60, '60 days'], [90, '90 days']], days, function (k) { up({ slow: k, exp: null }); }));
    var shift = asOf === 'today' ? 0 : asOf === 'sep' ? 1 : 2;
    var vs = VARIANTS.filter(function (v) { return v.track; }).map(function (v, i) { return Object.assign({}, v, { oh: Math.max(0, v.oh + shift * ((i % 3) + 1)) }); });
    var value = function (v) { return v.cost === null ? 0 : v.oh * v.cost; };
    var total = vs.reduce(function (a, v) { return a + value(v); }, 0), units = vs.reduce(function (a, v) { return a + v.oh; }, 0);
    var noCost = vs.filter(function (v) { return v.cost === null; }).reduce(function (a, v) { return a + v.oh; }, 0);
    var cutoff = addDays(TODAY, -days);
    var slow = vs.filter(function (v) { return v.oh > 0 && v.id in LAST_SOLD && (LAST_SOLD[v.id] === null || LAST_SOLD[v.id] < cutoff); });
    vals.stats = [stat('Stock value', money(total)), stat('Units on hand', count(units)), stat('Slow movers', count(slow.length)), stat('Below zero', asOf === 'today' ? '1' : '0')];
    if (noCost) vals.notes.push(note(noCost + ' units on hand have no cost and count as zero.', 'warn'));
    vals.notes.push(note('Average costs are rounded to the poisha per unit.'));
    var cats = {};
    vs.forEach(function (v) { var c = cats[v.cat] || (cats[v.cat] = [0, 0]); c[0] += v.oh; c[1] += value(v); });
    var crows = Object.keys(cats).sort(function (a, c) { return cats[c][1] - cats[a][1]; }).map(function (k) { return row([first(k), cell(count(cats[k][0])), cell(money(cats[k][1])), cell(pct(cats[k][1], total), { color: 'var(--muted-foreground)' })]); });
    crows.push(row([first('Total', { bold: true }), cell(count(units), { bold: true }), cell(money(total), { bold: true }), cell('100%', { bold: true })], { total: true }));
    vals.blocks.push(table(s, up, toast, 'cat', 'By category', ['Category', 'On hand', 'Value', 'Share'], crows));
    var shopV = Math.round(total * 0.62), shopU = Math.round(units * 0.58);
    vals.blocks.push(table(s, up, toast, 'loc', 'By location', ['Location', 'On hand', 'Value'], [row([first('Shop, Mirpur'), cell(count(shopU)), cell(money(shopV))]), row([first('Warehouse, Mohammadpur'), cell(count(units - shopU)), cell(money(total - shopV))]), row([first('Total', { bold: true }), cell(count(units), { bold: true }), cell(money(total), { bold: true })], { total: true })]));
    vals.blocks.push(table(s, up, toast, 'slow', 'Slow movers', ['Variant', 'On hand', 'Value', 'Last sold', 'No sale in'], slow.map(function (v) {
      var ls = LAST_SOLD[v.id];
      return row([first(label(v)), cell(count(v.oh)), cell(v.cost === null ? 'No cost' : money(value(v)), { color: v.cost === null ? 'var(--warn)' : 'var(--foreground)' }), cell(ls ? short(ls) + (ls.slice(0, 4) !== '2026' ? ', ' + ls.slice(0, 4) : '') : 'Never', { color: 'var(--muted-foreground)' }), cell(ls ? dayCount(ls, TODAY) - 1 + ' days' : '—', { bold: true })]);
    }), { full: true, sub: 'On hand, with no sale in ' + days + ' days.', empty: 'Everything on hand sold in the last ' + days + ' days.' }));
    vals.blocks.push(table(s, up, toast, 'neg', 'Below zero', ['Variant', 'Location', 'On hand'], asOf === 'today' ? [row([first('Silk Panjabi — Navy / XL'), cell('Shop, Mirpur'), cell('−1', { bold: true, color: 'var(--destructive)' })])] : [], { full: true, sub: 'Sold ahead of stock. Not taken off the value.', empty: 'Nothing below zero.' }));
    vals.blocks.push(table(s, up, toast, 'var', 'By variant', ['Variant', 'On hand', 'Unit cost', 'Value'], vs.slice().sort(function (a, c) { return value(c) - value(a); }).map(function (v) {
      return row([first(label(v)), cell(count(v.oh)), cell(v.cost === null ? 'No cost' : money(v.cost), { color: v.cost === null ? 'var(--warn)' : 'var(--foreground)' }), cell(money(value(v)), { bold: true })]);
    }), { full: true }));
    return finish(vals);
  }
}
