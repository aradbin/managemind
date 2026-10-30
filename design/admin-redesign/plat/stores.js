var START = { Stores: {}, 'Search with no match': { q: 'zzz' }, 'Demo and test stores': { kf: ['demo', 'test'] }, 'Row menu': { menu: 't6' }, 'Support role': { support: true }, 'Two-factor login needed': { no2fa: true } };
var TABS = [['all', 'All'], ['active', 'Active'], ['setup', 'Still setting up'], ['suspended', 'Suspended'], ['closed', 'Closed'], ['purged', 'Deleted']];
function inTab(t, k) { return k === 'all' || (k === 'setup' ? t[3] === 'active' && t[4] === 'client' && (t[6] === null || t[6] < 8) : t[3] === k); }
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Stores');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var q = (s.q || '').trim().toLowerCase(), tab = s.tab || 'all', kf = s.kf || [], pf = s.pf || [];
    var st = s.st || {};
    var all = STORES.map(function (t) { return st[t[0]] ? t.slice(0, 3).concat([st[t[0]]], t.slice(4)) : t; });
    vals.no2fa = Boolean(s.no2fa); vals.has2fa = !s.no2fa;
    vals.canCreate = !s.support;
    var base = all.filter(function (t) { return (!q || (t[1] + ' ' + t[2]).toLowerCase().indexOf(q) !== -1) && (!kf.length || kf.indexOf(t[4]) !== -1) && (!pf.length || pf.indexOf(t[5]) !== -1); });
    vals.tabs = TABS.map(function (x) { var n = base.filter(function (t) { return inTab(t, x[0]); }).length; return { label: x[1], count: x[0] === 'all' || n ? String(n) : '', on: tab === x[0] ? 'true' : 'false', pick: function () { up({ tab: x[0] }); } }; });
    vals.kf = listFilter(s, up, 'kf', [['client', 'Client'], ['demo', 'Demo'], ['test', 'Test']], function (k) { return all.filter(function (t) { return t[4] === k; }).length; });
    vals.pf = listFilter(s, up, 'pf', PLANS.map(function (p) { return [p[0], p[1]]; }), function (k) { return all.filter(function (t) { return t[5] === k; }).length; });
    var rows = base.filter(function (t) { return inTab(t, tab); });
    vals.rows = rows.map(function (t) {
      var p = planOf(t[5]), done = t[6];
      var canSuspend = !s.support && t[3] === 'active', canReactivate = !s.support && t[3] === 'suspended';
      return { name: t[1], tile: initials(t[1]), slug: t[2] + '.managemind.app', chip: tChip(t[3]), plan: p[1], kind: KINDS[t[4]], notClient: t[4] !== 'client',
        setup: setupText(t), setupPct: done === null ? '0%' : done * 10 + '%', setupColor: done === 10 ? 'var(--success)' : 'var(--primary)', checked: done !== null,
        created: longDate(t[7]), href: P('PlatformStore'), aria: 'Open ' + t[1],
        menuOpen: s.menu === t[0], menuAria: 'Actions for ' + t[1], toggleMenu: function () { up({ menu: s.menu === t[0] ? null : t[0] }); },
        canSuspend: canSuspend, canReactivate: canReactivate, canAct: canSuspend || canReactivate,
        invoices: P('PlatformBilling'),
        suspend: function () { up({ menu: null, dlg: t[0] }); },
        reactivate: function () { var n = Object.assign({}, st); n[t[0]] = 'active'; up({ menu: null, st: n, toast: toast(t[1] + ' is active again.') }); } };
    });
    vals.count = plural(rows.length, 'store', 'stores');
    vals.hasRows = rows.length > 0; vals.noRows = !vals.hasRows;
    vals.q = s.q || ''; vals.onQ = function (e) { up({ q: e.target.value }); };
    vals.hasFilters = Boolean(q || kf.length || pf.length);
    vals.clearAll = function () { up({ q: '', kf: [], pf: [], fopen: null }); };
    var d = all.filter(function (t) { return t[0] === s.dlg; })[0];
    var sf = pform(s, up, 'sf', { why: 'overdue', reason: '' });
    vals.sf = sf;
    vals.whys = choice(sf, 'why', WHY);
    vals.sd = { open: Boolean(d), title: d ? 'Suspend ' + d[1] + '?' : '',
      confirm: function () { var n = Object.assign({}, st); n[d[0]] = 'suspended'; up({ dlg: null, sf: null, st: n, toast: toast(d[1] + ' is suspended.') }); } };
    vals.readOnly = false;
    vals.closePop = function () { up({ menu: null, fopen: null }); };
    vals.closeAll = function () { up({ menu: null, fopen: null, dlg: null, sf: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); vals.closeAll(); } };
    return vals;
  }
}
