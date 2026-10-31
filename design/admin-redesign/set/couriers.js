var START = { Couriers: {}, 'Connect RedX': { panel: 'redx' }, 'Show the secret': { secret: true }, 'Disconnect': { dlg: 'pathao' } };
var CS = [
  { id: 'steadfast', name: 'Steadfast', status: 'live', hint: '7c1e', checked: '2026-10-29 08:00', fields: [['apiKey', 'API key'], ['secretKey', 'Secret key']] },
  { id: 'pathao', name: 'Pathao', status: 'sandbox', hint: '09ab', checked: '2026-10-29 08:00', fields: [['clientId', 'Client ID'], ['clientSecret', 'Client secret'], ['username', 'Merchant panel email'], ['password', 'Merchant panel password']] },
  { id: 'redx', name: 'RedX', status: 'none', hint: '', checked: '', fields: [['token', 'API token']] }
];
var DEF = { first: 'steadfast', grams: '500', note: 'Handle with care. Call before delivery.', autoBook: false };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Couriers');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var cs = s.cs || CS;
    vals.couriers = cs.map(function (c) {
      var conn = c.status !== 'none';
      var t = conn ? TONE[c.status === 'live' ? 'good' : 'info'] : ['var(--muted)', 'var(--muted-foreground)'];
      return { name: c.name, conn: conn, notConn: !conn, chip: { label: c.status === 'live' ? 'Connected' : c.status === 'sandbox' ? 'Connected, sandbox' : 'Not connected', bg: t[0], fg: t[1], edge: 'transparent' },
        meta: conn ? 'Key ends in ' + c.hint + ' · checked ' + when(c.checked) : 'Book its parcels by hand until you connect it.',
        connect: function () { up({ panel: c.id, kf: null }); }, change: function () { up({ panel: c.id, kf: null }); }, remove: function () { up({ dlg: c.id }); },
        hook: conn, url: 'https://hooks.managemind.app/couriers/' + c.id + '/nakshi', secret: s.secret && c.id === 'steadfast' ? 'whsec_9K2mQ7xP4tLb8Vn1' : '••••••••••••••••', showAria: 'Show the secret for ' + c.name,
        show: function () { up({ secret: !s.secret }); }, copy: function () { up({ toast: toast('Copied.') }); }, rotate: function () { up({ toast: toast('New secret made. Paste it into the panel.') }); } };
    });
    var pc = cs.filter(function (c) { return c.id === s.panel; })[0];
    var kf = s.kf || { mode: 'live' };
    vals.kp = { open: Boolean(pc), title: pc ? 'Connect ' + pc.name : '', isPathao: Boolean(pc && pc.id === 'pathao'),
      fields: pc ? pc.fields.map(function (f) { return { label: f[1], id: 'mm-kf-' + f[0], value: kf[f[0]] || '', secret: /secret|password|token/i.test(f[0]) ? 'password' : 'text', on: function (e) { var n = Object.assign({}, kf); n[f[0]] = e.target.value; up({ kf: n }); } }; }) : [],
      modes: [['sandbox', 'Sandbox (test parcels)'], ['live', 'Live']].map(function (m) { var on = kf.mode === m[0]; return { label: m[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ kf: Object.assign({}, kf, { mode: m[0] }) }); } }; }),
      save: function () { up({ panel: null, cs: cs.map(function (c) { return c === pc ? Object.assign({}, c, { status: kf.mode, hint: 'f31d', checked: TODAY + ' 12:00' }) : c; }), toast: toast(pc.name + ' connected.') }); } };
    var f = form(s, up, toast, DEF); vals.f = f; vals.bar = f.bar; vals.discard = f.discard; vals.save = function () { f.save(); };
    vals.firsts = choice(f, 'first', [['first', 'The first connected']].concat(cs.filter(function (c) { return c.status !== 'none'; }).map(function (c) { return [c.id, c.name]; })));
    var dc = cs.filter(function (c) { return c.id === s.dlg; })[0];
    vals.dc = { open: Boolean(dc), title: dc ? 'Disconnect ' + dc.name + '?' : '', body: dc ? 'Parcels already booked keep their tracking, but no updates arrive from ' + dc.name + ' until you connect it again.' : '',
      confirm: function () { up({ dlg: null, cs: cs.map(function (c) { return c === dc ? Object.assign({}, c, { status: 'none' }) : c; }), toast: toast(dc.name + ' is disconnected.') }); } };
    return vals;
  }
}
