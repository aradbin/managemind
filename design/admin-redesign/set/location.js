var START = { 'Stock location': {}, Edited: { f: { name: 'Mirpur shop and stockroom' } } };
var BASE = { name: 'Mirpur shop', line1: 'House 18, Road 7, Block C', line2: 'Mirpur 10', city: 'Dhaka' };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Stock location');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var f = form(s, up, toast, BASE); vals.f = f; vals.bar = f.bar; vals.discard = f.discard; vals.save = function () { f.save(); };
    return vals;
  }
}
