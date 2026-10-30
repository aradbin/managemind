var START = {
  Supplier: { sid: 's1' }, 'With an advance': { sid: 's2' }, 'Record payment': { sid: 's1', pay: true }, 'Paying more than owed': { sid: 's1', pay: true, pd: { date: TODAY, amount: '50000', method: 'bank', ref: '' } },
  'Edit supplier': { sid: 's1', form: 's1' }, 'Delete payment': { sid: 's1', confirm: 'l7' }, 'More menu': { sid: 's1', more: true }, Archived: { sid: 's5' }
};
var LEDGERS = {
  s1: [['l1', 'opening', '2025-03-10', '', 20000], ['l2', 'receipt', '2026-06-14', 'GRN-0012', 36000], ['l3', 'payment', '2026-06-20', 'bKash 9F3K2L7Q', -25000], ['l4', 'receipt', '2026-08-28', 'GRN-0021', 27500], ['l5', 'payment', '2026-09-05', 'Cheque 004521', -20000], ['l6', 'receipt', '2026-10-06', 'GRN-0026', 18000], ['l7', 'payment', '2026-10-15', 'Cash', -8000]],
  s2: [['l1', 'receipt', '2026-08-02', 'GRN-0019', 30000], ['l2', 'payment', '2026-08-03', 'Bank transfer', -35000]],
  s3: [['l1', 'receipt', '2026-09-28', 'GRN-0024', 15500], ['l2', 'payment', '2026-10-01', 'bKash 7Q2M1X0D', -18260], ['l3', 'receipt', '2026-10-18', 'GRN-0029', 21410], ['l4', 'receipt', '2026-10-22', 'GRN-0031', 7350]],
  s4: [['l1', 'receipt', '2026-10-09', 'GRN-0027', 22800], ['l2', 'payment', '2026-10-10', 'Nagad', -10000]],
  s5: [['l1', 'receipt', '2025-04-02', 'GRN-0003', 9000], ['l2', 'payment', '2025-04-10', 'Cash', -9000]]
};
function entryText(e) { return e[1] === 'opening' ? 'Opening balance' : e[1] === 'receipt' ? 'Goods received ' + e[3] : 'Payment · ' + e[3]; }

