var START = { Invoices: {}, Overdue: { tab: 'overdue' }, 'One store': { store: 't4' }, 'New invoice': { store: 't4', panel: 'new' }, 'Our invoice details': { panel: 'issuer' }, 'Details not set': { noIssuer: true } };
var BTABS = [['all', 'All'], ['draft', 'Drafts'], ['overdue', 'Overdue'], ['week', 'Due this week'], ['paid', 'Paid'], ['void', 'Void']];
var ISSUER = { legal: 'ManageMind Ltd.', address: 'House 12, Road 7, Block C\nBanani, Dhaka 1213', license: 'TRAD/DNCC/045812/2025', bin: '004567891-0101', vat: '', email: 'billing@managemind.app', phone: '01755-000555',
  bank: 'City Bank', accName: 'ManageMind Ltd.', accNo: '1502 7781 0042', branch: 'Gulshan', routing: '225261732', bkash: '01755-000555', nagad: '01755-000556' };
function inBTab(i, k) {
  var over = i[2] === 'issued' && i[4] < TODAY, week = i[2] === 'issued' && i[4] >= TODAY && i[4] <= addDays(TODAY, 6);
  return k === 'all' || (k === 'overdue' ? over : k === 'week' ? week : i[2] === k);
}
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Invoices');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    vals.readOnly = false;
    var tab = s.tab || 'all', q = (s.q || '').trim().toLowerCase();
    var all = (s.added || []).concat(INVOICES);
    var base = all.filter(function (i) { var t = tById(i[1]); return (!s.store || i[1] === s.store) && (!q || ((i[0] || 'draft') + ' ' + t[1]).toLowerCase().indexOf(q) !== -1); });
    vals.tabs = BTABS.map(function (x) { var n = base.filter(function (i) { return inBTab(i, x[0]); }).length; return { label: x[1], count: x[0] === 'all' || n ? String(n) : '', on: tab === x[0] ? 'true' : 'false', pick: function () { up({ tab: x[0] }); } }; });
    var rows = base.filter(function (i) { return inBTab(i, tab); });
    vals.rows = rows.map(function (i) {
      var t = tById(i[1]), due = i[2] === 'paid' || i[2] === 'void' ? 0 : i[5] - i[6];
      return { number: i[0] || 'Draft', isDraft: !i[0], store: t[1], chip: invChip(i), due: longDate(i[4]), total: money(i[5]), owed: due ? money(due) : '—', owedColor: i[2] === 'issued' && i[4] < TODAY ? 'var(--destructive)' : 'var(--foreground)',
        href: P('PlatformInvoice'), aria: 'Open ' + (i[0] ? 'invoice ' + i[0] : 'the draft invoice for ' + t[1]), period: i[7] };
    });
    vals.hasRows = rows.length > 0; vals.noRows = !vals.hasRows;
    vals.count = plural(rows.length, 'invoice', 'invoices');
    vals.q = s.q || ''; vals.onQ = function (e) { up({ q: e.target.value }); };
    vals.hasFilters = Boolean(q); vals.clearAll = function () { up({ q: '' }); };
    var st = s.store ? tById(s.store) : null;
    vals.forStore = Boolean(st); vals.allStores = !st;
    vals.forText = st ? 'Only ' + st[1] + '’s invoices.' : '';
    vals.showAll = function () { up({ store: null }); };
    vals.storeHref = P('PlatformStore');
    vals.noIssuer = Boolean(s.noIssuer); vals.canNew = Boolean(st) && !s.noIssuer;
    vals.openNew = function () { up({ panel: 'new' }); }; vals.openIssuer = function () { up({ panel: 'issuer' }); };
    // New invoice: one line.
    var nf = pform(s, up, 'nf', { kind: 'adjustment', en: '', bn: '', qty: '1', price: '', now: false });
    vals.nf = nf; vals.lineKinds = choice(nf, 'kind', [['setup', 'Setup fee'], ['plan', 'Plan'], ['overage', 'Use above the plan'], ['adjustment', 'Adjustment']]);
    var price = num(nf.cur.price), qty = num(nf.cur.qty);
    vals.enBad = Boolean(s.ntried) && !nf.cur.en.trim(); vals.priceBad = Boolean(s.ntried) && price === null;
    vals.nTotal = price === null || qty === null ? '—' : money(price * qty);
    vals.newTitle = 'New invoice · ' + (st ? st[1] : '');
    vals.createInv = function () {
      if (!nf.cur.en.trim() || price === null) { up({ ntried: true }); return; }
      var row = [nf.cur.now ? 'INV-2026-0048' : null, s.store, nf.cur.now ? 'issued' : 'draft', nf.cur.now ? TODAY : null, addDays(TODAY, 7), price * (qty || 1), 0, '—'];
      up({ panel: null, nf: null, ntried: false, added: [row].concat(s.added || []), toast: toast(nf.cur.now ? 'Invoice INV-2026-0048 issued. The owners were emailed.' : 'Invoice created.') });
    };
    // Our invoice details.
    var isf = pform(s, up, 'isf', s.noIssuer ? { legal: '', address: '', license: '', bin: '', vat: '', email: '', phone: '', bank: '', accName: '', accNo: '', branch: '', routing: '', bkash: '', nagad: '' } : ISSUER);
    vals.isf = isf;
    vals.saveIssuer = function () { up({ panel: null, isf: null, noIssuer: false, toast: toast('Invoice details saved.') }); };
    vals.pn = { nw: s.panel === 'new', issuer: s.panel === 'issuer' };
    vals.closeAll = function () { up({ panel: null, nf: null, isf: null, ntried: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); vals.closeAll(); } };
    vals.closePop = function () {};
    return vals;
  }
}
