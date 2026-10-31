var PER_PAGE = 10;
var START = {
  List: {}, 'Tag filter': { pop: 'tag' }, 'Row menu': { menu: 'c2' }, 'Add customer': { form: { mode: 'new' } }, 'Edit customer': { form: { mode: 'edit', id: 'c2' } },
  'Phone taken': { form: { mode: 'new' }, fdFor: '{"mode":"new"}', fd: { phone: '01712-345678', name: 'Rahim', email: '', tags: [], note: '', tagInput: '', tried: false } },
  Export: { exp: true }, 'Delete customer': { confirm: 'c5' }, More: { more: true }
};

class Component extends DCLogic {
  renderVals() {
    var self = this;
    var startKey = this.props.startOn ?? 'List';
    var s = this.state || {};
    if (s.started !== startKey) s = Object.assign({ started: startKey, dark: s.dark }, copy(START[startKey] || {}));
    var up = function (patch) { self.setState(Object.assign({}, s, patch, { started: startKey })); };
    var toast = function (text) {
      clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function () { self.setState({ toast: null }); }, 4000);
      return text;
    };
    var vals = {};
    var customers = s.customers || CUSTOMERS;
    var byId = function (id) { return customers.filter(function (c) { return c.id === id; })[0]; };

    // Search by phone or name, and one tag.
    var q = (s.q || '').trim().toLowerCase();
    var qd = q.replace(/[^0-9]/g, '').replace(/^880/, '0');
    var tag = s.tag || '';
    vals.q = s.q || '';
    vals.onQ = function (e) { up({ q: e.target.value, page: 0 }); };
    var list = customers.filter(function (c) {
      return (!tag || c.tags.indexOf(tag) !== -1) && (!q || c.name.toLowerCase().indexOf(q) !== -1 || (qd.length >= 3 && c.phone.indexOf(qd) !== -1));
    });
    var page = Math.min(s.page || 0, Math.max(0, Math.ceil(list.length / PER_PAGE) - 1));
    var shown = list.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
    var rowOf = function (c) {
      var menuOpen = s.menu === c.id;
      return {
        name: c.name, initials: initials(c.name), phone: fmtPhone(c.phone),
        orders: String(c.orders), spent: c.orders ? money(c.spent) : '—', last: c.last || '—',
        meta: fmtPhone(c.phone) + ' · ' + plural(c.orders, 'order', 'orders'),
        tags: c.tags.map(function (t) { return { label: t, on: t === tag ? 'true' : 'false', aria: 'Show customers tagged ' + t, pick: function () { up({ tag: t, page: 0, menu: null }); } }; }),
        hasTags: c.tags.length > 0,
        flag: c.flagged || c.risky, flagLabel: c.flagged ? 'Flagged' : 'Risky',
        tel: 'tel:+88' + c.phone, wa: 'https://wa.me/88' + c.phone,
        current: menuOpen ? 'true' : 'false',
        menuOpen: menuOpen, menuExpanded: menuOpen ? 'true' : 'false', menuAria: 'Actions for ' + c.name,
        toggleMenu: function () { up({ menu: menuOpen ? null : c.id }); },
        edit: function () { up({ menu: null, form: { mode: 'edit', id: c.id } }); },
        askDelete: function () { up({ menu: null, confirm: c.id }); }
      };
    };
    vals.rows = shown.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyText = q || tag ? 'No customers match.' : 'No customers yet. They are added with their first order, or imported.';
    vals.hasRows = list.length > 0;
    vals.showText = list.length ? 'Showing ' + (page * PER_PAGE + 1) + '–' + (page * PER_PAGE + shown.length) : '';
    vals.pageText = 'Page ' + (page + 1);
    vals.firstPage = page === 0;
    vals.lastPage = (page + 1) * PER_PAGE >= list.length;
    vals.prev = function () { up({ page: page - 1 }); };
    vals.next = function () { up({ page: page + 1 }); };
    vals.first = function () { up({ page: 0 }); };
    var mc = s.menu ? byId(s.menu) : null;
    vals.menuOpen = Boolean(mc);
    vals.mc = rowOf(mc || customers[0]);

