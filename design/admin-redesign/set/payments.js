var START = { Payments: {}, 'Not connected': { conn: false }, 'Connect': { conn: false, panel: 'ssl' }, Checking: { conn: false, panel: 'ssl', checking: true }, Refused: { conn: false, panel: 'ssl', refused: true }, Disconnect: { dlg: true } };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Payments');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var conn = s.conn !== false;
    vals.conn = conn; vals.notConn = !conn;
    vals.pp = { open: s.panel === 'ssl', title: conn ? 'Change SSLCommerz account' : 'Connect SSLCommerz' };
    vals.status = 'Connected: taking real payments'; vals.meta = 'Store ID ending 4f2a · checked ' + when('2026-10-29 08:00');
    var p = s.p || { id: '', pw: '', mode: 'live' };
    var setP = function (k, v) { var n = Object.assign({}, p); n[k] = v; up({ p: n, refused: false }); };
    vals.p = { id: p.id, onId: function (e) { setP('id', e.target.value); }, pw: p.pw, onPw: function (e) { setP('pw', e.target.value); },
      modes: [['sandbox', 'Sandbox (testing)'], ['live', 'Live']].map(function (m) { var on = p.mode === m[0]; return { label: m[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { setP('mode', m[0]); } }; }),
      checking: Boolean(s.checking), notChecking: !s.checking, refused: Boolean(s.refused), refusedText: 'The provider refused: Invalid Store ID or password.',
      save: function () { up({ checking: false, panel: null, conn: true, p: null, toast: toast('Connected. Customers can now pay online.') }); } };
    vals.change = function () { up({ panel: 'ssl', p: null, refused: false }); };
    vals.connect = function () { up({ panel: 'ssl', p: null, refused: false }); };
    vals.askRemove = function () { up({ dlg: true }); };
    vals.dl = { open: Boolean(s.dlg), confirm: function () { up({ dlg: false, conn: false, toast: toast('SSLCommerz is disconnected.') }); } };
    return vals;
  }
}
