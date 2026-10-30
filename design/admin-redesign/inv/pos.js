var START = {
  'Purchase orders': {}, 'To receive': { st: 'open' }, 'Supplier filter': { pop: 'sup' }, 'Row menu': { menu: 'po17' }, 'Cancel order': { confirm: 'po17' },
  'Delete draft': { confirm: 'po18' }
};
var TABS = [['all', 'All'], ['draft', 'Draft'], ['open', 'To receive'], ['received', 'Received'], ['closed', 'Closed'], ['cancelled', 'Cancelled']];
function tabOf(po) { return po.status === 'ordered' || po.status === 'partially_received' ? 'open' : po.status; }

class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Purchase orders');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var pos = s.pos || POS;
    var st = s.st || 'all', sup = s.sup || '', q = (s.q || '').trim().toLowerCase();
    var base = pos.filter(function (p) { return (!sup || p.sup === sup) && (!q || p.ref.toLowerCase().indexOf(q) !== -1 || sById(p.sup).name.toLowerCase().indexOf(q) !== -1); });
    vals.tabs = TABS.map(function (t) {
      var n = t[0] === 'all' ? base.length : base.filter(function (p) { return tabOf(p) === t[0]; }).length;
      return { label: t[1], count: String(n), on: st === t[0] ? 'true' : 'false', pick: function () { up({ st: t[0], menu: null }); } };
    });
    var list = base.filter(function (p) { return st === 'all' || tabOf(p) === st; });
    var rowOf = function (p) {
      var pr = poProgress(p), tt = poTotals(p.lines, p.costs), menuOpen = s.menu === p.id;
      var overdue = (p.status === 'ordered' || p.status === 'partially_received') && p.expected && p.expected < TODAY;
      var canReceive = p.status === 'ordered' || p.status === 'partially_received';
      return {
        ref: p.ref, supplier: sById(p.sup).name, badge: badgeOf(PO_STATUS, p.status),
        progress: pr.text, pct: pr.pct, done: pr.received >= pr.ordered && pr.ordered > 0, showProg: p.status !== 'draft' && p.status !== 'cancelled', noProg: p.status === 'draft' || p.status === 'cancelled',
        progColor: pr.received >= pr.ordered ? 'var(--success)' : 'var(--primary)',
        expected: p.expected ? (overdue ? 'Late · ' + short(p.expected) : short(p.expected)) : '—', expColor: overdue ? 'var(--destructive)' : 'var(--muted-foreground)',
        total: money(tt.total), aria: 'Open ' + p.ref + ', ' + sById(p.sup).name,
        menuOpen: menuOpen, menuAria: 'Actions for ' + p.ref, toggleMenu: function () { up({ menu: menuOpen ? null : p.id }); },
        canReceive: canReceive, isDraft: p.status === 'draft', canCancel: p.status === 'ordered',
        meta: sById(p.sup).name,
        print: function () { up({ menu: null, toast: toast(p.ref + ' opened for printing.') }); },
        ask: function () { up({ menu: null, confirm: p.id }); }
      };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyText = q || sup || st !== 'all' ? 'No purchase orders match.' : 'No purchase orders yet.';
    vals.emptyCanReset = Boolean(q || sup || st !== 'all');
    vals.emptyReset = function () { up({ q: '', sup: '', st: 'all' }); };
    vals.q = s.q || '';
    vals.onQ = function (e) { up({ q: e.target.value }); };
    var sOpen = s.pop === 'sup', sq = sOpen ? (s.sq || '') : '';
    var sShown = SUPPLIERS.filter(function (x) { return !x.archived && (!sq.trim() || x.name.toLowerCase().indexOf(sq.trim().toLowerCase()) !== -1); });
    vals.sf = {
      open: sOpen, aria: sOpen ? 'true' : 'false', toggle: function () { up({ pop: sOpen ? null : 'sup', sq: '' }); },
      has: Boolean(sup), label: sup ? sById(sup).name : '', query: sq, onQuery: function (e) { up({ sq: e.target.value }); }, none: sShown.length === 0,
      items: sShown.map(function (x) {
        var on = sup === x.id;
        return { label: x.name, count: String(pos.filter(function (p) { return p.sup === x.id; }).length), check: on ? '1' : '0', aria: on ? 'true' : 'false', on: on, pick: function () { up({ sup: on ? '' : x.id, pop: s.pop === 'filters' ? 'filters' : null }); } };
      }),
      clear: function () { up({ sup: '', pop: null }); }
    };
    vals.supButton = sup ? sById(sup).name : 'Supplier';
    vals.allSupAria = sup ? 'false' : 'true';
    vals.allSupCheck = sup ? '0' : '1';
    vals.hasFilters = Boolean(q || sup);
    vals.clearAll = function () { up({ q: '', sup: '' }); };
    var open = pos.filter(function (p) { return p.status === 'ordered' || p.status === 'partially_received'; });
    vals.openText = open.length ? plural(open.length, 'order', 'orders') + ' still to receive, worth ' + money(open.reduce(function (a, p) { return a + poTotals(p.lines.map(function (l) { return [l[0], l[1] - l[3], l[2]]; }), []).goods; }, 0)) + ' in goods.' : '';
    vals.hasOpen = open.length > 0;
    vals.exportPos = function () { up({ toast: toast('Exported ' + plural(list.length, 'purchase order', 'purchase orders') + ' to Excel.') }); };
    var mOpen = s.menu ? pos.filter(function (p) { return p.id === s.menu; })[0] : null;
    vals.menuOpen = Boolean(mOpen);
    vals.mx = rowOf(mOpen || pos[0]);

    var cf = s.confirm ? pos.filter(function (p) { return p.id === s.confirm; })[0] : null;
    var isDraft = cf && cf.status === 'draft';
    vals.cancelOpen = Boolean(cf) && !isDraft;
    vals.deleteOpen = Boolean(isDraft);
    vals.cfTitle = cf ? (isDraft ? 'Delete draft ' + cf.ref + '?' : 'Cancel ' + cf.ref + '?') : '';
    vals.doCancel = function () { up({ pos: pos.map(function (p) { return p.id === cf.id ? Object.assign({}, p, { status: 'cancelled' }) : p; }), confirm: null, toast: toast('Purchase order cancelled.') }); };
    vals.doDelete = function () { up({ pos: pos.filter(function (p) { return p.id !== cf.id; }), confirm: null, toast: toast('Draft deleted.') }); };
    var reset = { menu: null, pop: null, confirm: null };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ menu: null, pop: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    return vals;
  }
}
