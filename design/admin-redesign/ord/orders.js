var START = {
  Orders: {}, 'To confirm': { tab: 'confirm' }, 'To ship': { tab: 'ship' }, Selected: { tab: 'ship', sel: ['o53', 'o52', 'o48'] },
  'Payment filter': { pf: ['unpaid', 'partially_paid'], fopen: 'pf' }, 'Row menu': { menu: 'o58' }, 'Cancel order': { cancel: 'o58' },
  'Book with a courier': { tab: 'ship', sel: ['o53', 'o48'], book: true }, 'Nothing found': { q: '01999' }, Filters: { filters: true, pf: ['unpaid'] }
};
var TABS = [['all', 'All'], ['confirm', 'To confirm'], ['ship', 'To ship'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
function canShip(o) { return (o.status === 'confirmed' || o.status === 'processing') && o.del === 'not_shipped' && o.source !== 'walk_in' && !o.shipments.length; }
function inTab(o, t) {
  if (t === 'confirm') return o.status === 'pending';
  if (t === 'ship') return canShip(o);
  if (t === 'shipped') return o.del === 'shipped' || o.del === 'partially_shipped' || o.del === 'failed' || (o.shipments.length > 0 && o.del === 'not_shipped');
  if (t === 'delivered') return o.del === 'delivered';
  if (t === 'cancelled') return o.status === 'cancelled';
  return true;
}
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Orders');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var orders = s.orders || ORDERS;
    var tab = s.tab || 'all';
    var q = (s.q || '').trim().toLowerCase().replace(/^#/, ''), qd = q.replace(/[-\s]/g, '');
    var pf = s.pf || [], sf = s.sf || [], ff = s.ff || [], zf = s.zf || [];
    var matches = function (o) {
      if (q && String(o.n).indexOf(q) === -1 && !(qd && /^\d+$/.test(qd) && o.phone.indexOf(qd) !== -1) && o.name.toLowerCase().indexOf(q) === -1) return false;
      if (pf.length && pf.indexOf(o.pay) === -1) return false;
      if (sf.length && sf.indexOf(o.source) === -1) return false;
      if (zf.length && zf.indexOf(o.zone || 'none') === -1) return false;
      if (ff.length && !ff.some(function (f) { return o.flags.indexOf(f) !== -1; })) return false;
      return true;
    };
    var base = orders.filter(matches);
    vals.tabs = TABS.map(function (t) {
      var n = base.filter(function (o) { return inTab(o, t[0]); }).length;
      return { label: t[1], count: t[0] === 'all' ? String(n) : n ? String(n) : '', on: tab === t[0] ? 'true' : 'false', pick: function () { up({ tab: t[0], menu: null, sel: [] }); } };
    });
    var list = base.filter(function (o) { return inTab(o, tab); });
    var countIn = function (field) { return function (k) { return orders.filter(function (o) { return inTab(o, tab) && (field === 'flags' ? o.flags.indexOf(k) !== -1 : (o[field] || 'none') === k); }).length; }; };
    vals.pf = listFilter(s, up, 'pf', Object.keys(ST.pay).map(function (k) { return [k, ST.pay[k][0]]; }), countIn('pay'));
    vals.sf = listFilter(s, up, 'sf', ['website', 'facebook', 'phone', 'walk_in'].map(function (k) { return [k, SOURCE[k]]; }), countIn('source'));
    vals.zf = listFilter(s, up, 'zf', ZONES.map(function (z) { return [z[0], z[1]]; }).concat([['none', 'No delivery']]), countIn('zone'));
    vals.ff = listFilter(s, up, 'ff', Object.keys(FLAGS).map(function (k) { return [k, FLAGS[k]]; }), countIn('flags'));
    var sel = (s.sel || []).filter(function (id) { return list.some(function (o) { return o.id === id; }); });
    var toggleSel = function (id) { up({ sel: sel.indexOf(id) !== -1 ? sel.filter(function (x) { return x !== id; }) : sel.concat([id]) }); };
    var allOn = list.length > 0 && sel.length === list.length;
    vals.all = checkOf(allOn, function () { up({ sel: allOn ? [] : list.map(function (o) { return o.id; }) }); }, sel.length > 0 && !allOn);

    var cancelOrder = function (o, cf) {
      return orders.map(function (x) { return x.id === o.id ? Object.assign({}, x, { status: 'cancelled', cancel: [cf.code, cf.reason], conf: null }) : x; });
    };
    var rowOf = function (o) {
      var t = totalsOf(o), menuOpen = s.menu === o.id, on = sel.indexOf(o.id) !== -1;
      var flags = o.flags.map(function (f) { return { label: FLAGS[f], warn: f !== 'flagged_phone' }; });
      return {
        id: o.id, n: '#' + o.n, aria: 'Open order #' + o.n, name: o.name, sub: fmtPhone(o.phone) + (o.area ? ' · ' + o.area : ''),
        risky: o.risky, risk: riskChip(o.score, o.risky), flags: flags.filter(function (f) { return f.label !== 'Risky phone'; }), hasFlags: o.flags.filter(function (f) { return f !== 'flagged_phone'; }).length > 0,
        date: short(o.placed.slice(0, 10)), time: clock(o.placed.slice(11, 16)), placed: when(o.placed),
        status: chip('order', o.status), pay: chip('pay', o.pay), del: delChip(o), total: money(t.total),
        meta: o.name + ' · ' + (o.area || SOURCE[o.source]), sel: checkOf(on, function () { toggleSel(o.id); }), selAria: 'Select order #' + o.n,
        menuOpen: menuOpen, menuAria: 'Actions for order #' + o.n, toggleMenu: function () { up({ menu: menuOpen ? null : o.id }); },
        canConfirm: o.status === 'pending', canShip: canShip(o), canCancel: o.status !== 'cancelled' && o.status !== 'completed' && o.del !== 'shipped' && o.del !== 'delivered',
        confirm: function () { up({ menu: null, orders: orders.map(function (x) { return x.id === o.id ? Object.assign({}, x, { status: 'confirmed', conf: { via: 'staff' } }) : x; }), toast: toast('Order #' + o.n + ' is confirmed.') }); },
        book: function () { up({ menu: null, sel: [o.id], book: true, courier: null }); },
        invoice: function () { up({ menu: null, toast: toast('Invoice for #' + o.n + ' is ready to print.') }); },
        ask: function () { up({ menu: null, cancel: o.id, cf: null, ctried: false }); }
      };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    var filtered = Boolean(q || pf.length || sf.length || ff.length || zf.length);
    vals.emptyText = filtered ? 'No orders match.' : tab === 'confirm' ? 'Nothing to confirm. New orders show up here.' : tab === 'ship' ? 'Nothing waiting to ship.' : 'No orders here yet.';
    vals.hasFilters = filtered;
    vals.clearAll = function () { up({ q: '', pf: [], sf: [], ff: [], zf: [], fopen: null }); };
    vals.q = s.q || '';
    vals.onQ = function (e) { up({ q: e.target.value, sel: [] }); };
    vals.totalText = plural(list.length, 'order', 'orders') + ' · ' + money(list.reduce(function (a, o) { return a + totalsOf(o).total; }, 0));
    vals.exportOrders = function () { up({ toast: toast('Exported ' + plural(list.length, 'order', 'orders') + ' to Excel.') }); };

    // The selection bar.
    var picked = list.filter(function (o) { return sel.indexOf(o.id) !== -1; });
    var pend = picked.filter(function (o) { return o.status === 'pending'; });
    var ship = picked.filter(canShip);
    vals.bar = {
      show: picked.length > 0, label: plural(picked.length, 'order', 'orders') + ' selected',
      canConfirm: pend.length > 0, confirmText: 'Confirm ' + pend.length + ' pending', canShip: ship.length > 0,
      confirm: function () { up({ sel: [], orders: orders.map(function (x) { return pend.indexOf(x) !== -1 ? Object.assign({}, x, { status: 'confirmed', conf: { via: 'staff' } }) : x; }), toast: toast(plural(pend.length, 'order is', 'orders are') + ' confirmed.') }); },
      book: function () { up({ book: true, courier: null }); },
      invoices: function () { up({ toast: toast(plural(picked.length, 'invoice is', 'invoices are') + ' ready to print.') }); },
      slips: function () { up({ toast: toast(plural(picked.length, 'packing slip is', 'packing slips are') + ' ready to print.') }); },
      clear: function () { up({ sel: [] }); }
    };

    // Book with a courier.
    var courier = s.courier || 'steadfast';
    var cname = COURIERS.filter(function (c) { return c[0] === courier; })[0][1];
    var toBook = (s.book ? orders.filter(function (o) { return (s.sel || []).indexOf(o.id) !== -1 && canShip(o); }) : []);
    vals.bk = {
      open: Boolean(s.book) && toBook.length > 0, sub: plural(toBook.length, 'order', 'orders') + ' · ' + money(toBook.reduce(function (a, o) { return a + totalsOf(o).cod; }, 0)) + ' to collect',
      couriers: COURIERS.map(function (c) { var on = c[0] === courier; return { label: c[1], hasSub: true, sub: c[0] === 'steadfast' ? 'Connected · picks up by 5 PM' : c[0] === 'pathao' ? 'Connected · picks up tomorrow' : 'Not connected: books by hand', on: on, aria: on ? 'true' : 'false', pick: function () { up({ courier: c[0] }); } }; }),
      lines: toBook.map(function (o) { var t = totalsOf(o); return { n: '#' + o.n, name: o.name, area: [o.area, o.district].filter(Boolean).join(', '), cod: t.cod ? money(t.cod) + ' to collect' : 'Paid' }; }),
      saveText: 'Book ' + plural(toBook.length, 'order', 'orders') + ' with ' + cname,
      save: function () {
        var ids = toBook.map(function (o) { return o.id; });
        up({ book: false, sel: [], orders: orders.map(function (x) { return ids.indexOf(x.id) !== -1 ? Object.assign({}, x, { status: 'processing', shipments: [{ courier: cname, cons: '', status: 'booked', lines: x.lines.map(function (l) { return [l[0], l[1]]; }), updates: [['Booked', TODAY + ' 12:00']] }] }) : x; }), toast: toast('Booked ' + plural(ids.length, 'order', 'orders') + ' with ' + cname + '.') });
      }
    };
    vals.closeBook = function () { up({ book: false }); };

    var cOrder = s.cancel ? orders.filter(function (o) { return o.id === s.cancel; })[0] : null;
    vals.cx = cancelForm(s, up, cOrder, function (cf) { up({ cancel: null, cf: null, ctried: false, orders: cancelOrder(cOrder, cf), toast: toast('Order #' + cOrder.n + ' is cancelled.') }); });

    var mOpen = s.menu ? orders.filter(function (o) { return o.id === s.menu; })[0] : null;
    vals.menuOpen = Boolean(mOpen);
    vals.mx = rowOf(mOpen || orders[0]);
    // Phone filters
    var nf = [pf, sf, ff, zf].filter(function (x) { return x.length; }).length;
    vals.filtersOpen = Boolean(s.filters);
    vals.openFilters = function () { up({ filters: true }); };
    vals.hasCount = nf > 0; vals.filterCount = String(nf); vals.noFilters = nf === 0;
    vals.showText = 'Show ' + plural(list.length, 'order', 'orders');
    var reset = { menu: null, fopen: null, cancel: null, book: false, filters: false };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ menu: null, fopen: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    return vals;
  }
}
