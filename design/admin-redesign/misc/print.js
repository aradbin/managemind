var START = { Invoices: {}, 'Packing slips': { doc: 'slip' }, 'Invoices in Bangla': { lang: 'bn' }, 'Packing slips in Bangla': { doc: 'slip', lang: 'bn' } };
var IDS = ['o53', 'o52', 'o48'];
var TX = {
  en: { invoice: 'Invoice', no: 'No.', billTo: 'Bill to', shipTo: 'Deliver to', item: 'Item', qty: 'Qty', unit: 'Price', amount: 'Amount', subtotal: 'Subtotal', delivery: 'Delivery', total: 'Total', codDue: 'To collect on delivery', thanks: 'Thank you for your order.', collect: 'Collect', nothing: 'Paid: nothing to collect', paid: 'Paid', date: 'Date', status: { paid: 'Paid', partially_paid: 'Partly paid', unpaid: 'Unpaid' }, note: 'Note' },
  bn: { invoice: 'ইনভয়েস', no: 'নং', billTo: 'ক্রেতা', shipTo: 'ডেলিভারি ঠিকানা', item: 'পণ্য', qty: 'পরিমাণ', unit: 'দাম', amount: 'মোট', subtotal: 'সাবটোটাল', delivery: 'ডেলিভারি', total: 'সর্বমোট', codDue: 'ডেলিভারিতে আদায়', thanks: 'অর্ডারের জন্য ধন্যবাদ।', collect: 'আদায় করুন', nothing: 'পরিশোধিত: কিছু আদায় করতে হবে না', paid: 'পরিশোধ', date: 'তারিখ', status: { paid: 'পরিশোধিত', partially_paid: 'আংশিক পরিশোধিত', unpaid: 'অপরিশোধিত' }, note: 'নোট' }
};
function bnDigits(x) { return String(x).replace(/[0-9]/g, function (d) { return '০১২৩৪৫৬৭৮৯'[d]; }); }
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Invoices');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var doc = s.doc || 'invoice', lang = s.lang || 'en', T = TX[lang];
    var M = function (v) { var m = money(v); return lang === 'bn' ? bnDigits(m) : m; };
    vals.isInvoice = doc === 'invoice'; vals.isSlip = doc === 'slip';
    vals.title = (doc === 'invoice' ? 'Invoices' : 'Packing slips') + ' · Orders: ' + IDS.length;
    vals.langs = [['bn', 'বাংলা'], ['en', 'English']].map(function (l) { var on = lang === l[0]; return { label: l[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ lang: l[0] }); } }; });
    vals.docs = [['invoice', 'Invoices'], ['slip', 'Packing slips']].map(function (l) { var on = doc === l[0]; return { label: l[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ doc: l[0] }); } }; });
    vals.print = function () { up({ toast: toast('Opening the print dialog…') }); };
    vals.T = T;
    vals.docsList = IDS.map(function (id) {
      var o = oById(id), t = totalsOf(o);
      var lines = o.lines.map(function (l) { var v = vById(l[0]); return { name: v.t + (v.o ? ' — ' + v.o : ''), sku: v.sku, qty: lang === 'bn' ? bnDigits(l[1]) : String(l[1]), unit: M(l[2]), amount: M(l[1] * l[2]) }; });
      var rows = [[T.subtotal, M(t.sub)]].concat(o.adj.map(function (a) { return [a[0], '−' + M(a[1])]; }), [[T.delivery + ' (' + zoneName(o.zone) + ')', M(o.fee)]]);
      return { n: '#' + (lang === 'bn' ? bnDigits(o.n) : o.n), date: lang === 'bn' ? bnDigits(short(o.placed.slice(0, 10))) : longDate(o.placed.slice(0, 10)), status: T.status[o.pay] || o.pay,
        name: o.name, phone: fmtPhone(o.phone), address: [o.line, o.area, o.district].filter(Boolean).join(', '), lines: lines,
        sums: rows.map(function (r) { return { label: r[0], value: r[1] }; }), total: M(t.total), paidLine: o.paid > 0 ? M(o.paid) : '', hasPaid: o.paid > 0, codDue: M(t.cod), hasCod: t.cod > 0, noCod: t.cod === 0,
        collect: t.cod > 0 ? T.collect + ' ' + M(t.cod) : T.nothing, note: o.note || (o.id === 'o53' ? 'Wants it before Friday. Gift wrap the caps.' : ''), hasNote: Boolean(o.note) || o.id === 'o53', count: plural(o.lines.reduce(function (a, l) { return a + l[1]; }, 0), 'item', 'items') };
    });
    return vals;
  }
}
