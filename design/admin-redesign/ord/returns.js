var START = { Returns: {}, Requested: { tab: 'requested' }, 'Row menu': { menu: 'r14' }, 'Reason filter': { rf: ['damaged'], fopen: 'rf' }, 'Nothing found': { q: 'R-0099' } };
var TABS = [['all', 'All'], ['requested', 'Requested'], ['progress', 'In progress'], ['resolved', 'Resolved'], ['rejected', 'Rejected']];
function inTab(r, t) { return t === 'all' || (t === 'progress' ? ['approved', 'in_transit', 'received', 'inspected'].indexOf(r.status) !== -1 : r.status === t); }
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Returns');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var all = s.list || RETURNS;
    var tab = s.tab || 'all';
    var q = (s.q || '').trim().toLowerCase().replace(/^#/, ''), rf = s.rf || [];
    var base = all.filter(function (r) {
      if (q && r.ref.toLowerCase().indexOf(q) === -1 && String(r.order).indexOf(q) === -1 && r.name.toLowerCase().indexOf(q) === -1) return false;
      if (rf.length && !r.lines.some(function (l) { return rf.indexOf(l[2]) !== -1; })) return false;
      return true;
    });
    vals.tabs = TABS.map(function (t) { var n = base.filter(function (r) { return inTab(r, t[0]); }).length; return { label: t[1], count: t[0] === 'all' || n ? String(n) : '', on: tab === t[0] ? 'true' : 'false', pick: function () { up({ tab: t[0], menu: null }); } }; });
    var list = base.filter(function (r) { return inTab(r, tab); });
    vals.rf = listFilter(s, up, 'rf', Object.keys(RET_REASONS).map(function (k) { return [k, RET_REASONS[k]]; }), function (k) { return all.filter(function (r) { return r.lines.some(function (l) { return l[2] === k; }); }).length; });
    var setR = function (r, patch, msg) { up({ list: all.map(function (x) { return x.id === r.id ? Object.assign({}, x, patch) : x; }), menu: null, toast: toast(msg) }); };
    var rowOf = function (r) {
      var menuOpen = s.menu === r.id;
      return {
        ref: r.ref, order: '#' + r.order, name: r.name, items: retItems(r), reason: RET_REASONS[r.lines[0][2]], chip: retChip(r.status), at: short(r.at.slice(0, 10)), value: money(retValue(r)),
        wants: r.wants === 'refund' ? 'Wants a refund' : 'Wants an exchange', aria: 'Open return ' + r.ref, meta: '#' + r.order + ' · ' + r.name,
        menuOpen: menuOpen, menuAria: 'Actions for return ' + r.ref, toggleMenu: function () { up({ menu: menuOpen ? null : r.id }); },
        isRequested: r.status === 'requested', canReceive: r.status === 'approved' || r.status === 'in_transit',
        approve: function () { setR(r, { status: 'approved' }, r.ref + ' is approved. Ask them to send it back.'); },
        reject: function () { setR(r, { status: 'rejected' }, r.ref + ' is rejected.'); },
        receive: function () { setR(r, { status: 'received' }, r.ref + ' is received. Inspect it next.'); }
      };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyText = q || rf.length ? 'No returns match.' : 'No returns here.';
    vals.hasFilters = Boolean(q || rf.length);
    vals.clearAll = function () { up({ q: '', rf: [], fopen: null }); };
    vals.q = s.q || ''; vals.onQ = function (e) { up({ q: e.target.value }); };
    var openOnes = all.filter(function (r) { return r.status !== 'resolved' && r.status !== 'rejected'; });
    vals.summary = plural(openOnes.length, 'open return', 'open returns') + ' · ' + money(openOnes.reduce(function (a, r) { return a + retValue(r); }, 0));
    var mOpen = s.menu ? all.filter(function (r) { return r.id === s.menu; })[0] : null;
    vals.menuOpen = Boolean(mOpen);
    vals.mx = rowOf(mOpen || all[0]);
    vals.closeAll = function () { up({ menu: null, fopen: null }); };
    vals.closePop = function () { up({ menu: null, fopen: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ menu: null, fopen: null }); } };
    return vals;
  }
}
