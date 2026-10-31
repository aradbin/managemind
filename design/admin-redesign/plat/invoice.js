var START = { 'Issued, overdue': { inv: 'INV-2026-0042' }, Draft: { inv: 'draft-t5' }, 'Record a payment': { inv: 'INV-2026-0042', panel: 'pay' }, 'Void dialog': { inv: 'INV-2026-0042', dlg: 'void' }, Paid: { inv: 'INV-2026-0045' } };
var LINES = { 'INV-2026-0042': [['Growth plan, 5 Oct to 4 Nov 2026 (negotiated)', 1, 1500]], 'draft-t5': [['Setup fee', 1, 5000], ['Starter plan, 18 Oct to 17 Nov 2026', 1, 1500]], 'INV-2026-0045': [['Starter plan, 2 Oct to 1 Nov 2026', 1, 1500]] };
var ADDR = { t1: 'Shop 14, Level 3, Bashundhara City\nPanthapath, Dhaka 1215', t5: 'Mirpur 10, Dhaka 1216', t3: '38/2 Banglabazar, Dhaka 1100' };
var PAY_METHODS = [['bank', 'Bank transfer'], ['bkash', 'bKash'], ['nagad', 'Nagad'], ['cash', 'Cash']];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Issued, overdue');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    vals.readOnly = false;
    var key = s.inv || 'INV-2026-0042';
    var row = key === 'draft-t5' ? INVOICES[0] : INVOICES.filter(function (i) { return i[0] === key; })[0];
    var status = s.status || row[2], number = s.status === 'issued' && !row[0] ? 'INV-2026-0048' : row[0];
    var t = tById(row[1]), lines = LINES[key];
    var total = lines.reduce(function (a, l) { return a + l[1] * l[2]; }, 0), paid = status === 'paid' ? total : (s.paidAmt || 0) + row[6];
    var i2 = [number, row[1], status, row[3] || TODAY, row[4], total, paid];
    vals.title = number ? 'Invoice ' + number : 'Draft invoice';
    vals.chip = invChip(i2);
    vals.isDraft = status === 'draft'; vals.isOpen = status === 'issued'; vals.isPaid = status === 'paid'; vals.isVoid = status === 'void';
    vals.canVoid = status === 'draft' || status === 'issued';
    vals.issueAfter = 'Issues itself on 1 Nov 2026 unless you act first.';
    vals.overdue = status === 'issued' && row[4] < TODAY;
    vals.overdueText = 'Overdue since ' + longDate(row[4]) + '. Reminders went to the owners on ' + short(addDays(row[4], 1)) + ' and ' + short(addDays(row[4], 8)) + '.';
    vals.meta = [['Issued', number ? longDate(row[3] || TODAY) : '—'], ['Due', longDate(row[4])], ['Period', row[7].replace(' – ', ' to ')]].map(function (r) { return { k: r[0], v: r[1] }; });
    vals.from = 'ManageMind Ltd.\nHouse 12, Road 7, Block C\nBanani, Dhaka 1213\nBIN: 004567891-0101\nTrade license: TRAD/DNCC/045812/2025\nbilling@managemind.app';
    vals.to = t[1] + '\n' + (ADDR[t[0]] || 'Dhaka') + '\n' + t[8][1];
    vals.lines = lines.map(function (l) { return { item: l[0], qty: String(l[1]), price: money(l[2]), amount: money(l[1] * l[2]) }; });
    vals.subtotal = money(total); vals.total = money(total); vals.paid = money(paid); vals.due = money(status === 'void' ? 0 : total - paid);
    vals.hasPaid = paid > 0;
    vals.payments = status === 'paid' ? [{ text: money(total) + ' by bKash on 24 Oct 2026 · ref 8KD4R2LQ' }] : (s.paidAmt ? [{ text: money(s.paidAmt) + ' by bank transfer on 29 Oct 2026' }] : []);
    vals.hasPayments = vals.payments.length > 0;
    vals.voidText = s.voidWhy ? 'Voided: ' + s.voidWhy : '';
    vals.storeHref = P('PlatformStore'); vals.store = t[1];
    vals.issue = function () { up({ status: 'issued', toast: toast('Invoice INV-2026-0048 issued. The owners were emailed.') }); };
    vals.openPay = function () { up({ panel: 'pay' }); }; vals.askVoid = function () { up({ dlg: 'void' }); };
    vals.print = function () { up({ toast: toast('Invoice is ready to print.') }); };
    // Record a payment.
    var owed = total - paid;
    var pf = pform(s, up, 'pf', { amount: String(owed), method: 'bank', ref: '', date: TODAY });
    vals.pf = pf; vals.methods = choice(pf, 'method', PAY_METHODS);
    vals.amountHint = 'Up to ' + money(owed) + ', what is due.';
    var amt = num(pf.cur.amount);
    vals.amtBad = Boolean(s.ptried) && (amt === null || amt <= 0 || amt > owed);
    vals.record = function () {
      if (amt === null || amt <= 0 || amt > owed) { up({ ptried: true }); return; }
      var full = amt === owed;
      up({ panel: null, pf: null, ptried: false, paidAmt: (s.paidAmt || 0) + amt, status: full ? 'paid' : null, toast: toast('Payment recorded.') });
    };
    // Void.
    var vf = pform(s, up, 'vf', { why: '' });
    vals.vf = vf; vals.whyBad = Boolean(s.vtried) && !vf.cur.why.trim();
    vals.voidIt = function () { if (!vf.cur.why.trim()) { up({ vtried: true }); return; } up({ dlg: null, vf: null, vtried: false, status: 'void', voidWhy: vf.cur.why.trim(), toast: toast('Invoice voided.') }); };
    vals.pn = { pay: s.panel === 'pay' }; vals.dl = { vd: s.dlg === 'void' };
    vals.closeAll = function () { up({ panel: null, dlg: null, pf: null, vf: null, ptried: false, vtried: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); vals.closeAll(); } };
    vals.closePop = function () {};
    return vals;
  }
}
