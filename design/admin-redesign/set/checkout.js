var START = { Checkout: {}, 'Cash on delivery off': { f: { cod: false } }, 'Block a phone': { bp: '01987-121212', br: 'Refused two parcels' }, Edited: { f: { maxQty: '5', prefix: 'NF-' } } };
var BASE = { email: 'optional', maxQty: '10', prefix: '#', terms: true, accounts: false, cod: true, codMax: '15000', advance: 'flagged', otp: 'flagged', perHour: '3', perDay: '10', perIp: '20' };
var BLOCKED = [['01911-000111', 'Fake orders, three times', 'Oct 12'], ['01700-554433', 'Refused at the door twice', 'Sep 28']];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Checkout');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var f = form(s, up, toast, BASE); vals.f = f; vals.bar = f.bar; vals.discard = f.discard; vals.save = function () { f.save(); };
    vals.emails = choice(f, 'email', [['optional', 'Optional'], ['required', 'Required'], ['hidden', 'Not asked']]);
    vals.advances = choice(f, 'advance', [['never', 'Never'], ['always', 'Always'], ['flagged', 'Only for risky phones']]);
    vals.otps = choice(f, 'otp', [['off', 'Never'], ['always', 'Every cash-on-delivery order'], ['flagged', 'Only for risky phones'], ['first_order', 'A customer’s first order']]);
    vals.codOn = f.cur.cod; vals.codOff = !f.cur.cod;
    vals.prefixHint = 'Letters, digits, # and -. Orders show as ' + (f.cur.prefix || '') + '1059.';
    var bl = s.bl || BLOCKED;
    vals.blocked = bl.map(function (x) { return { phone: x[0], reason: x[1], when: x[2], unblock: function () { up({ bl: bl.filter(function (y) { return y !== x; }), toast: toast(x[0] + ' is unblocked.') }); } }; });
    vals.hasBlocked = bl.length > 0; vals.noBlocked = bl.length === 0;
    vals.bp = s.bp || ''; vals.onBp = function (e) { up({ bp: e.target.value }); }; vals.br = s.br || ''; vals.onBr = function (e) { up({ br: e.target.value }); };
    vals.block = function () { if (!(s.bp || '').trim()) return; up({ bl: [[s.bp.trim(), (s.br || '').trim() || '—', 'Today']].concat(bl), bp: '', br: '', toast: toast(s.bp.trim() + ' is blocked.') }); };
    return vals;
  }
}
