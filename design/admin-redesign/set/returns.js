var START = { Returns: {}, 'Requests off': { f: { requests: false } }, 'No refund method': { f: { methods: [] }, tried: true } };
var BASE = { requests: true, days: '7', shopperPays: ['wrong_size', 'changed_mind'], fee: true, methods: ['bkash', 'nagad', 'bank', 'store_credit'], excluded: ['Accessories'] };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Returns');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var f = form(s, up, toast, BASE); vals.f = f; vals.bar = f.bar; vals.discard = f.discard;
    vals.save = function () { f.save(function (c) { return c.methods.length > 0; }); };
    vals.reqOn = f.cur.requests;
    vals.reasons = many(f, 'shopperPays', [['wrong_size', 'Wrong size'], ['changed_mind', 'Changed mind'], ['damaged', 'Damaged'], ['wrong_item', 'Wrong item'], ['not_as_described', 'Not as described'], ['other', 'Other']]);
    vals.methods = many(f, 'methods', [['gateway', 'Back to the online payment (SSLCommerz)'], ['bkash', 'bKash'], ['nagad', 'Nagad'], ['rocket', 'Rocket'], ['bank', 'Bank transfer'], ['cash', 'Cash'], ['store_credit', 'Store credit (a code)']]);
    vals.cats = many(f, 'excluded', [['Panjabi', 'Panjabi'], ['Kurti', 'Kurti'], ['Saree', 'Saree'], ['Three-piece', 'Three-piece'], ['Footwear', 'Footwear'], ['Accessories', 'Accessories']]);
    vals.methodsBad = Boolean(s.tried) && f.cur.methods.length === 0;
    return vals;
  }
}
