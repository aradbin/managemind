var START = { Domains: {}, 'Connect a domain': { panel: 'add', host: 'nakshi.shop' }, 'Disconnect': { dlg: 'd2' }, 'Checked now': { checked: true } };
var DOMS = [
  { id: 'd1', host: 'www.nakshifashion.com.bd', status: 'active', primary: true, checked: '2026-10-29 09:00' },
  { id: 'd2', host: 'www.nakshi.shop', status: 'pending', primary: false, checked: '2026-10-29 11:40' }
];
var ST_D = { active: ['Connected', 'good'], pending: ['Waiting for DNS', 'warn'], failed: ['Not connected', 'bad'] };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Domains');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var doms = s.doms || DOMS;
    vals.domains = doms.map(function (d) {
      var t = TONE[ST_D[d.status][1]];
      return { host: d.host, chip: { label: ST_D[d.status][0], bg: t[0], fg: t[1], edge: 'transparent' }, primary: d.primary, notPrimary: !d.primary && d.status === 'active', pending: d.status === 'pending',
        checked: 'Last checked ' + (s.checked && d.status === 'pending' ? 'just now' : when(d.checked)), menuOpen: s.menu === d.id, menuAria: 'Actions for ' + d.host, toggleMenu: function () { up({ menu: s.menu === d.id ? null : d.id }); },
        check: function () { up({ checked: true, menu: null, toast: toast('Checked: still waiting for DNS.') }); },
        makePrimary: function () { up({ menu: null, doms: doms.map(function (x) { return Object.assign({}, x, { primary: x.id === d.id }); }), toast: toast(d.host + ' is now your primary address.') }); },
        remove: function () { up({ menu: null, dlg: d.id }); },
        copy: function () { up({ toast: toast('Copied.') }); } };
    });
    vals.atLimit = doms.length >= 2; vals.canAdd = doms.length < 2;
    var host = (s.host === undefined ? '' : s.host).trim().toLowerCase();
    var bare = host && host.split('.').length === 2;
    vals.add = { open: s.panel === 'add', host: s.host || '', onHost: function (e) { up({ host: e.target.value }); }, bare: Boolean(bare), bareText: 'Use www.' + host + ' instead. At your domain registrar, forward ' + host + ' to www.' + host + '.', aria: bare ? 'true' : 'false',
      save: function () { if (!host || bare) return; up({ panel: null, host: '', doms: doms.concat([{ id: 'd9', host: host, status: 'pending', primary: false, checked: TODAY + ' 12:00' }]), toast: toast(host + ' added. Add the DNS record to connect it.') }); } };
    vals.openAdd = function () { up({ panel: 'add', host: '' }); };
    var del = doms.filter(function (d) { return d.id === s.dlg; })[0];
    vals.dl = { open: Boolean(del), title: del ? 'Disconnect ' + del.host + '?' : '', confirm: function () { up({ dlg: null, doms: doms.filter(function (d) { return d !== del; }), toast: toast(del.host + ' is disconnected.') }); } };
    return vals;
  }
}
