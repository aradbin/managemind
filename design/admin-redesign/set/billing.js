var START = { 'Plan and billing': {}, 'Free trial': { trial: true }, Invoice: { inv: 'INV-2026-0042' }, 'Payment overdue': { overdue: true } };
var INV = [['INV-2026-0042', '5 Oct – 4 Nov 2026', 1500, '2026-10-12', 'open'], ['INV-2026-0031', '5 Sep – 4 Oct 2026', 1500, '2026-09-12', 'paid'], ['INV-2026-0019', '5 Aug – 4 Sep 2026', 1500, '2026-08-12', 'paid'], ['INV-2026-0008', '5 Jul – 4 Aug 2026', 900, '2026-07-12', 'paid']];
var METERS = [['Products', 412, 1000], ['Staff', 4, 5], ['Orders', 482, 500], ['Emails', 1210, 3000], ['Image storage (MB)', 820, 2000], ['Custom domains', 2, 2]];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Plan and billing');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var st = s.trial ? 'trialing' : s.overdue ? 'past_due' : 'active';
    var stt = { trialing: ['Free trial', 'info'], active: ['Active', 'good'], past_due: ['Payment overdue', 'bad'] }[st];
    vals.plan = { name: 'Growth', price: '৳1,500 a month', chip: { label: stt[0], bg: TONE[stt[1]][0], fg: TONE[stt[1]][1], edge: 'transparent' }, day: s.trial ? 'Free until 12 Nov 2026' : 'Invoiced on day 5 of each month' };
    vals.overdue = Boolean(s.overdue);
    vals.meters = METERS.map(function (m) { var r = m[1] / m[2]; return { label: m[0], text: count(m[1]) + ' of ' + count(m[2]), pct: Math.min(100, Math.round(r * 100)) + '%', color: r >= 1 ? 'var(--destructive)' : r >= 0.9 ? 'var(--warn)' : 'var(--primary)', note: r >= 1 ? 'Your plan’s limit is reached.' : r >= 0.9 ? 'Near your plan’s limit.' : '', hasNote: r >= 0.9, noteColor: r >= 1 ? 'var(--destructive)' : 'var(--warn)' }; });
    var paid = s.paid || [];
    vals.invoices = INV.map(function (i) {
      var status = paid.indexOf(i[0]) !== -1 ? 'paid' : (s.overdue && i[4] === 'open' ? 'overdue' : i[4]);
      var tn = { open: ['Open', 'warn'], paid: ['Paid', 'good'], overdue: ['Overdue', 'bad'] }[status];
      return { number: i[0], period: i[1], amount: money(i[2]), due: longDate(i[3]), chip: { label: tn[0], bg: TONE[tn[1]][0], fg: TONE[tn[1]][1], edge: 'transparent' }, view: function () { up({ inv: i[0] }); }, aria: 'View invoice ' + i[0] };
    });
    var iv = INV.filter(function (i) { return i[0] === s.inv; })[0];
    vals.iv = { open: Boolean(iv), title: iv ? 'Invoice ' + iv[0] : '', period: iv ? iv[1] : '', amount: iv ? money(iv[2]) : '', due: iv ? longDate(iv[3]) : '', isOpen: Boolean(iv && iv[4] === 'open' && paid.indexOf(iv[0]) === -1),
      payText: iv ? 'Pay ' + money(iv[2]) + ' online' : '', pay: function () { up({ inv: null, paid: paid.concat([iv[0]]), toast: toast('Paid. It can take a minute to show here.') }); }, print: function () { up({ toast: toast('Invoice is ready to print.') }); } };
    vals.closeInv = function () { up({ inv: null }); };
    return vals;
  }
}