class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Supplier');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var sups = s.sups || SUPPLIERS;
    var sp = sups.filter(function (x) { return x.id === (s.sid || 's1'); })[0];
    var ledger = s.ledger || LEDGERS[sp.id] || [];
    var balance = ledger.reduce(function (a, e) { return a + e[4]; }, 0);
    var bal = balanceOf(balance);
    vals.sp = {
      name: sp.name, archived: sp.archived, notArchived: !sp.archived,
      sub: [sp.contact].concat(sp.phones).filter(Boolean).join(' · '), tel: sp.phones[0] ? 'tel:' + sp.phones[0].replace(/-/g, '') : '#',
      balance: bal.text, owed: bal.owed
    };
    vals.archBadge = { label: 'Archived', bg: 'transparent', fg: 'var(--muted-foreground)', edge: 'var(--border)' };
    var year = ledger.filter(function (e) { return e[2] >= '2026-01-01'; });
    var mine = POS.filter(function (p) { return p.sup === sp.id; });
    vals.stats = [
      { label: 'Balance', value: bal.text },
      { label: 'Received this year', value: money(year.filter(function (e) { return e[1] === 'receipt'; }).reduce(function (a, e) { return a + e[4]; }, 0)) },
      { label: 'Paid this year', value: money(-year.filter(function (e) { return e[1] === 'payment'; }).reduce(function (a, e) { return a + e[4]; }, 0)) },
      { label: 'Orders to receive', value: String(mine.filter(function (p) { return p.status === 'ordered' || p.status === 'partially_received'; }).length) }
    ];
    vals.pstats = vals.stats.slice(1, 3);
    // The ledger: newest first, each with the balance after it.
    var run = 0;
    var rows = ledger.map(function (e) { run += e[4]; return { e: e, after: run }; }).reverse();
    vals.ledger = rows.map(function (r) {
      var e = r.e, menuOpen = s.menu === e[0];
      return {
        date: short(e[2]) + (e[2].slice(0, 4) !== '2026' ? ', ' + e[2].slice(0, 4) : ''), text: entryText(e), isPay: e[1] === 'payment',
        amount: e[4] < 0 ? '−' + money(-e[4]) : money(e[4]), amtColor: e[4] < 0 ? 'var(--success)' : 'var(--foreground)',
        after: money(r.after), menuOpen: menuOpen, menuAria: 'Actions for ' + entryText(e), toggleMenu: function () { up({ menu: menuOpen ? null : e[0] }); },
        askDelete: function () { up({ menu: null, confirm: e[0] }); }
      };
    });
    vals.hasLedger = ledger.length > 0;
    vals.noLedger = ledger.length === 0;
    vals.orders = mine.map(function (p) {
      var pr = poProgress(p);
      return { ref: p.ref, badge: badgeOf(PO_STATUS, p.status), progress: p.status === 'draft' ? 'Created ' + short(p.created) : pr.text, total: money(poTotals(p.lines, p.costs).total) };
    });
    vals.hasOrders = mine.length > 0; vals.noOrders = mine.length === 0;
    vals.details = [['Email', sp.email], ['Address', sp.address], ['Note', sp.note], ['Supplier since', longDate(sp.since)]].filter(function (x) { return x[1]; }).map(function (x) { return { label: x[0], value: x[1] }; });

    // Record a payment.
    var pd = s.pd || { date: TODAY, amount: '', method: 'cash', ref: '' };
    var setP = function (k, v) { var n = Object.assign({}, pd); n[k] = v; up({ pd: n }); };
    var amt = num(pd.amount);
    var amtBad = Boolean(s.ptried) && !(amt > 0);
    vals.pf = {
      open: Boolean(s.pay), sub: sp.name + ' · ' + bal.text,
      date: pd.date, onDate: function (e) { setP('date', e.target.value); }, todayOn: pd.date === TODAY ? 'true' : 'false', pickToday: function () { setP('date', TODAY); },
      amount: pd.amount, onAmount: function (e) { setP('amount', e.target.value); }, amtBad: amtBad, amtAria: amtBad ? 'true' : 'false',
      canAll: balance > 0, allText: 'All ' + money(balance), payAll: function () { setP('amount', String(balance)); },
      over: amt > 0 && balance >= 0 && amt > balance, overText: amt > balance ? 'That’s ' + money(amt - balance) + ' more than you owe: it becomes an advance.' : '',
      methods: METHODS.map(function (m) { return { label: m[1], on: pd.method === m[0] ? 'true' : 'false', pick: function () { setP('method', m[0]); } }; }),
      ref: pd.ref, onRef: function (e) { setP('ref', e.target.value); },
      save: function () {
        if (!(amt > 0)) { up({ ptried: true }); return; }
        var e = ['n' + ledger.length, 'payment', pd.date, [methodLabel(pd.method), pd.ref.trim()].filter(Boolean).join(' '), -amt];
        up({ ledger: ledger.concat([e]), pay: false, pd: null, ptried: false, toast: toast('Payment recorded.') });
      }
    };
    vals.openPay = function () { up({ pay: true, pd: null, ptried: false, more: false }); };
    vals.closePay = function () { up({ pay: false, pd: null, ptried: false }); };

    // Edit, archive.
    vals.sf = supplierForm(s, up, sups, function (data, editing) {
      up({ sups: sups.map(function (x) { return x.id === editing.id ? Object.assign({}, x, data) : x; }), form: null, f: null, tried: false, toast: toast('Supplier saved.') });
    }, function (x) { up({ sups: sups.map(function (y) { return y.id === x.id ? Object.assign({}, y, { archived: true }) : y; }), form: null, f: null, toast: toast(x.name + ' is archived. Their orders and ledger stay.') }); });
    vals.edit = function () { up({ form: sp.id, f: null, tried: false, more: false }); };
    vals.closeForm = function () { up({ form: null, f: null, tried: false }); };
    vals.toggleArchive = function () { up({ more: false, sups: sups.map(function (y) { return y.id === sp.id ? Object.assign({}, y, { archived: !sp.archived }) : y; }), toast: toast(sp.archived ? sp.name + ' is back in the list.' : sp.name + ' is archived. Their orders and ledger stay.') }); };
    vals.moreOpen = Boolean(s.more); vals.moreAria = s.more ? 'true' : 'false';
    vals.toggleMore = function () { up({ more: !s.more }); };
    var del = s.confirm ? ledger.filter(function (e) { return e[0] === s.confirm; })[0] : null;
    vals.confirmOpen = Boolean(del);
    vals.confirmBody = del ? 'The supplier’s balance goes back up by ' + money(-del[4]) + '.' : '';
    vals.doDelete = function () { up({ ledger: ledger.filter(function (e) { return e[0] !== del[0]; }), confirm: null, toast: toast('Payment deleted.') }); };
    vals.cancelConfirm = function () { up({ confirm: null }); };
    var reset = { more: false, menu: null, pay: false, form: null, confirm: null };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ more: false, menu: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    return vals;
  }
}
