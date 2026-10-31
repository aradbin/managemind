var START = {
  Adjustments: {}, 'Reason filter': { pop: 'reason' }, 'Date filter': { pop: 'date' }, 'Damaged only': { reason: 'damaged' },
  'This month': { from: '2026-10-01', to: '2026-10-29' }, 'Nothing found': { reason: 'expired', from: '2026-10-01', to: '2026-10-29' }, Filters: { pop: 'filters' }
};
var ADJ = [
  ['a1', '2026-10-28', '14:20', 'v7', 'damaged', 'Torn at the seam', -1],
  ['a2', '2026-10-27', '11:05', 'v14', 'sample', 'Gift for a wholesale buyer', -2],
  ['a3', '2026-10-25', '18:40', 'v1', 'returned', 'Order #1042, wrong size', 1],
  ['a4', '2026-10-22', '16:30', 'v9', 'lost', 'Missing after the Banani fair', -1],
  ['a5', '2026-10-20', '12:00', 'v11', 'correction', 'Typed 7 instead of 8 on import', 1],
  ['a6', '2026-10-18', '09:30', 'v8', 'damaged', 'Water stain on the pallu', -1],
  ['a7', '2026-10-15', '13:45', 'v5', 'sample', 'Photo shoot', -1],
  ['a8', '2026-10-12', '17:15', 'v3', 'count', 'SC-0005', -2],
  ['a9', '2026-10-12', '17:15', 'v6', 'count', 'SC-0005', -1],
  ['a10', '2026-10-06', '10:00', 'v16', 'received', 'From the old shop', 3],
  ['a11', '2026-10-02', '15:00', 'v4', 'other', 'Stitching sample for the tailor', -1],
  ['a12', '2026-09-28', '14:10', 'v2', 'returned', 'Order #1011, wrong size', 1],
  ['a13', '2026-09-25', '12:00', 'v14', 'correction', '', 5],
  ['a14', '2026-09-12', '11:20', 'v12', 'damaged', 'Sole came off', -1],
  ['a15', '2026-09-03', '16:00', 'v10', 'import', 'Opening stock', 22]
];
var PRESETS = [['month', 'This month', '2026-10-01', '2026-10-29'], ['last', 'Last month', '2026-09-01', '2026-09-30'], ['30', 'Last 30 days', '2026-09-30', '2026-10-29']];
function reasonLabel(r) { return (REASONS.filter(function (x) { return x[0] === r; })[0] || [r, r])[1]; }

class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Adjustments');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var reason = s.reason || '', from = s.from || '', to = s.to || '';
    var inDates = function (a) { return (!from || a[1] >= from) && (!to || a[1] <= to); };
    var list = ADJ.filter(function (a) { return inDates(a) && (!reason || a[4] === reason); });
    var valueOf = function (a) { var v = vById(a[3]); return v.cost === null ? null : a[6] * v.cost; };
    var units = list.reduce(function (x, a) { return x + a[6]; }, 0);
    var value = list.reduce(function (x, a) { var v = valueOf(a); return x + (v || 0); }, 0);
    var unvalued = list.filter(function (a) { return valueOf(a) === null; }).length;
    vals.totals = [plural(list.length, 'adjustment', 'adjustments') + ', ' + signed(units) + ' units', 'Value ' + money(value)].concat(unvalued ? [unvalued + ' without a cost'] : []).join(' · ');
    vals.hasRows = list.length > 0;
    var rowOf = function (a) {
      var v = vById(a[3]), val = valueOf(a);
      return {
        when: short(a[1]) + ', ' + clock(a[2]), day: short(a[1]), time: clock(a[2]), item: v.t, opts: v.o, hasOpts: Boolean(v.o), sku: v.sku,
        reason: reasonLabel(a[4]), note: a[5], hasNote: Boolean(a[5]),
        reasonText: [reasonLabel(a[4]), a[5]].filter(Boolean).join(' · '),
        qty: signed(a[6]), qtyColor: a[6] < 0 ? 'var(--destructive)' : 'var(--foreground)',
        value: val === null ? '—' : money(val), valueColor: val === null || val >= 0 ? 'var(--muted-foreground)' : 'var(--foreground)'
      };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyText = 'No adjustments in this period.';

    // Reason: one at a time, with how many each has in the dates chosen.
    var rOpen = s.pop === 'reason';
    var rq = rOpen ? (s.rq || '') : '';
    var rShown = REASONS.filter(function (r) { return !rq.trim() || r[1].toLowerCase().indexOf(rq.trim().toLowerCase()) !== -1; });
    vals.rf = {
      open: rOpen, aria: rOpen ? 'true' : 'false', toggle: function () { up({ pop: rOpen ? null : 'reason', rq: '' }); },
      has: Boolean(reason), label: reason ? reasonLabel(reason) : '', query: rq, onQuery: function (e) { up({ rq: e.target.value }); }, none: rShown.length === 0,
      items: rShown.map(function (r) {
        var on = reason === r[0];
        return { label: r[1], count: String(ADJ.filter(function (a) { return inDates(a) && a[4] === r[0]; }).length), check: on ? '1' : '0', aria: on ? 'true' : 'false', on: on, pick: function () { up({ reason: on ? '' : r[0], pop: s.pop === 'filters' ? 'filters' : null }); } };
      }),
      clear: function () { up({ reason: '', pop: null }); }
    };
    // Dates: a preset, or from and to.
    var dOpen = s.pop === 'date';
    var preset = PRESETS.filter(function (p) { return p[2] === from && p[3] === to; })[0];
    vals.df = {
      open: dOpen, aria: dOpen ? 'true' : 'false', toggle: function () { up({ pop: dOpen ? null : 'date' }); },
      has: Boolean(from || to), label: preset ? preset[1] : from && to ? short(from) + ' – ' + short(to) : from ? 'From ' + short(from) : to ? 'Until ' + short(to) : '',
      from: from, to: to, onFrom: function (e) { up({ from: e.target.value }); }, onTo: function (e) { up({ to: e.target.value }); },
      presets: PRESETS.map(function (p) { var on = preset && preset[0] === p[0]; return { label: p[1], on: on ? 'true' : 'false', pick: function () { up({ from: p[2], to: p[3] }); } }; }),
      clear: function () { up({ from: '', to: '', pop: s.pop === 'filters' ? 'filters' : null }); }
    };
    vals.hasFilters = Boolean(reason || from || to);
    vals.clearAll = function () { up({ reason: '', from: '', to: '' }); };
    var n = (reason ? 1 : 0) + (from || to ? 1 : 0);
    vals.filterCount = String(n);
    vals.hasCount = n > 0;
    vals.filtersOpen = s.pop === 'filters';
    vals.openFilters = function () { up({ pop: 'filters' }); };
    vals.showText = 'Show ' + plural(list.length, 'adjustment', 'adjustments');
    vals.allReasonsOn = reason ? 'false' : 'true';
    vals.allCheck = reason ? '0' : '1';
    vals.noFilters = !(reason || from || to);
    vals.pickAllReasons = function () { up({ reason: '' }); };
    vals.exportAdj = function () { up({ pop: null, toast: toast('Exported ' + plural(list.length, 'adjustment', 'adjustments') + ' to Excel.') }); };
    var reset = { pop: null };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up(reset); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    return vals;
  }
}
