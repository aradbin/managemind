var START = { Overview: {}, 'Last month': { range: 'last' }, 'Export menu': { exp: 'paid' }, 'Nothing in these dates': { range: 'custom', from: '2026-01-01', to: '2026-01-31' } };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Overview');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    reportVals(vals, s, up);
    var R = rangeOf(s, up); vals.rg = R.rg; vals.hasRange = true;
    if (!R.hasData) { vals.noData = true; vals.noDataText = R.valid ? 'Nothing in these dates. Orders start on 1 Jul 2026.' : 'The end date comes before the start.'; return finish(vals); }
    var t = sumDays(R.from, R.to), k = t.orders / 462;
    var n = function (v) { return Math.max(0, Math.round(v * k)); };
    var placed = n(538), delivered = t.orders, returned = n(21), failed = n(29);
    vals.stats = [stat('Orders placed', count(placed)), stat('Delivered', count(delivered)), stat('Return rate', pct(returned, delivered)), stat('Confirmation rate', '86%')];
    var pay = [['Cash on delivery', n(371), Math.round(t.net * 0.074) * 10], ['Online', n(58), Math.round(t.net * 0.013) * 10], ['Recorded by staff', n(27), Math.round(t.net * 0.01) * 10], ['More than one way', n(6), Math.round(t.net * 0.003) * 10]];
    var po = pay.reduce(function (a, x) { return a + x[1]; }, 0), pr = pay.reduce(function (a, x) { return a + x[2]; }, 0);
    vals.blocks.push(table(s, up, toast, 'paid', 'How orders were paid', ['Paid by', 'Orders', 'Share', 'Received', 'Share'], pay.map(function (x) { return row([first(x[0]), cell(count(x[1])), cell(pct(x[1], po), { color: 'var(--muted-foreground)' }), cell(money(x[2])), cell(pct(x[2], pr), { color: 'var(--muted-foreground)' })]); })));
    var rp = [['Leather Sandal', n(34), n(4)], ['Embroidered Kurti', n(88), n(6)], ['Cotton Three-piece', n(61), n(3)], ['Cotton Panjabi', n(79), n(2)], ['Tangail Cotton Saree', n(57), n(1)]];
    vals.blocks.push(table(s, up, toast, 'retprod', 'Most returned products', ['Product', 'Delivered', 'Returned', 'Rate'], rp.map(function (x) { return row([first(x[0]), cell(count(x[1])), cell(count(x[2])), cell(pct(x[2], x[1]), { bold: true })]); })));
    var rr = [['Wrong size', n(8), n(9)], ['Damaged', n(5), n(5)], ['Not as described', n(4), n(5)], ['Wrong item', n(2), n(2)], ['Changed mind', n(2), n(2)]].filter(function (x) { return x[1]; });
    vals.blocks.push(table(s, up, toast, 'reason', 'Returns by reason', ['Reason', 'Returns', 'Units'], rr.map(function (x) { return row([first(x[0]), cell(count(x[1])), cell(count(x[2]))]); })));
    var rf = [['bKash', n(9), n(14250)], ['Bank transfer', n(3), n(9800)], ['Cash', n(2), n(2400)]].filter(function (x) { return x[1]; });
    vals.blocks.push(table(s, up, toast, 'refund', 'Refunds by method', ['Method', 'Refunds', 'Amount'], rf.map(function (x) { return row([first(x[0]), cell(count(x[1])), cell(money(x[2]))]); })));
    var fz = [['Inside Dhaka', n(318), n(12), 70], ['Chattogram city', n(84), n(7), 110], ['Outside Dhaka', n(91), n(10), 130]];
    var frows = fz.map(function (x) { return row([first(x[0]), cell(count(x[1])), cell(count(x[2])), cell(pct(x[2], x[1]), { bold: true }), cell(money(x[2] * x[3]))]); });
    frows.push(row([first('Total', { bold: true }), cell(count(fz.reduce(function (a, x) { return a + x[1]; }, 0)), { bold: true }), cell(count(failed), { bold: true }), cell(pct(failed, fz.reduce(function (a, x) { return a + x[1]; }, 0)), { bold: true }), cell(money(fz.reduce(function (a, x) { return a + x[2] * x[3]; }, 0)), { bold: true })], { total: true }));
    vals.blocks.push(table(s, up, toast, 'failed', 'Failed deliveries by zone', ['Zone', 'Shipped', 'Came back', 'Rate', 'Lost on trips'], frows, { full: true }));
    vals.blocks.push(heading('Sales recovery'));
    vals.blocks.push(table(s, up, toast, 'inc', 'Incomplete orders', ['What', 'Count', 'Amount'], [
      row([first('Saved at checkout'), cell(count(n(64))), cell(money(n(141800)))]), row([first('Called by staff'), cell(count(n(41))), cell('')]),
      row([first('Made into orders by staff'), cell(count(n(17))), cell(money(n(38900)))]), row([first('Finished by the shopper'), cell(count(n(9))), cell(money(n(21300)))]),
      row([first('…of them after a call', { indent: true, color: 'var(--muted-foreground)' }), cell(count(n(6)), { color: 'var(--muted-foreground)' }), cell('')]), row([first('Dismissed'), cell(count(n(12))), cell('')])]));
    vals.blocks.push(table(s, up, toast, 'conf', 'Confirmation', ['What', 'Orders', 'Share'], [
      row([first('Cash-on-delivery orders placed', { bold: true }), cell(count(n(452)), { bold: true }), cell('')]),
      row([first('Confirmed on a call', { indent: true }), cell(count(n(248))), cell(pct(248, 452))]), row([first('Confirmed by the SMS link', { indent: true }), cell(count(n(96))), cell(pct(96, 452))]),
      row([first('Confirmed by staff', { indent: true }), cell(count(n(41))), cell(pct(41, 452))]), row([first('Confirmed on its own', { indent: true }), cell(count(n(4))), cell(pct(4, 452))]),
      row([first('Cancelled before confirming: no answer', { indent: true }), cell(count(n(23))), cell(pct(23, 452))]), row([first('Cancelled before confirming: fake order', { indent: true }), cell(count(n(11))), cell(pct(11, 452))]),
      row([first('Unreachable'), cell(count(n(9))), cell('')]), row([first('Confirmation rate'), cell('86%', { bold: true }), cell('')]), row([first('Median time to confirm'), cell('38 min', { bold: true }), cell('')])]));
    vals.blocks.push(table(s, up, toast, 'score', 'Delivery by score when ordered', ['Score when ordered', 'Delivered', 'Not received', 'Rate'],
      [['80–100%', 341, 6], ['50–79%', 58, 9], ['Under 50%', 14, 11], ['New', 49, 3]].map(function (x) { return row([first(x[0]), cell(count(n(x[1]))), cell(count(n(x[2]))), cell(pct(x[2], x[1] + x[2]), { bold: true, color: x[2] / (x[1] + x[2]) > 0.3 ? 'var(--destructive)' : 'var(--foreground)' })]); }),
      { hint: 'Not received: refused or failed. A low score now means fewer parcels lost later.' }));
    vals.blocks.push(table(s, up, toast, 'dup', 'Duplicate orders', ['What', 'Orders'], [row([first('Flagged'), cell(count(n(18)))]), row([first('Merged'), cell(count(n(9)))]), row([first('Cancel as duplicate'), cell(count(n(5)))]), row([first('Not a duplicate'), cell(count(n(4)))])]));
    return finish(vals);
  }
}
