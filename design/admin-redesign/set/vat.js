var START = { VAT: {}, 'VAT off': { saved: { on: false } }, 'Add a rate': { f: { rates: [['reduced', 'Reduced rate', '7.5', false], ['books', 'Books', '0', true], ['', '', '', false]] } } };
var BASE = { on: true, rate: '15', incl: 'incl', rates: [['reduced', 'Reduced rate', '7.5', false], ['books', 'Books', '0', true]] };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'VAT');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var f = form(s, up, toast, BASE); vals.f = f; vals.bar = f.bar; vals.discard = f.discard; vals.save = function () { f.save(); };
    vals.vatOn = f.cur.on;
    vals.prices = choice(f, 'incl', [['incl', 'Include VAT', 'The price on the product is what the customer pays.'], ['excl', 'Add VAT on top', 'VAT is added at checkout.']]);
    var r = num(f.cur.rate) || 0, price = 1150;
    var net = f.cur.incl === 'incl' ? Math.round(price / (1 + r / 100)) : price, vat = f.cur.incl === 'incl' ? price - net : Math.round(price * r / 100);
    vals.example = 'For a price of ' + money(price) + ': ' + money(net) + ' before VAT, ' + money(vat) + ' VAT, ' + money(net + vat) + ' in all.';
    var rates = f.cur.rates;
    var setR = function (i, j, v) { f.set('rates', rates.map(function (x, k) { if (k !== i) return x; var n = x.slice(); n[j] = v; return n; })); };
    vals.rates = rates.map(function (x, i) { return { key: x[0], name: x[1], rate: x[2], exempt: x[3], notExempt: !x[3], ex: checkOf(x[3], function () { setR(i, 3, !x[3]); }), n: String(i + 1),
      onKey: function (e) { setR(i, 0, e.target.value); }, onName: function (e) { setR(i, 1, e.target.value); }, onRate: function (e) { setR(i, 2, e.target.value); },
      removeAria: 'Remove rate ' + (i + 1), remove: function () { f.set('rates', rates.filter(function (y, k) { return k !== i; })); } }; });
    vals.addRate = function () { f.set('rates', rates.concat([['', '', '', false]])); };
    return vals;
  }
}
