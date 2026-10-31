var START = {
  'Confirmed, part paid': { oid: 'o53' }, Pending: { oid: 'o58' }, Risky: { oid: 'o57' }, 'Possible duplicate': { oid: 'o56' }, Shipped: { oid: 'o51' },
  'Delivery failed': { oid: 'o47' }, 'Delivered, return asked': { oid: 'o49' }, Cancelled: { oid: 'o45' }, 'Edit order': { oid: 'o53', edit: true },
  'Cancel order': { oid: 'o58', cancel: true }, 'Record a payment': { oid: 'o53', pay: true }, 'Book with a courier': { oid: 'o48', book: true },
  'Mark delivered': { oid: 'o51', dlg: 'delivered' }, "Couldn't deliver": { oid: 'o51', dlg: 'failed' }, 'More menu': { oid: 'o53', more: true }
};
var PAY_METHODS = ['bkash', 'nagad', 'rocket', 'bank', 'cash', 'other'];
var FAIL_REASONS = ['Customer refused at the door', 'Couldn’t reach the customer', 'Wrong address', 'Other'];
var CONF_VIA = { call: 'Confirmed on a call', staff: 'Confirmed by staff', link: 'The shopper confirmed by the SMS link' };
function payStatus(total, paid) { return paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partially_paid'; }
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Confirmed, part paid');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var o = s.ord || oById(s.oid || 'o53');
    var save = function (patch, extra) { up(Object.assign({ ord: Object.assign({}, o, patch) }, extra || {})); };
    var t = totalsOf(o);
    var cancelled = o.status === 'cancelled', walkIn = o.source === 'walk_in';
    var shipped = o.shipments.length > 0;
    var canShip = (o.status === 'confirmed' || o.status === 'processing') && !shipped && !walkIn;
    var canEdit = !cancelled && o.status !== 'completed' && !shipped;
    var canCancel = !cancelled && o.status !== 'completed' && o.del !== 'shipped' && o.del !== 'delivered';
    var canPay = !cancelled && t.due > 0;
    var courier = s.courier || 'steadfast';
    var cname = COURIERS.filter(function (c) { return c[0] === courier; })[0][1];
    var log = s.log || [];
    var addLog = function (text) { return log.concat([[text, TODAY + ' 12:00']]); };

    vals.od = {
      n: '#' + o.n, title: 'Order #' + o.n, placed: 'Placed ' + when(o.placed) + ' · ' + SOURCE[o.source],
      status: chip('order', o.status), pay: chip('pay', o.pay), del: delChip(o), total: money(t.total),
      due: cancelled ? 'Cancelled' : t.cod > 0 ? (walkIn ? money(t.cod) + ' still to pay' : money(t.cod) + ' to collect on delivery') : o.paid > t.total ? money(o.paid - t.total) + ' due back' : 'Paid in full'
    };
    vals.canConfirm = o.status === 'pending';
    vals.canBook = canShip; vals.bookText = 'Book with ' + cname;
    vals.canEdit = canEdit; vals.canCancel = canCancel; vals.canPay = canPay;
    vals.canProcess = o.status === 'confirmed';
    vals.confirm = function () { save({ status: 'confirmed', conf: { via: 'staff' }, flags: o.flags.filter(function (f) { return f !== 'unreachable'; }) }, { log: addLog('Confirmed by Rafiq Ahmed'), toast: toast('Order #' + o.n + ' is confirmed.') }); };
    vals.process = function () { save({ status: 'processing' }, { more: false, log: addLog('Processing started'), toast: toast('Processing started. Pack it when you’re ready.') }); };
    vals.printInvoice = function () { up({ more: false, toast: toast('Invoice is ready to print.') }); };
    vals.printSlip = function () { up({ more: false, toast: toast('Packing slip is ready to print.') }); };

    // Banners.
    vals.isDup = Boolean(o.dupOf) && o.flags.indexOf('possible_duplicate') !== -1 && !cancelled;
    var twin = o.dupOf ? oById(o.dupOf) : null;
    vals.dupText = twin ? 'This looks like a repeat of #' + twin.n + ': same phone, same items, placed 3 minutes apart.' : '';
    vals.dupMerge = twin ? 'Merge into #' + twin.n : '';
    vals.merge = function () { save({ status: 'cancelled', cancel: ['duplicate', 'Merged into #' + twin.n], flags: [], conf: null }, { log: addLog('Merged into #' + twin.n), toast: toast('Merged into #' + twin.n + '. This order is cancelled.') }); };
    vals.cancelDup = function () { save({ status: 'cancelled', cancel: ['duplicate', 'Duplicate of #' + twin.n], flags: [], conf: null }, { log: addLog('Cancelled as a duplicate'), toast: toast('Cancelled as a duplicate.') }); };
    vals.notDup = function () { save({ flags: o.flags.filter(function (f) { return f !== 'possible_duplicate'; }) }, { toast: toast('Marked as not a duplicate.') }); };
    var rec = RECORD[o.phone];
    vals.isRisky = o.risky && !cancelled;
    vals.riskText = rec ? 'Risky phone: of ' + plural(rec[0], 'parcel', 'parcels') + ' sent to this number, ' + rec[1] + ' was delivered. Ask for the delivery fee in advance.' : '';
    vals.isCancelled = cancelled;
    var code = o.cancel ? (CANCEL_CODES.filter(function (c) { return c[0] === o.cancel[0]; })[0] || [o.cancel[0], o.cancel[0] === 'shopper' ? 'The shopper cancelled' : 'A duplicate']) : null;
    vals.cancelText = code ? code[1] + (o.cancel[1] ? ': ' + o.cancel[1] : '') + '.' : '';

    // Items and totals.
    vals.lines = o.lines.map(function (l) { var v = vById(l[0]); return { title: v.t, opts: [v.o, v.sku].filter(Boolean).join(' · '), qty: l[1] + ' × ' + money(l[2]), total: money(l[1] * l[2]), count: String(l[1]) }; });
    var totals = [{ label: 'Subtotal', value: money(t.sub) }];
    o.adj.forEach(function (a) { totals.push({ label: a[0], value: '−' + money(a[1]) }); });
    if (!walkIn) totals.push({ label: 'Delivery (' + zoneName(o.zone) + ')', value: money(o.fee) });
    totals = totals.map(function (x) { return Object.assign({ weight: '400', color: 'var(--foreground)' }, x); });
    totals.push({ label: 'Total', value: money(t.total), weight: '600', color: 'var(--foreground)', rule: true });
    if (o.paid > 0) totals.push({ label: 'Paid', value: '−' + money(o.paid), weight: '400', color: 'var(--success)' });
    if (!cancelled && t.cod > 0 && (o.paid > 0 || !walkIn)) totals.push({ label: walkIn ? 'Still to pay' : 'To collect on delivery', value: money(t.cod), weight: '600', color: 'var(--foreground)' });
    if (o.paid > t.total) totals.push({ label: 'Due back', value: money(o.paid - t.total), weight: '600', color: 'var(--destructive)' });
    vals.totals = totals.map(function (x) { return Object.assign({}, x, { bt: x.rule ? '1px solid var(--border)' : '0', pt: x.rule ? '10px' : '0', mt: x.rule ? '4px' : '0' }); });
    vals.itemCount = plural(o.lines.reduce(function (a, l) { return a + l[1]; }, 0), 'item', 'items');

    // Payments.
    vals.payments = o.payments.map(function (p) { return { method: METHOD[p[0]], amount: money(p[1]), ref: p[2] || '—', hasRef: Boolean(p[2]), when: when(p[3]), chip: chip('pay', 'paid') }; });
    vals.hasPayments = o.payments.length > 0; vals.noPayments = o.payments.length === 0;
    vals.noPayText = cancelled ? 'No payments.' : walkIn ? 'No payments yet.' : 'No payments yet. ' + money(t.cod) + ' is collected on delivery.';
    vals.copyLink = function () { up({ more: false, toast: toast('Payment link copied. It asks for ' + money(t.due) + '.') }); };

    // Shipments.
    vals.showShip = !walkIn && !cancelled || shipped;
    vals.shipments = o.shipments.map(function (sh, i) {
      var setSh = function (patch, extra) { save({ shipments: o.shipments.map(function (x, j) { return j === i ? Object.assign({}, x, patch) : x; }) }, extra || {}); };
      var st = sh.status, back = st === 'failed' && sh.returnedByCourier && !sh.back;
      return {
        courier: sh.courier, cons: sh.cons || 'Waiting for a number', chip: chip('ship', sh.back ? 'returned' : st), items: itemsText(sh.lines),
        updates: sh.updates.slice().reverse().map(function (u) { return { text: u[0], when: when(u[1]) }; }),
        failed: sh.failed || '', hasFailed: Boolean(sh.failed),
        canDeliver: st === 'shipped' || st === 'in_transit', canShip: st === 'booked', canBack: back, isBack: Boolean(sh.back),
        backText: back ? 'The courier returned it on ' + short(sh.returnedByCourier.slice(0, 10)) + '. Check it and put it back on the shelf.' : sh.back ? 'Back in the shop. Return cost ' + money(sh.back) + '.' : '',
        markShipped: function () { setSh({ status: 'shipped', updates: sh.updates.concat([['Picked up', TODAY + ' 12:00']]) }, { toast: toast('Marked shipped.') }); },
        delivered: function () { up({ dlg: 'delivered', si: i }); }, failedAsk: function () { up({ dlg: 'failed', si: i }); }, backAsk: function () { up({ dlg: 'back', si: i }); }
      };
    });
    vals.hasShipments = shipped; vals.noShipments = !shipped;
    vals.noShipText = cancelled ? 'Nothing was shipped.' : canShip ? 'Not shipped yet.' : 'Confirm the order to ship it.';
    vals.createShipment = function () { save({ status: 'processing', shipments: [{ courier: 'Own delivery', cons: '', status: 'booked', lines: o.lines.map(function (l) { return [l[0], l[1]]; }), updates: [['Packed', TODAY + ' 12:00']] }] }, { more: false, toast: toast('Shipment created. Mark it shipped when it leaves.') }); };

    // Returns.
    vals.returns = o.returns.map(function (r) { return { ref: r[0], chip: chip('ret', r[1]) }; });
    vals.hasReturns = o.returns.length > 0;
    vals.canReturn = o.del === 'delivered';
    vals.showReturns = vals.hasReturns || vals.canReturn;
    vals.noReturnsYet = !vals.hasReturns;
    vals.startReturn = function () { save({ returns: o.returns.concat([['R-0015', 'requested']]) }, { log: addLog('Return R-0015 started'), toast: toast('Return R-0015 started.') }); };

    // Customer and the record.
    var mine = ORDERS.filter(function (x) { return x.phone === o.phone; });
    vals.cust = {
      name: o.name, phone: fmtPhone(o.phone), tel: 'tel:' + o.phone, wa: 'https://wa.me/88' + o.phone,
      orders: mine.length > 1 ? plural(mine.length, 'order', 'orders') + ' · ' + money(mine.reduce(function (a, x) { return a + totalsOf(x).total; }, 0)) + ' in all' : 'First order',
      address: walkIn ? 'Collected in the shop' : [o.line, o.area, o.district].filter(Boolean).join(', '), zone: walkIn ? '' : zoneName(o.zone) + ' · ' + money(o.fee) + ' delivery', hasZone: !walkIn,
      note: o.note, hasNote: Boolean(o.note)
    };
    vals.risk = riskChip(o.score, o.risky);
    vals.recordText = rec ? plural(rec[0], 'parcel', 'parcels') + ' with all couriers · ' + rec[1] + ' delivered' : 'No delivery record for this phone yet.';
    var c = o.conf || {};
    vals.confText = o.status === 'pending' ? (c.attempts ? 'Called ' + plural(c.attempts, 'time', 'times') + (c.dueAt ? '. Call back at ' + clock(c.dueAt.slice(11, 16)) : '') : 'Not called yet') : cancelled ? 'Cancelled before it was confirmed' : CONF_VIA[c.via] || 'Confirmed';
    vals.confLink = c.linkSent ? 'Confirmation SMS sent ' + when(c.linkSent) : '';
    vals.hasConfLink = Boolean(c.linkSent);
    vals.showConf = !walkIn;

    // Tags.
    var tags = s.tags || o.tags;
    vals.tags = tags.map(function (g) { return { label: g, aria: 'Remove tag ' + g, remove: function () { up({ tags: tags.filter(function (x) { return x !== g; }) }); } }; });
    vals.hasTags = tags.length > 0;
    vals.tagQ = s.tagQ || '';
    vals.onTag = function (e) { up({ tagQ: e.target.value }); };
    vals.tagKey = function (e) { if (e.key === 'Enter' && (s.tagQ || '').trim()) { e.preventDefault(); up({ tags: tags.concat([(s.tagQ || '').trim().toLowerCase()]), tagQ: '' }); } };

    // Timeline: newest first.
    var ev = [['Placed on the ' + SOURCE[o.source].toLowerCase() + (o.source === 'website' ? '' : ' by Rafiq Ahmed'), o.placed]];
    if (c.linkSent) ev.push(['Confirmation SMS sent', c.linkSent]);
    if (c.attempts) ev.push(['Called ' + plural(c.attempts, 'time', 'times') + (c.lastNote ? ': “' + c.lastNote + '”' : ': no answer'), o.placed.slice(0, 11) + '13:30']);
    if (c.via) ev.push([CONF_VIA[c.via], o.placed.slice(0, 11) + String(Number(o.placed.slice(11, 13)) + 1).padStart(2, '0') + o.placed.slice(13)]);
    o.payments.forEach(function (p) { ev.push([money(p[1]) + ' paid by ' + METHOD[p[0]], p[3]]); });
    o.shipments.forEach(function (sh) { sh.updates.forEach(function (u) { ev.push([sh.courier + ': ' + u[0].toLowerCase(), u[1]]); }); });
    if (o.cancel) ev.push(['Cancelled', o.placed.slice(0, 11) + '15:00']);
    var notes = (s.notes || (o.id === 'o53' ? [['Wants it before Friday. Gift wrap the caps.', '2026-10-28 16:30']] : [])).map(function (n) { return { text: n[0], at: n[1], note: true }; });
    var all = ev.map(function (e) { return { text: e[0], at: e[1], note: false }; }).concat(notes, log.map(function (e) { return { text: e[0], at: e[1], note: false }; }));
    all.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
    vals.timeline = all.map(function (e) { return { text: e.text, when: when(e.at) + (e.note ? ' · Rafiq Ahmed' : ''), isNote: e.note, isEvent: !e.note }; });
    vals.noteDraft = s.nd || '';
    vals.onNote = function (e) { up({ nd: e.target.value }); };
    vals.noteEmpty = !(s.nd || '').trim();
    vals.addNote = function () { if (!(s.nd || '').trim()) return; up({ notes: (s.notes || notes.map(function (n) { return [n.text, n.at]; })).concat([[s.nd.trim(), TODAY + ' 12:05']]), nd: '' }); };

    // Edit the order.
    var ed = s.ed || { lines: o.lines.map(function (l) { return l.slice(); }), reason: '' };
    var setEd = function (patch) { up({ ed: Object.assign({}, ed, patch) }); };
    var newSub = ed.lines.reduce(function (a, l) { return a + l[1] * l[2]; }, 0);
    var changed = JSON.stringify(ed.lines) !== JSON.stringify(o.lines);
    var keepAdj = changed ? [] : o.adj;
    var newTotal = newSub - keepAdj.reduce(function (a, x) { return a + x[1]; }, 0) + o.fee;
    var apOpen = Boolean(s.ap), apq = (s.apq || '').trim().toLowerCase();
    var apItems = VARIANTS.filter(function (v) { return v.track && (!apq || label(v).toLowerCase().indexOf(apq) !== -1 || v.sku.toLowerCase().indexOf(apq) !== -1); }).map(function (v) {
      var inOrder = ed.lines.some(function (l) { return l[0] === v.id; });
      return { label: label(v), sub: money(PRICE[v.id]) + ' · ' + (available(v) > 0 ? available(v) + ' available' : 'Out of stock'), hasSub: true, check: inOrder ? '1' : '0', aria: inOrder ? 'true' : 'false',
        pick: function () { up({ ap: false, apq: '', ed: Object.assign({}, ed, { lines: inOrder ? ed.lines : ed.lines.concat([[v.id, 1, PRICE[v.id], 0]]) }) }); } };
    });
    vals.ap = { open: apOpen, title: 'Add a product', ph: 'Search products', query: s.apq || '', onQuery: function (e) { up({ apq: e.target.value }); }, items: apItems, none: apItems.length === 0 };
    vals.comboOpen = apOpen; vals.cbd = vals.ap;
    vals.closeCombo = function () { up({ ap: false, apq: '' }); };
    vals.comboEsc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); up({ ap: false, apq: '' }); } };
    var edBad = Boolean(s.etried) && changed && !ed.reason.trim();
    vals.ed = {
      open: Boolean(s.edit), sub: 'Order #' + o.n + ' · ' + o.name,
      lines: ed.lines.map(function (l, i) {
        var v = vById(l[0]);
        var setQ = function (q) { setEd({ lines: ed.lines.map(function (x, j) { return j === i ? [x[0], q, x[2], x[3]] : x; }) }); };
        return { title: v.t, opts: v.o || v.sku, price: money(l[2]) + ' each', total: money(l[1] * l[2]), qty: String(l[1]), qtyAria: 'Quantity of ' + label(v),
          dec: function () { if (l[1] > 1) setQ(l[1] - 1); }, inc: function () { setQ(l[1] + 1); }, decDis: l[1] <= 1,
          onQty: function (e) { var n = parseInt(e.target.value, 10); if (n > 0) setQ(n); }, removeAria: 'Remove ' + label(v), canRemove: ed.lines.length > 1,
          remove: function () { setEd({ lines: ed.lines.filter(function (x, j) { return j !== i; }) }); } };
      }),
      addProduct: function () { up({ ap: !apOpen, apq: '' }); }, apAria: apOpen ? 'true' : 'false',
      reason: ed.reason, onReason: function (e) { setEd({ reason: e.target.value }); }, reasonBad: edBad, reasonAria: edBad ? 'true' : 'false',
      totalText: 'New total ' + money(newTotal), wasText: changed ? '(was ' + money(t.total) + ')' : '', changed: changed,
      dropped: changed && o.adj.length > 0, droppedText: o.adj.length ? 'The items changed, so “' + o.adj[0][0] + '” comes off. Add a discount again if it still applies.' : '',
      refund: o.paid > newTotal, refundText: 'They paid ' + money(o.paid) + '. You owe them ' + money(o.paid - newTotal) + ' back: record it as a refund after.',
      save: function () {
        if (!changed) { up({ edit: false, ed: null }); return; }
        if (!ed.reason.trim()) { up({ etried: true }); return; }
        save({ lines: ed.lines, adj: keepAdj, pay: payStatus(newTotal, o.paid) }, { edit: false, ed: null, etried: false, log: addLog('Edited: ' + ed.reason.trim()), toast: toast('Order #' + o.n + ' is updated. New total ' + money(newTotal) + '.') });
      }
    };
    vals.openEdit = function () { up({ edit: true, ed: null, etried: false, more: false }); };
    vals.closeEdit = function () { up({ edit: false, ed: null, etried: false, ap: false }); };

    // Cancel.
    vals.cx = cancelForm(s, up, s.cancel && !cancelled ? o : null, function (cf) {
      save({ status: 'cancelled', cancel: [cf.code, cf.reason], conf: null }, { cancel: false, cf: null, ctried: false, log: addLog('Cancelled by Rafiq Ahmed'), toast: toast('Order #' + o.n + ' is cancelled.') });
    });
    vals.askCancel = function () { up({ cancel: true, more: false, cf: null, ctried: false }); };

    // Record a payment.
    var pd = s.pd || { amount: String(t.due), method: 'bkash', ref: '' };
    var setP = function (k, v) { var n = Object.assign({}, pd); n[k] = v; up({ pd: n }); };
    var amt = num(pd.amount), amtBad = Boolean(s.ptried) && !(amt > 0);
    vals.pf = {
      open: Boolean(s.pay), sub: 'Order #' + o.n + ' · ' + money(t.due) + ' due',
      amount: pd.amount, onAmount: function (e) { setP('amount', e.target.value); }, amtBad: amtBad, amtAria: amtBad ? 'true' : 'false',
      over: amt > t.due, overText: 'That’s ' + money(amt - t.due) + ' more than the order needs.',
      methods: PAY_METHODS.map(function (m) { return { label: METHOD[m], on: pd.method === m ? 'true' : 'false', pick: function () { setP('method', m); } }; }),
      ref: pd.ref, onRef: function (e) { setP('ref', e.target.value); },
      save: function () {
        if (!(amt > 0)) { up({ ptried: true }); return; }
        var paid = o.paid + amt;
        save({ paid: paid, pay: payStatus(t.total, paid), payments: o.payments.concat([[pd.method, amt, pd.ref.trim(), TODAY + ' 12:00', 'paid']]) }, { pay: false, pd: null, ptried: false, toast: toast(money(amt) + ' recorded.') });
      }
    };
    vals.openPay = function () { up({ pay: true, pd: null, ptried: false, more: false }); };
    vals.closePay = function () { up({ pay: false, pd: null, ptried: false }); };

    // Book with a courier.
    var bk = s.bk || { cod: String(t.cod), weight: '500', note: o.note || '' };
    var setB = function (k, v) { var n = Object.assign({}, bk); n[k] = v; up({ bk: n }); };
    vals.bk = {
      open: Boolean(s.book) && canShip, sub: 'Order #' + o.n + ' · ' + o.name,
      couriers: COURIERS.map(function (x) { var on = x[0] === courier; return { label: x[1], hasSub: true, sub: x[0] === 'redx' ? 'Not connected: books by hand' : 'Connected', on: on, aria: on ? 'true' : 'false', pick: function () { up({ courier: x[0] }); } }; }),
      address: [o.name, fmtPhone(o.phone), [o.line, o.area, o.district].filter(Boolean).join(', ')].join('\n'), items: o.lines.map(function (l) { return l[1] + ' × ' + lineLabel(l[0]); }).join('\n'),
      area: o.area + ', ' + o.district, cod: bk.cod, onCod: function (e) { setB('cod', e.target.value); }, codHint: o.paid > 0 ? money(o.paid) + ' is paid already.' : 'The whole total: nothing is paid yet.',
      weight: bk.weight, onWeight: function (e) { setB('weight', e.target.value); }, note: bk.note, onNote: function (e) { setB('note', e.target.value); },
      saveText: 'Book with ' + cname,
      save: function () {
        save({ status: 'processing', shipments: [{ courier: cname, cons: courier === 'pathao' ? 'PT-27C1MX' : 'SF-88231190', status: 'booked', lines: o.lines.map(function (l) { return [l[0], l[1]]; }), updates: [['Booked', TODAY + ' 12:00']] }] }, { book: false, bk: null, toast: toast('Booked with ' + cname + '. Print the label from the shipment.') });
      }
    };
    vals.openBook = function () { up({ book: true, bk: null, more: false }); };
    vals.closeBook = function () { up({ book: false, bk: null }); };

    // Shipment dialogs.
    var si = s.si || 0, sh = o.shipments[si];
    var setShip = function (patch) { return o.shipments.map(function (x, j) { return j === si ? Object.assign({}, x, patch) : x; }); };
    var collected = s.collected === undefined ? true : s.collected;
    vals.dv = {
      open: s.dlg === 'delivered' && Boolean(sh), hasCod: t.cod > 0, check: checkOf(collected, function () { up({ collected: !collected }); }),
      codText: 'The courier collected ' + money(t.cod) + ' in cash',
      save: function () {
        var paid = collected ? o.paid + t.cod : o.paid;
        save({ status: 'completed', del: 'delivered', paid: paid, pay: payStatus(t.total, paid), shipments: setShip({ status: 'delivered', updates: sh.updates.concat([['Delivered', TODAY + ' 12:00']]) }), payments: collected && t.cod ? o.payments.concat([['cod', t.cod, sh.courier, TODAY + ' 12:00', 'paid']]) : o.payments }, { dlg: null, collected: undefined, toast: toast('Delivered. Order #' + o.n + ' is complete.') });
      }
    };
    var fr = s.fr === undefined ? 0 : s.fr;
    vals.fl = {
      open: s.dlg === 'failed' && Boolean(sh),
      reasons: FAIL_REASONS.map(function (r, i) { return { label: r, hasSub: false, sub: '', on: fr === i, aria: fr === i ? 'true' : 'false', pick: function () { up({ fr: i }); } }; }),
      save: function () { save({ del: 'failed', shipments: setShip({ status: 'failed', failed: FAIL_REASONS[fr], updates: sh.updates.concat([['Not delivered: ' + FAIL_REASONS[fr].toLowerCase(), TODAY + ' 12:00']]) }) }, { dlg: null, fr: undefined, toast: toast('Marked not delivered. Mark it back in the shop when it arrives.') }); }
    };
    var rc = s.rc === undefined ? '60' : s.rc;
    vals.bs = {
      open: s.dlg === 'back' && Boolean(sh), cost: rc, onCost: function (e) { up({ rc: e.target.value }); },
      stockText: sh ? 'The ' + itemsText(sh.lines) + ' goes back in stock.' : '',
      save: function () { save({ shipments: setShip({ back: num(rc) || 0, updates: sh.updates.concat([['Back in the shop · return cost ' + money(num(rc) || 0), TODAY + ' 12:00']]) }) }, { dlg: null, rc: undefined, toast: toast('Back in stock. Return cost recorded as an expense.') }); }
    };
    vals.closeDlg = function () { up({ dlg: null }); };

    vals.moreOpen = Boolean(s.more); vals.moreAria = s.more ? 'true' : 'false';
    vals.toggleMore = function () { up({ more: !s.more }); };
    var reset = { more: false, edit: false, ap: false, cancel: false, pay: false, book: false, dlg: null };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ more: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    return vals;
  }
}
