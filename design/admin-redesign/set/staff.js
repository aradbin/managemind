var START = { Staff: {}, Invite: { panel: 'invite' }, 'Change role': { panel: 'role', who: 'u3' }, Remove: { dlg: 'u4' }, 'Row menu': { menu: 'u2' } };
var MEMBERS = [['u1', 'Rafiq Ahmed', 'rafiq@nakshifashion.com.bd', 'owner', '2025-01-15', true], ['u2', 'Shapla Akter', 'shapla.akter@gmail.com', 'manager', '2025-03-02', false], ['u3', 'Babul Mia', 'babul.mia@gmail.com', 'staff', '2025-08-20', false], ['u4', 'Tania Sultana', 'tania.s@outlook.com', 'viewer', '2026-09-11', false]];
var INVITES = [['i1', 'rakib.hasan@gmail.com', 'staff', '2026-11-03']];
var ROLES = [['owner', 'Owner', 'Everything, including billing and other owners.'], ['manager', 'Manager', 'Everything except billing and owners.'], ['staff', 'Staff', 'Day-to-day work: products, stock, orders and customers.'], ['viewer', 'Viewer', 'Can look, but can’t change anything or see customers.']];
function roleName(k) { return ROLES.filter(function (r) { return r[0] === k; })[0][1]; }
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Staff');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var mem = s.mem || MEMBERS, inv = s.inv || INVITES;
    vals.members = mem.map(function (m) {
      return { name: m[1], email: m[2], role: roleName(m[3]), joined: longDate(m[4]), you: m[5], notYou: !m[5], initials: m[1].split(' ').map(function (x) { return x[0]; }).join(''),
        menuOpen: s.menu === m[0], menuAria: 'Actions for ' + m[1], toggleMenu: function () { up({ menu: s.menu === m[0] ? null : m[0] }); },
        changeRole: function () { up({ menu: null, panel: 'role', who: m[0], pick: m[3] }); }, remove: function () { up({ menu: null, dlg: m[0] }); } };
    });
    vals.invites = inv.map(function (i) { return { email: i[1], role: roleName(i[2]), expires: longDate(i[3]), resend: function () { up({ toast: toast('A new link is on its way.') }); }, revoke: function () { up({ inv: inv.filter(function (x) { return x !== i; }), toast: toast('Invitation cancelled.') }); } }; });
    vals.hasInvites = inv.length > 0; vals.noInvites = inv.length === 0;
    var ie = s.ie === undefined ? '' : s.ie, ir = s.ir || 'staff', ibad = Boolean(s.itried) && !/^\S+@\S+\.\S+$/.test(ie);
    vals.iv = { open: s.panel === 'invite', email: ie, onEmail: function (e) { up({ ie: e.target.value }); }, bad: ibad, aria: ibad ? 'true' : 'false',
      roles: ROLES.map(function (r) { var on = ir === r[0]; return { label: r[1], sub: r[2], hasSub: true, on: on, aria: on ? 'true' : 'false', pick: function () { up({ ir: r[0] }); } }; }),
      save: function () { if (!/^\S+@\S+\.\S+$/.test(ie)) { up({ itried: true }); return; } up({ panel: null, ie: '', itried: false, inv: inv.concat([['i' + inv.length + 9, ie, ir, '2026-11-05']]), toast: toast('Invitation sent to ' + ie + '.') }); } };
    var who = mem.filter(function (m) { return m[0] === s.who; })[0], pick = s.pick || (who ? who[3] : 'staff');
    vals.rl = { open: s.panel === 'role' && Boolean(who), title: who ? 'Change ' + who[1].split(' ')[0] + '’s role' : '',
      roles: ROLES.map(function (r) { var on = pick === r[0]; return { label: r[1], sub: r[2], hasSub: true, on: on, aria: on ? 'true' : 'false', pick: function () { up({ pick: r[0] }); } }; }),
      save: function () { up({ panel: null, mem: mem.map(function (m) { return m === who ? [m[0], m[1], m[2], pick, m[4], m[5]] : m; }), toast: toast('Role changed.') }); } };
    var rm = mem.filter(function (m) { return m[0] === s.dlg; })[0];
    vals.rmv = { open: Boolean(rm), title: rm ? 'Remove ' + rm[1] + '?' : '', body: rm ? rm[1] + ' will lose access to Nakshi Fashion at once.' : '', confirm: function () { up({ dlg: null, mem: mem.filter(function (m) { return m !== rm; }), toast: toast(rm[1] + ' was removed.') }); } };
    vals.openInvite = function () { up({ panel: 'invite', ie: '', itried: false }); };
    vals.leave = function () { up({ toast: toast('A store needs at least one owner. Make someone else an owner first.') }); };
    return vals;
  }
}
