var START = { 'Store profile': {}, Edited: { f: { name: 'Nakshi Fashion House', city: 'Dhaka' } }, 'Missing name': { f: { name: '' }, tried: true }, 'Read only': { viewer: true } };
var BASE = { name: 'Nakshi Fashion', lang: 'bn', email: 'hello@nakshifashion.com.bd', phone: '01712-345678', line1: 'House 18, Road 7, Block C', line2: 'Mirpur 10', city: 'Dhaka',
  bizName: 'Nakshi Fashion House', licence: 'TRAD/DNCC/045218/2024', dbid: '', bin: '' };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Store profile');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var f = form(s, up, toast, BASE);
    vals.f = f;
    vals.langs = choice(f, 'lang', [['bn', 'বাংলা (Bangla)'], ['en', 'English']]);
    vals.nameBad = Boolean(s.tried) && !f.cur.name.trim(); vals.nameAria = vals.nameBad ? 'true' : 'false';
    vals.bar = f.bar; vals.discard = f.discard;
    vals.save = function () { f.save(function (c) { return c.name.trim(); }); };
    return vals;
  }
}
