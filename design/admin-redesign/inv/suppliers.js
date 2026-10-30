var START = {
  Suppliers: {}, Archived: { tab: 'archived' }, 'Row menu': { menu: 's1' }, 'New supplier': { form: 'new' }, 'Edit supplier': { form: 's2' },
  'Missing name': { form: 'new', tried: true }
};
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Suppliers');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var sups = s.sups || SUPPLIERS;
    var tab = s.tab || 'active';
    var q = (s.q || '').trim().toLowerCase();
    var base = sups.filter(function (x) { return !q || x.name.toLowerCase().indexOf(q) !== -1 || x.phones.join(' ').replace(/-/g, '').indexOf(q.replace(/-/g, '')) !== -1 || (x.contact || '').toLowerCase().indexOf(q) !== -1; });
    vals.tabs = [['active', 'Active'], ['archived', 'Archived']].map(function (t) {
      return { label: t[1], count: String(base.filter(function (x) { return t[0] === 'archived' ? x.archived : !x.archived; }).length), on: tab === t[0] ? 'true' : 'false', pick: function () { up({ tab: t[0], menu: null }); } };
    });
    var list = base.filter(function (x) { return tab === 'archived' ? x.archived : !x.archived; });
    var active = sups.filter(function (x) { return !x.archived; });
    var owed = active.reduce(function (a, x) { return a + (x.balance > 0 ? x.balance : 0); }, 0);
    var adv = active.reduce(function (a, x) { return a + (x.balance < 0 ? -x.balance : 0); }, 0);
    var openPo = POS.filter(function (p) { return p.status === 'ordered' || p.status === 'partially_received'; });
    vals.stats = [
      { label: 'You owe in all', value: money(owed) },
      { label: 'Advances paid', value: money(adv) },
      { label: 'Orders to receive', value: String(openPo.length) },
      { label: 'Active suppliers', value: String(active.length) }
    ];
    var rowOf = function (x) {
      var bal = balanceOf(x.balance), menuOpen = s.menu === x.id;
      var open = POS.filter(function (p) { return p.sup === x.id && (p.status === 'ordered' || p.status === 'partially_received' || p.status === 'draft'); }).length;
      return {
        name: x.name, phone: x.phones[0] || '—', morePhones: x.phones.length > 1 ? '+' + (x.phones.length - 1) : '', hasMorePhones: x.phones.length > 1,
        contact: x.contact || '—', open: open ? String(open) : '—', balance: bal.text, balColor: bal.fg, balWeight: bal.weight,
        sub: [x.contact, x.phones[0]].filter(Boolean).join(' · '), archived: x.archived, notArchived: !x.archived,
        aria: 'Open ' + x.name, menuAria: 'Actions for ' + x.name, menuOpen: menuOpen, toggleMenu: function () { up({ menu: menuOpen ? null : x.id }); },
        edit: function () { up({ form: x.id, f: null, tried: false, menu: null }); },
        archive: function () { up({ sups: sups.map(function (y) { return y.id === x.id ? Object.assign({}, y, { archived: !x.archived }) : y; }), menu: null, toast: toast(x.archived ? x.name + ' is back in the list.' : x.name + ' is archived. Their orders and ledger stay.') }); },
        pay: function () { up({ menu: null, toast: toast('Open ' + x.name + ' to record a payment.') }); }
      };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyText = q ? 'No suppliers match.' : tab === 'archived' ? 'No archived suppliers.' : 'No suppliers yet.';
    vals.emptyCanReset = Boolean(q);
    vals.emptyReset = function () { up({ q: '' }); };
    vals.q = s.q || '';
    vals.onQ = function (e) { up({ q: e.target.value }); };
    vals.hasFilters = Boolean(q);
    vals.clearAll = function () { up({ q: '' }); };
    vals.exportSups = function () { up({ toast: toast('Exported ' + plural(list.length, 'supplier', 'suppliers') + ' to Excel.') }); };
    var mOpen = s.menu ? sups.filter(function (x) { return x.id === s.menu; })[0] : null;
    vals.menuOpen = Boolean(mOpen);
    vals.mx = rowOf(mOpen || sups[0]);

    vals.sf = supplierForm(s, up, sups, function (data, editing) {
      if (editing) up({ sups: sups.map(function (x) { return x.id === editing.id ? Object.assign({}, x, data) : x; }), form: null, f: null, tried: false, toast: toast('Supplier saved.') });
      else up({ sups: [Object.assign({ id: 's9', balance: data.opening, archived: false, since: TODAY }, data)].concat(sups), form: null, f: null, tried: false, q: '', tab: 'active', toast: toast('Supplier saved.') });
    }, function (x) { up({ sups: sups.map(function (y) { return y.id === x.id ? Object.assign({}, y, { archived: true }) : y; }), form: null, f: null, toast: toast(x.name + ' is archived. Their orders and ledger stay.') }); });
    vals.newSupplier = function () { up({ form: 'new', f: null, tried: false }); };
    vals.closeForm = function () { up({ form: null, f: null, tried: false }); };
    var reset = { menu: null, form: null, f: null, tried: false };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ menu: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    return vals;
  }
}
