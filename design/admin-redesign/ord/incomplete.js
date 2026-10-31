var START = { 'Incomplete orders': {}, 'Made into orders': { tab: 'ordered' }, 'Row menu': { menu: 'i1' }, 'Nothing here': { tab: 'open', list: INCOMPLETE.filter(function (i) { return i.status !== 'open'; }) } };
var TABS = [['open', 'To call'], ['ordered', 'Made into orders'], ['finished', 'Finished by the shopper'], ['dismissed', 'Dismissed']];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Incomplete orders');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var all = s.list || INCOMPLETE;
    var tab = s.tab || 'open';
    var q = (s.q || '').trim().toLowerCase(), qd = q.replace(/\D/g, '');
    var base = all.filter(function (i) { return !q || i.name.toLowerCase().indexOf(q) !== -1 || (qd && i.phone.indexOf(qd) !== -1); });
    vals.tabs = TABS.map(function (t) { var n = base.filter(function (i) { return i.status === t[0]; }).length; return { label: t[1], count: n ? String(n) : '', on: tab === t[0] ? 'true' : 'false', pick: function () { up({ tab: t[0], menu: null }); } }; });
    var list = base.filter(function (i) { return i.status === tab; });
    var setI = function (i, patch, msg) { up({ list: all.map(function (x) { return x.id === i.id ? Object.assign({}, x, patch) : x; }), menu: null, toast: toast(msg) }); };
    var rowOf = function (i) {
      var menuOpen = s.menu === i.id, v = incValue(i);
      return {
        name: i.name || 'No name given', nameColor: i.name ? 'var(--foreground)' : 'var(--muted-foreground)', phone: fmtPhone(i.phone), area: i.area || '—',
        items: itemsText(i.lines), value: money(v), step: stepLabel(i.step), when: when(i.at), chip: incChip(i.status),
        contacted: i.contacted && i.status === 'open', aria: 'Open the checkout from ' + (i.name || fmtPhone(i.phone)), tel: 'tel:' + i.phone,
        meta: fmtPhone(i.phone) + ' · left at ' + stepLabel(i.step).toLowerCase(), made: i.madeInto ? '#' + i.madeInto : '', hasMade: Boolean(i.madeInto),
        isOpen: i.status === 'open', notContacted: i.status === 'open' && !i.contacted,
        menuOpen: menuOpen, menuAria: 'Actions for the checkout from ' + (i.name || fmtPhone(i.phone)), toggleMenu: function () { up({ menu: menuOpen ? null : i.id }); },
        contact: function () { setI(i, { contacted: true }, 'Marked as contacted.'); },
        create: function () { setI(i, { status: 'ordered', madeInto: 1059 }, 'Order #1059 created from the checkout. It’s waiting to be confirmed.'); },
        dismiss: function () { setI(i, { status: 'dismissed' }, 'Dismissed.'); }
      };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyText = q ? 'No checkouts match.' : tab === 'open' ? 'No unfinished checkouts to call.' : 'Nothing here yet.';
    vals.emptyCanReset = Boolean(q); vals.emptyReset = function () { up({ q: '' }); };
    vals.hasFilters = Boolean(q); vals.clearAll = function () { up({ q: '' }); };
    vals.q = s.q || ''; vals.onQ = function (e) { up({ q: e.target.value }); };
    var open = all.filter(function (i) { return i.status === 'open'; });
    vals.summary = plural(open.length, 'checkout', 'checkouts') + ' · ' + money(open.reduce(function (a, i) { return a + incValue(i); }, 0)) + ' left in carts';
    var mOpen = s.menu ? all.filter(function (i) { return i.id === s.menu; })[0] : null;
    vals.menuOpen = Boolean(mOpen);
    vals.mx = rowOf(mOpen || all[0] || INCOMPLETE[0]);
    vals.closeAll = function () { up({ menu: null }); };
    vals.closePop = function () { up({ menu: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ menu: null }); } };
    return vals;
  }
}
