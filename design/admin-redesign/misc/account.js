var START = { Account: {}, 'Set up two-factor': { tf: 'setup' }, 'Backup codes': { tf: 'on', codes: true }, 'Two-factor on': { tf: 'on' }, Edited: { f: { name: 'Rafiq Ahmed Chowdhury' } } };
var BASE = { name: 'Rafiq Ahmed', lang: 'en' };
var SESS = [['s1', 'Chrome on Windows', 'Dhaka', '2026-10-29 08:00', true], ['s2', 'Safari on iPhone', 'Dhaka', '2026-10-27 21:15', false], ['s3', 'Unknown device', 'Chattogram', '2026-10-12 10:40', false]];
var CODES = ['4F7K-2M9Q', 'X8PL-3TZA', 'J2WD-6RNC', 'Q7HB-5VYE', 'M3KS-8GUF', 'C9TR-1XPD', 'L6NA-4WQJ', 'V5EY-7BKM'];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Account');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var f = form(s, up, toast, BASE); vals.f = f; vals.bar = f.bar; vals.discard = f.discard; vals.save = function () { f.save(); };
    vals.langs = choice(f, 'lang', [['bn', 'বাংলা'], ['en', 'English']]);
    var tf = s.tf || 'off';
    vals.tfOff = tf === 'off'; vals.tfSetup = tf === 'setup'; vals.tfOn = tf === 'on';
    vals.setUp = function () { up({ tf: 'setup', tcode: '' }); };
    vals.tcode = s.tcode || ''; vals.onTcode = function (e) { up({ tcode: e.target.value, terr: false }); };
    vals.terr = Boolean(s.terr); vals.taria = s.terr ? 'true' : 'false';
    vals.enable = function () { if ((s.tcode || '').replace(/\s/g, '').length !== 6) { up({ terr: true }); return; } up({ tf: 'on', codes: true, toast: toast('Two-factor login is on. Your other devices were signed out.') }); };
    vals.cancelSetup = function () { up({ tf: 'off' }); };
    vals.key = 'JBSW Y3DP EHPK 3PXP';
    vals.disable = function () { up({ dlg: 'off' }); };
    vals.newCodes = function () { up({ codes: true }); };
    vals.codesOpen = Boolean(s.codes); vals.codes = CODES.map(function (c) { return { code: c }; });
    vals.copyCodes = function () { up({ toast: toast('Copied.') }); }; vals.doneCodes = function () { up({ codes: false }); };
    vals.qr = Array.apply(null, Array(121)).map(function (_, i) { var x = i % 11, y = Math.floor(i / 11); var corner = (x < 3 && y < 3) || (x > 7 && y < 3) || (x < 3 && y > 7); var on = corner ? !(x % 10 === 1 && y % 10 === 1) && !((x === 1 || x === 9) && y === 1) : ((x * 7 + y * 13 + x * y) % 3 === 0); return { bg: on ? '#111' : '#fff' }; });
    var sess = s.sess || SESS;
    vals.sessions = sess.map(function (x) { return { device: x[1], where: x[2] + ' · Signed in ' + when(x[3]), current: x[4], other: !x[4], out: function () { up({ sess: sess.filter(function (y) { return y !== x; }), toast: toast('Signed out of ' + x[1] + '.') }); } }; });
    vals.hasOthers = sess.length > 1;
    vals.outOthers = function () { up({ sess: sess.filter(function (x) { return x[4]; }), toast: toast('Signed out everywhere else.') }); };
    vals.dl = { open: s.dlg === 'off', confirm: function () { up({ dlg: null, tf: 'off', toast: toast('Two-factor login is off.') }); } };
    vals.closeAll = function () { up({ dlg: null, codes: false }); };
    return vals;
  }
}
