var START = { 'Purchase order': {}, 'Shared on WhatsApp': { shared: true } };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Purchase order');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var po = POS.filter(function (p) { return p.id === 'po17'; })[0], sp = sById(po.sup), t = poTotals(po.lines, po.costs);
    vals.po = { title: 'Purchase order ' + po.ref, ref: po.ref, date: longDate(po.created), expected: longDate(po.expected), supRef: po.supRef, supplier: sp.name, supContact: [sp.contact, sp.phones[0]].join(' · '), supAddr: sp.address,
      lines: po.lines.map(function (l) { var v = vById(l[0]); return { name: label(v), sku: v.sku, qty: String(l[1]), cost: money(l[2]), total: money(l[1] * l[2]) }; }),
      costs: po.costs.map(function (c) { return { label: c[0], value: money(c[1]) }; }), goods: money(t.goods), total: money(t.total) };
    vals.share = function () { up({ toast: toast('Opening WhatsApp with the order for Rafiq Mia.') }); };
    vals.print = function () { up({ toast: toast('Opening the print dialog…') }); };
    return vals;
  }
}
