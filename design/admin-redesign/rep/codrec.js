var START = { 'COD reconciliation': {}, Steadfast: { courier: 'Steadfast' }, 'Import a statement': { imp: true }, 'Statement checked': { imp: true, checked: true }, 'Record a payout': { man: true }, 'Export menu': { exp: 'courier' } };
var CR = [['Steadfast', 214, 512800, 509350, 15020, 451980, 42350], ['Pathao', 131, 318400, 316900, 9170, 280840, 26890], ['RedX', 38, 87300, 87300, 2660, 78520, 6120]];
var UNPAID = [['1040', 'Steadfast', 'SF-88140412', '2026-10-19', 4200, 70], ['1036', 'Pathao', 'PT-25M1ZD', '2026-10-18', 3640, 70], ['1031', 'Steadfast', 'SF-88112031', '2026-10-14', 2750, 70], ['1052', 'Steadfast', 'SF-88201455', '2026-10-27', 1920, 70], ['1050', 'Pathao', 'PT-27A9QK', '2026-10-28', 0, 70], ['1044', 'RedX', 'RX-553108', '2026-10-25', 2830, 60]];
var DIFFS = [['1029', 'Steadfast', 'Collected ৳1,200 of ৳1,450'], ['1022', 'Pathao', 'Paid ৳2,150, expected ৳2,230'], ['1015', 'Steadfast', 'Collected ৳0 of ৳3,200']];
var PAYOUTS = [['2026-10-27', 'Steadfast', 'SFP-102741', 'From the courier', 118400], ['2026-10-24', 'Pathao', 'PTH-77310', 'Imported', 86250], ['2026-10-20', 'Steadfast', 'SFP-102388', 'From the courier', 131200], ['2026-10-18', 'RedX', 'Bank 7781', 'Recorded by hand', 39260], ['2026-10-13', 'Steadfast', 'SFP-101902', 'From the courier', 103300]];
var COLS = ['Consignment ID', 'Invoice', 'COD Amount', 'Delivery Charge', 'Status', 'Date'];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'COD reconciliation');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    reportVals(vals, s, up);
    var R = rangeOf(s, up); vals.rg = R.rg; vals.hasRange = true;
    var courier = s.courier || 'all';
    vals.controls.push(seg('courier', 'Courier', [['all', 'All couriers'], ['Steadfast', 'Steadfast'], ['Pathao', 'Pathao'], ['RedX', 'RedX']], courier, function (k) { up({ courier: k, exp: null }); }));
    if (!R.hasData) { vals.noData = true; if (!R.valid) vals.noDataText = 'The end date comes before the start.'; }
    var k = R.hasData ? sumDays(R.from, R.to).orders / 462 : 0, sc = function (v) { return Math.round(v * k / 10) * 10; };
    var paidExtra = s.paid || {};
    if (R.hasData) {
    var crs = CR.filter(function (c) { return courier === 'all' || c[0] === courier; }).map(function (c) { var po = sc(c[5]) + (paidExtra[c[0]] || 0); return [c[0], Math.round(c[1] * k), sc(c[2]), sc(c[3]), sc(c[4]), sc(c[3]) - sc(c[4]), po, Math.max(0, sc(c[3]) - sc(c[4]) - po)]; });
    var sum = function (i) { return crs.reduce(function (a, c) { return a + c[i]; }, 0); };
    vals.stats = [stat('Collected', money(sum(3))), stat('Due to you', money(sum(5))), stat('Paid out', money(sum(6))), stat('Outstanding', money(sum(7)))];
    var rows = crs.map(function (c) { return row([first(c[0]), cell(count(c[1])), cell(money(c[2])), cell(money(c[3])), cell('−' + money(c[4]), { color: 'var(--muted-foreground)' }), cell(money(c[5])), cell(money(c[6])), cell(money(c[7]), { bold: true, color: c[7] ? 'var(--foreground)' : 'var(--success)' })]); });
    if (crs.length > 1) rows.push(row([first('Total', { bold: true }), cell(count(sum(1)), { bold: true }), cell(money(sum(2)), { bold: true }), cell(money(sum(3)), { bold: true }), cell('−' + money(sum(4)), { bold: true }), cell(money(sum(5)), { bold: true }), cell(money(sum(6)), { bold: true }), cell(money(sum(7)), { bold: true })], { total: true }));
    vals.blocks.push(table(s, up, toast, 'courier', 'By courier', ['Courier', 'Delivered', 'To collect', 'Collected', 'Fees', 'Due to you', 'Paid out', 'Outstanding'], rows, { full: true, sub: 'Parcels delivered ' + rangeText(R.from, R.to) + '.' }));
    var mine = function (x) { return courier === 'all' || x[1] === courier; };
    vals.blocks.push(table(s, up, toast, 'unpaid', 'Delivered, not paid out yet', ['Parcel', 'Delivered', 'Collected', 'Fee', 'Days'], UNPAID.filter(mine).map(function (u) {
      var d = dayCount(u[3], TODAY) - 1;
      return row([first('#' + u[0] + ' · ' + u[1] + ' ' + u[2]), cell(short(u[3])), cell(u[4] ? money(u[4]) : 'Paid online', { color: u[4] ? 'var(--foreground)' : 'var(--muted-foreground)' }), cell('−' + money(u[5]), { color: 'var(--muted-foreground)' }), cell(d + ' days', { color: d > 14 ? 'var(--warn)' : 'var(--foreground)', bold: d > 14 })]);
    }), { full: true, empty: 'Every delivered parcel is paid out.' }));
    vals.blocks.push(table(s, up, toast, 'diff', 'Differences', ['Order', 'Courier', 'What'], DIFFS.filter(mine).map(function (x) { return row([first('#' + x[0]), cell(x[1]), cell(x[2], { color: 'var(--destructive)' })]); }), { empty: 'No differences.' }));
    var pays = (s.payouts || []).concat(PAYOUTS).filter(mine);
    vals.blocks.push(table(s, up, toast, 'payouts', 'Payouts', ['Paid on', 'Courier', 'Reference', 'Amount'], pays.map(function (p) { return row([first(short(p[0])), cell(p[1]), cell(p[2] + ' · ' + p[3], { color: 'var(--muted-foreground)' }), cell(money(p[4]), { bold: true })]); }), { empty: 'No payouts in these dates.' }));

    }
    // Import a statement.
    var im = s.im || { courier: 'Steadfast', cons: 'Consignment ID', coll: 'COD Amount', fee: 'Delivery Charge', ref: 'SFP-103016', date: '2026-10-29' };
    var setI = function (kk, v) { var n = Object.assign({}, im); n[kk] = v; up({ im: n, checked: false }); };
    var colPick = function (kk, opt) { return (opt ? ['—'] : []).concat(COLS).map(function (c) { return { label: c, on: im[kk] === c ? 'true' : 'false', pick: function () { setI(kk, c); } }; }); };
    vals.im = {
      open: Boolean(s.imp), file: 'steadfast-payout-2026-10-29.xlsx', fileMeta: '17 rows · 6 columns',
      couriers: CR.map(function (c) { return { label: c[0], on: im.courier === c[0] ? 'true' : 'false', pick: function () { setI('courier', c[0]); } }; }),
      cons: colPick('cons'), coll: colPick('coll', true), fee: colPick('fee', true),
      ref: im.ref, onRef: function (e) { setI('ref', e.target.value); }, date: im.date, onDate: function (e) { setI('date', e.target.value); },
      checked: Boolean(s.checked), notChecked: !s.checked, check: function () { up({ checked: true }); },
      matched: '14 parcels match: ' + money(31240) + ' due', unknown: 'Not ours: SF-87001234, SF-87001240', already: 'Already paid: SF-88112031',
      save: function () { if (!s.checked) { up({ checked: true }); return; } var pe = Object.assign({}, paidExtra); pe[im.courier] = (pe[im.courier] || 0) + 31240; up({ imp: false, checked: false, im: null, paid: pe, payouts: [[im.date, im.courier, im.ref, 'Imported', 31240]].concat(s.payouts || []), toast: toast('Payout recorded: ' + money(31240) + ' from ' + im.courier + '.') }); }
    };
    vals.openImport = function () { up({ imp: true, checked: false, im: null }); };
    vals.closeImport = function () { up({ imp: false, checked: false }); };
    // Record by hand.
    var mp = s.mp || { courier: 'RedX', ref: '', date: '2026-10-29', amount: '' };
    var setM = function (kk, v) { var n = Object.assign({}, mp); n[kk] = v; up({ mp: n }); };
    var amt = num(mp.amount), bad = Boolean(s.mtried) && !(amt > 0);
    vals.mp = {
      open: Boolean(s.man), couriers: CR.map(function (c) { var on = mp.courier === c[0]; return { label: c[0], hasSub: true, sub: money(Math.max(0, sc(c[3]) - sc(c[4]) - sc(c[5]) - (paidExtra[c[0]] || 0))) + ' outstanding', on: on, aria: on ? 'true' : 'false', pick: function () { setM('courier', c[0]); } }; }),
      ref: mp.ref, onRef: function (e) { setM('ref', e.target.value); }, date: mp.date, onDate: function (e) { setM('date', e.target.value); },
      amount: mp.amount, onAmount: function (e) { setM('amount', e.target.value); }, bad: bad, aria: bad ? 'true' : 'false',
      save: function () { if (!(amt > 0)) { up({ mtried: true }); return; } var pe = Object.assign({}, paidExtra); pe[mp.courier] = (pe[mp.courier] || 0) + amt; up({ man: false, mp: null, mtried: false, paid: pe, payouts: [[mp.date, mp.courier, mp.ref || '—', 'Recorded by hand', amt]].concat(s.payouts || []), toast: toast('Payout recorded: ' + money(amt) + ' from ' + mp.courier + '.') }); }
    };
    vals.openManual = function () { up({ man: true, mp: null, mtried: false }); };
    vals.closeManual = function () { up({ man: false, mtried: false }); };
    vals.closeAll = function () { up({ exp: null, rpop: false, imp: false, man: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ exp: null, rpop: false, imp: false, man: false }); } };
    return finish(vals);
  }
}
