var START = { Terms: {}, 'Publish version': { panel: 'pub' }, 'Unsaved support details': { f: { whatsapp: '8801712345679' } }, 'Nothing published yet': { none: true } };
var VERSIONS = [['2026-09', '2026-10-01', 11, 12], ['2026-03', '2026-04-01', 12, 12], ['2025-10', '2025-11-01', 9, 9]];
var BASE = { email: 'support@managemind.app', whatsapp: '8801755000555', abuse: 'abuse@managemind.app', help: 'https://help.managemind.app', privacy: 'https://managemind.app/privacy', dpa: 'https://managemind.app/dpa' };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Terms');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    vals.readOnly = false;
    var vs = s.none ? [] : (s.pubd || []).concat(VERSIONS);
    vals.versions = vs.map(function (v, i) { return { version: v[0], eff: longDate(v[1]), acc: v[2] + ' of ' + v[3], current: i === 0, accColor: v[2] < v[3] ? 'var(--warn)' : 'var(--foreground)' }; });
    vals.hasVersions = vs.length > 0; vals.noVersions = !vals.hasVersions;
    var pf = pform(s, up, 'pb', { version: '2026-11', eff: '2026-12-01', url: 'https://managemind.app/terms/2026-11', sha: '' });
    vals.pb = pf; vals.urlBad = Boolean(s.ptried) && pf.cur.url.indexOf('https://managemind.app/') !== 0;
    vals.publish = function () {
      if (pf.cur.url.indexOf('https://managemind.app/') !== 0) { up({ ptried: true }); return; }
      up({ panel: null, pb: null, ptried: false, none: false, pubd: [[pf.cur.version, pf.cur.eff, 0, 12]].concat(s.pubd || []), toast: toast('Version ' + pf.cur.version + ' is published. Owners see it now.') });
    };
    vals.openPub = function () { up({ panel: 'pub' }); };
    vals.pn = { pub: s.panel === 'pub' };
    var f = form(s, up, toast, BASE, 'Support details saved.');
    vals.f = f; vals.bar = f.bar; vals.discard = f.discard; vals.save = function () { f.save(); };
    vals.closeAll = function () { up({ panel: null, pb: null, ptried: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); vals.closeAll(); } };
    vals.closePop = function () {};
    return vals;
  }
}
