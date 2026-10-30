var START = {
  Requested: { rid: 'r14' }, Approved: { rid: 'r09' }, 'On its way back': { rid: 'r13' }, Inspected: { rid: 'r12' }, Resolved: { rid: 'r11' }, Rejected: { rid: 'r10' },
  Inspect: { rid: 'r13', patch: { status: 'received' }, insp: true }, Refund: { rid: 'r12', refund: true }, Reject: { rid: 'r14', reject: true }
};
var FLOW = [['requested', 'Requested'], ['approved', 'Approved'], ['in_transit', 'On its way back'], ['received', 'Received'], ['inspected', 'Inspected'], ['resolved', 'Resolved']];
var REFUND_METHODS = ['bkash', 'nagad', 'bank', 'cash', 'other'];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Requested');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var r = s.ret || Object.assign({}, RETURNS.filter(function (x) { return x.id === (s.rid || 'r14'); })[0], s.patch || {});
    var hist = function (text) { return r.history.concat([[text, TODAY + ' 12:00']]); };
    var save = function (patch, extra) { up(Object.assign({ ret: Object.assign({}, r, patch) }, extra || {})); };
    var st = r.status;
    var value = retValue(r);
    var good = r.lines.reduce(function (a, l) { return a + l[1] - (l[3] || 0); }, 0), damaged = r.lines.reduce(function (a, l) { return a + (l[3] || 0); }, 0);
    vals.rt = {
      title: 'Return ' + r.ref, chip: retChip(st), sub: 'Order #' + r.order + ' · ' + r.name + ' · asked ' + when(r.at),
      name: r.name, phone: fmtPhone(r.phone), tel: 'tel:' + r.phone, order: '#' + r.order, note: r.note, hasNote: Boolean(r.note),
      wants: r.wantsText, photos: r.photos ? plural(r.photos, 'photo', 'photos') : '', hasPhotos: r.photos > 0, photoList: Array.apply(null, Array(r.photos || 0)).map(function (_, i) { return { aria: 'Photo ' + (i + 1) }; }),
      value: money(value), outcome: r.outcome || '', hasOutcome: Boolean(r.outcome), rejected: st === 'rejected', resolved: st === 'resolved'
    };
    var at = FLOW.map(function (f) { return f[0]; }).indexOf(st);
    vals.showFlow = st !== 'rejected';
    vals.flow = FLOW.map(function (f, k) { return { label: f[1], s: k < at || st === 'resolved' ? 'done' : k === at ? 'now' : 'todo', mark: k < at || st === 'resolved' ? '✓' : String(k + 1) }; });
    vals.lines = r.lines.map(function (l) {
      var v = vById(l[0]), insp = l[3] !== null && l[3] !== undefined;
      return { title: v.t, opts: [v.o, v.sku].filter(Boolean).join(' · '), qty: l[1] + ' ×', reason: RET_REASONS[l[2]], value: money(l[1] * PRICE[l[0]]),
        insp: insp, inspText: insp ? (l[3] ? (l[1] - l[3] ? (l[1] - l[3]) + ' good · ' : '') + l[3] + ' damaged' : 'All good') : '', inspColor: insp && l[3] ? 'var(--warn)' : 'var(--success)' };
    });
    vals.history = r.history.slice().reverse().map(function (h) { return { text: h[0], when: when(h[1]) }; });

    // What can happen next.
    vals.isRequested = st === 'requested'; vals.isApproved = st === 'approved'; vals.canReceive = st === 'approved' || st === 'in_transit';
    vals.isReceived = st === 'received'; vals.isInspected = st === 'inspected';
    vals.approve = function () { save({ status: 'approved', history: hist('Approved by Rafiq Ahmed') }, { toast: toast(r.ref + ' is approved. Ask ' + r.name.split(' ')[0] + ' to send it back.') }); };
    vals.onTheWay = function () { save({ status: 'in_transit', history: hist('On its way back') }, { toast: toast('Marked on its way back.') }); };
    vals.receive = function () { save({ status: 'received', history: hist('Received in the shop') }, { toast: toast('Received. Inspect it next.') }); };
    vals.exchange = function () { save({ status: 'resolved', outcome: 'Exchanged: order #1059 sends the replacement.', history: hist('Exchange order #1059 created') }, { toast: toast('Exchange order #1059 created. It ships like any order.') }); };
    vals.closeNoRefund = function () { save({ status: 'resolved', outcome: 'Closed without a refund.', history: hist('Closed without a refund') }, { toast: toast(r.ref + ' is closed.') }); };

    // Inspect.
    var ins = s.ins || r.lines.map(function (l) { return l[3] || 0; });
    vals.ip = {
      open: Boolean(s.insp) && st === 'received',
      lines: r.lines.map(function (l, i) {
        var v = vById(l[0]), bad = ins[i];
        var setB = function (n) { up({ ins: ins.map(function (x, j) { return j === i ? n : x; }) }); };
        return { title: l[1] + ' × ' + v.t, opts: v.o || v.sku, bad: String(bad), aria: 'Damaged ' + label(v), dec: function () { if (bad > 0) setB(bad - 1); }, inc: function () { if (bad < l[1]) setB(bad + 1); }, decDis: bad <= 0, incDis: bad >= l[1],
          status: bad ? (l[1] - bad ? (l[1] - bad) + ' back in stock · ' : '') + bad + ' damaged' : 'All back in stock', statusColor: bad ? 'var(--warn)' : 'var(--success)' };
      }),
      save: function () {
        var bad = ins.reduce(function (a, x) { return a + x; }, 0), all = r.lines.reduce(function (a, l) { return a + l[1]; }, 0);
        save({ status: 'inspected', lines: r.lines.map(function (l, i) { return [l[0], l[1], l[2], ins[i]]; }), history: hist('Inspected: ' + (all - bad ? (all - bad) + ' good' : '') + (bad && all - bad ? ', ' : '') + (bad ? bad + ' damaged' : '')) }, { insp: false, ins: null, toast: toast(all - bad ? 'Inspected. ' + plural(all - bad, 'item is', 'items are') + ' back in stock.' : 'Inspected. Nothing goes back in stock.') });
      }
    };
    vals.openInspect = function () { up({ insp: true, ins: null }); };
    vals.closeInspect = function () { up({ insp: false, ins: null }); };

    // Refund.
    var rf = s.rf || { method: r.wantsText.indexOf('bank') !== -1 ? 'bank' : 'bkash', amount: String(value), reason: RET_REASONS[r.lines[0][2]], trx: '' };
    var setF = function (k, v) { var n = Object.assign({}, rf); n[k] = v; up({ rf: n }); };
    var amt = num(rf.amount), amtBad = Boolean(s.ftried) && !(amt > 0);
    vals.rf = {
      open: Boolean(s.refund) && st === 'inspected', sub: r.ref + ' · ' + r.name + ' asked: ' + r.wantsText.toLowerCase(),
      methods: REFUND_METHODS.map(function (m) { return { label: METHOD[m], on: rf.method === m ? 'true' : 'false', pick: function () { setF('method', m); } }; }),
      amount: rf.amount, onAmount: function (e) { setF('amount', e.target.value); }, amtBad: amtBad, amtAria: amtBad ? 'true' : 'false',
      hint: 'The items are worth ' + money(value) + '. Delivery isn’t refunded unless you add it.',
      reason: rf.reason, onReason: function (e) { setF('reason', e.target.value); }, trx: rf.trx, onTrx: function (e) { setF('trx', e.target.value); },
      save: function () {
        if (!(amt > 0)) { up({ ftried: true }); return; }
        var text = 'Refunded ' + money(amt) + ' by ' + METHOD[rf.method] + (rf.trx.trim() ? ' · ' + rf.trx.trim() : '');
        save({ status: 'resolved', outcome: text, history: hist(text) }, { refund: false, rf: null, ftried: false, toast: toast(money(amt) + ' refunded. Order #' + r.order + ' is partly refunded.') });
      }
    };
    vals.openRefund = function () { up({ refund: true, rf: null, ftried: false }); };
    vals.closeRefund = function () { up({ refund: false, rf: null, ftried: false }); };

    // Reject.
    var rj = s.rj === undefined ? '' : s.rj, rjBad = Boolean(s.jtried) && !rj.trim();
    vals.rj = { open: Boolean(s.reject) && st === 'requested', text: rj, onText: function (e) { up({ rj: e.target.value }); }, bad: rjBad, aria: rjBad ? 'true' : 'false',
      save: function () { if (!rj.trim()) { up({ jtried: true }); return; } save({ status: 'rejected', outcome: 'Rejected: ' + rj.trim(), history: hist('Rejected by Rafiq Ahmed') }, { reject: false, rj: undefined, jtried: false, toast: toast(r.ref + ' is rejected. ' + r.name.split(' ')[0] + ' gets an SMS with your reason.') }); } };
    vals.openReject = function () { up({ reject: true, rj: undefined, jtried: false }); };
    vals.closeReject = function () { up({ reject: false, jtried: false }); };
    vals.stockNote = st === 'inspected' ? (good ? plural(good, 'item went', 'items went') + ' back in stock' : 'Nothing went back in stock') + (damaged ? (good ? ', ' : ': ') + plural(damaged, 'item was', 'items were') + ' written off as damaged.' : '.') : '';
    vals.hasStockNote = Boolean(vals.stockNote);
    var reset = { insp: false, refund: false, reject: false };
    vals.closeAll = function () { up(reset); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    return vals;
  }
}
