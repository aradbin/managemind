var START = { 'Audit log': {}, 'Details open': { open: 1 }, 'One store': { sf: ['t6'] }, 'Nothing matches': { q: 'refund' } };
// when, actor (null: system), action, store, details
var AUDIT = [
  ['2026-10-29T14:20', 'Sumaiya Rahman', 'support.start', 't4', { role: 'viewer', minutes: 60, reason: 'Owner asked for help with delivery charges' }],
  ['2026-10-29T09:00', null, 'invoice.reminder', 't1', { number: 'INV-2026-0042', daysOverdue: 17 }],
  ['2026-10-27T16:30', 'Tanvir Hasan', 'tenant.create', 't9', { slug: 'teagarden', kind: 'client', plan: 'starter' }],
  ['2026-10-26T09:00', null, 'invoice.issue', 't7', { number: 'INV-2026-0047', total: 4870 }],
  ['2026-10-24T18:12', 'Rafiq Ahmed', 'invoice.payment', 't3', { number: 'INV-2026-0045', amount: 1500, method: 'bkash', reference: '8KD4R2LQ' }],
  ['2026-10-18T12:44', 'Tanvir Hasan', 'tenant.create', 't5', { slug: 'modhumela', kind: 'client', plan: 'starter' }],
  ['2026-10-14T11:05', 'Rafiq Ahmed', 'platform.role_change', null, { user: 'farhana@managemind.app', from: 'support', to: null }],
  ['2026-10-10T15:31', 'Tanvir Hasan', 'subscription.update', 't1', { priceOverride: 1500 }],
  ['2026-10-02T09:30', 'Rafiq Ahmed', 'tenant.suspend', 't6', { category: 'overdue', reason: 'INV-2026-0040 unpaid for two weeks' }],
  ['2026-09-20T17:02', 'Rafiq Ahmed', 'tenant.close', 't8', { category: 'client_request' }],
  ['2026-09-12T10:15', 'Rafiq Ahmed', 'terms.publish', null, { version: '2026-09', effectiveAt: '2026-10-01' }]
];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Audit log');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var q = (s.q || '').trim().toLowerCase(), sf = s.sf || [], af = s.af || [];
    var actions = AUDIT.map(function (a) { return a[2]; }).filter(function (x, i, arr) { return arr.indexOf(x) === i; }).sort();
    vals.af = listFilter(s, up, 'af', actions.map(function (x) { return [x, x]; }), function (k) { return AUDIT.filter(function (a) { return a[2] === k; }).length; });
    vals.sf = listFilter(s, up, 'sf', STORES.filter(function (t) { return AUDIT.some(function (a) { return a[3] === t[0]; }); }).map(function (t) { return [t[0], t[1]]; }), function (k) { return AUDIT.filter(function (a) { return a[3] === k; }).length; });
    var rows = AUDIT.map(function (a, i) { return { a: a, i: i }; }).filter(function (x) { var a = x.a, t = a[3] ? tById(a[3]) : null; return (!q || (a[2] + ' ' + (a[1] || 'system') + ' ' + (t ? t[1] : '') + ' ' + JSON.stringify(a[4])).toLowerCase().indexOf(q) !== -1) && (!sf.length || sf.indexOf(a[3]) !== -1) && (!af.length || af.indexOf(a[2]) !== -1); });
    vals.rows = rows.map(function (x) {
      var a = x.a, t = a[3] ? tById(a[3]) : null, open = s.open === x.i;
      return { when: short(a[0].slice(0, 10)) + ', ' + clock(a[0].slice(11, 16)), actor: a[1] || 'System', isSystem: !a[1], action: a[2], store: t ? t[1] : '—', storeHref: t ? P('PlatformStore') : '#', hasStore: Boolean(t), noStore: !t,
        open: open, aria: open ? 'true' : 'false', toggle: function () { up({ open: open ? null : x.i }); }, json: JSON.stringify(a[4], null, 2), detailsAria: 'Details of ' + a[2] + ' on ' + short(a[0].slice(0, 10)) };
    });
    vals.hasRows = rows.length > 0; vals.noRows = !vals.hasRows;
    vals.count = plural(rows.length, 'entry', 'entries');
    vals.q = s.q || ''; vals.onQ = function (e) { up({ q: e.target.value }); };
    vals.hasFilters = Boolean(q || sf.length || af.length);
    vals.clearAll = function () { up({ q: '', sf: [], af: [], fopen: null }); };
    vals.closePop = function () { up({ fopen: null }); };
    vals.closeAll = vals.closePop;
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); vals.closePop(); } };
    return vals;
  }
}