    // Tag filter.
    var tagOpen = s.pop === 'tag';
    var tq = tagOpen ? (s.tq || '').trim().toLowerCase() : '';
    var tags = allTags(customers);
    var tagShown = tags.filter(function (t) { return !tq || t.label.indexOf(tq) !== -1; });
    vals.tf = {
      open: tagOpen, aria: tagOpen ? 'true' : 'false', toggle: function () { up({ pop: tagOpen ? null : 'tag', tq: '' }); },
      has: Boolean(tag), none: !tag, label: tag, buttonText: tag ? 'Tag: ' + tag : 'Tag',
      query: s.tq || '', onQuery: function (e) { up({ tq: e.target.value }); }, noMatch: tagShown.length === 0,
      allCheck: tag ? '0' : '1', allAria: tag ? 'false' : 'true', pickAll: function () { up({ tag: '', pop: null, page: 0 }); },
      items: tagShown.map(function (t) {
        var on = t.label === tag;
        return { label: t.label, count: String(t.count), check: on ? '1' : '0', aria: on ? 'true' : 'false', pick: function () { up({ tag: on ? '' : t.label, pop: null, page: 0 }); } };
      }),
      clear: function () { up({ tag: '', pop: null, page: 0 }); }
    };
    vals.hasFilters = Boolean(tag || q);
    vals.clearAll = function () { up({ tag: '', q: '', page: 0 }); };

    // Add / edit.
    vals.f = customerForm(s, up, customers, function (data, editing) {
      if (editing) {
        up({ customers: customers.map(function (c) { return c.id === editing.id ? Object.assign({}, c, data) : c; }), form: null, fd: null, toast: toast('Customer saved.') });
      } else {
        var nc = Object.assign({ id: 'n' + customers.length, orders: 0, spent: 0, last: '', since: '', flagged: false, risky: false, failed: 0 }, data);
        up({ customers: [nc].concat(customers), form: null, fd: null, q: '', tag: '', page: 0, toast: toast(data.name + ' added.') });
      }
    }, function (editing) { up({ form: null, fd: null, confirm: editing.id }); });
    vals.newCustomer = function () { up({ form: { mode: 'new' }, fd: null, more: false }); };
    vals.closeForm = function () { up({ form: null, fd: null }); };

    // Export.
    var exFiltered = (s.exWhich || (tag || q ? 'filtered' : 'all')) === 'filtered' && Boolean(tag || q);
    var exFmt = s.exFmt || 'xlsx';
    vals.ex = {
      open: Boolean(s.exp),
      xlsx: exFmt === 'xlsx', csv: exFmt === 'csv', xlsxAria: exFmt === 'xlsx' ? 'true' : 'false', csvAria: exFmt === 'csv' ? 'true' : 'false',
      pickXlsx: function () { up({ exFmt: 'xlsx' }); }, pickCsv: function () { up({ exFmt: 'csv' }); },
      filtered: exFiltered, all: !exFiltered, filteredAria: exFiltered ? 'true' : 'false', allAria: exFiltered ? 'false' : 'true',
      noFilters: !(tag || q), filteredOpacity: tag || q ? '1' : '.5',
      filteredLabel: tag || q ? 'The ' + plural(list.length, 'customer', 'customers') + ' matching the search and tag' : 'Customers matching the search and tag (none set)',
      allLabel: 'All customers',
      pickFiltered: function () { up({ exWhich: 'filtered' }); }, pickAll: function () { up({ exWhich: 'all' }); },
      run: function () {
        var count = exFiltered ? list.length : customers.length;
        up({ exp: false, toast: toast('Exported ' + plural(count, 'customer', 'customers') + (exFmt === 'csv' ? ' to CSV.' : ' to Excel.')) });
      }
    };
    vals.openExport = function () { up({ exp: true, more: false, exWhich: null }); };
    vals.closeExport = function () { up({ exp: false }); };
    vals.moreOpen = Boolean(s.more);
    vals.openMore = function () { up({ more: true }); };

    // Delete.
    var del = s.confirm ? byId(s.confirm) : null;
    vals.confirmOpen = Boolean(del);
    vals.confirmTitle = del ? 'Delete ' + del.name + '?' : '';
    vals.doDelete = function () { up({ customers: customers.filter(function (c) { return c.id !== del.id; }), confirm: null, toast: toast('Customer deleted.') }); };
    vals.cancelConfirm = function () { up({ confirm: null }); };

    var reset = { menu: null, pop: null, form: null, fd: null, exp: false, confirm: null, more: false };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ menu: null, pop: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    vals.hasToast = Boolean(s.toast);
    vals.toastText = s.toast || '';

    var dark = typeof s.dark === 'boolean' ? s.dark : (this.props.dark ?? false);
    vals.themeClass = ROOT + (dark ? ' dark' : '');
    vals.fontStack = FONTS[this.props.font ?? 'Inter'] || FONTS.Inter;
    vals.isDark = dark;
    vals.isLight = !dark;
    vals.themeLabel = dark ? 'Switch to light theme' : 'Switch to dark theme';
    vals.toggleTheme = function () { up({ dark: !dark }); };
    return vals;
  }
}
