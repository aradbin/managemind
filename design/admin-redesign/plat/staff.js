var START = { 'Platform staff': {}, 'Change role': { dlg: 3 }, 'Row menu': { menu: 2 } };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Platform staff');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    vals.readOnly = false;
    var roles = s.roles || STAFF.map(function (x) { return x[2]; });
    var roleLabel = function (r) { return (P_ROLES.filter(function (x) { return x[0] === r; })[0] || P_ROLES[2])[1]; };
    vals.rows = STAFF.map(function (x, i) {
      var r = roles[i], tn = r === 'super_admin' ? 'move' : r === 'support' ? 'info' : 'ended';
      return { name: x[0], tile: initials(x[0]), you: Boolean(x[4]), email: x[1], role: tone(roleLabel(r), tn), fa: x[3] ? tone('On', 'good') : tone('Off', 'warn'), faText: x[3] ? 'On' : 'Off — they can’t open the platform area',
        noFa: !x[3], notYou: !x[4], menuOpen: s.menu === i, menuAria: 'Actions for ' + x[0], toggleMenu: function () { up({ menu: s.menu === i ? null : i }); }, change: function () { up({ menu: null, dlg: i, pick: r }); } };
    });
    var d = typeof s.dlg === 'number' ? STAFF[s.dlg] : null;
    var pick = s.pick !== undefined ? s.pick : (d ? roles[s.dlg] : null);
    vals.dl = { open: Boolean(d), title: d ? 'Change ' + d[0] + '’s platform role' : '',
      roles: P_ROLES.map(function (x) { var on = pick === x[0]; return { label: x[1], sub: x[2], hasSub: true, on: on, aria: on ? 'true' : 'false', pick: function () { up({ pick: x[0] }); } }; }),
      save: function () { var n = roles.slice(); n[s.dlg] = pick; up({ dlg: null, pick: undefined, roles: n, toast: toast('Role changed. They were signed out.') }); } };
    vals.closePop = function () { up({ menu: null }); };
    vals.closeAll = function () { up({ menu: null, dlg: null, pick: undefined }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); vals.closeAll(); } };
    return vals;
  }
}
