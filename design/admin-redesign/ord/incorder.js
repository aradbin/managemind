var START = { 'Incomplete order': { iid: 'i1' }, 'Price changed': { iid: 'i2' }, 'No name given': { iid: 'i3' }, 'Made into an order': { iid: 'i4' }, Dismissed: { iid: 'i6' }, Dismiss: { iid: 'i1', confirm: true }, 'More menu': { iid: 'i2', more: true } };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Incomplete order');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var i = s.inc || INCOMPLETE.filter(function (x) { return x.id === (s.iid || 'i1'); })[0];
    var save = function (patch, extra) { up(Object.assign({ inc: Object.assign({}, i, patch) }, extra || {})); };
    var open = i.status === 'open';
    vals.ic = {
      title: i.name ? 'Checkout from ' + i.name : 'Checkout from ' + fmtPhone(i.phone), chip: incChip(i.status), sub: 'Left at ' + stepLabel(i.step).toLowerCase() + ' · ' + when(i.at),
      name: i.name || 'No name given', nameColor: i.name ? 'var(--foreground)' : 'var(--muted-foreground)', phone: fmtPhone(i.phone), tel: 'tel:' + i.phone, wa: 'https://wa.me/88' + i.phone,
      address: [i.line, i.area, i.district].filter(Boolean).join(', ') || 'Not given yet', addrColor: i.line || i.area ? 'var(--foreground)' : 'var(--muted-foreground)',
      code: i.code, hasCode: Boolean(i.code), contacted: i.contacted, made: i.madeInto ? (i.status === 'finished' ? 'The shopper came back and placed #' + i.madeInto + '.' : 'Made into order #' + i.madeInto + '.') : '', hasMade: Boolean(i.madeInto),
      dismissed: i.status === 'dismissed'
    };
    vals.isOpen = open;
    var changed = false;
    vals.lines = i.lines.map(function (l) {
      var v = vById(l[0]), now = PRICE[l[0]], diff = now !== l[2]; if (diff) changed = true;
      return { title: v.t, opts: [v.o, v.sku].filter(Boolean).join(' · '), qty: l[1] + ' ×', then: money(l[2]), now: money(now), diff: diff, same: !diff, total: money(l[1] * now),
        stock: available(v) >= l[1] ? available(v) + ' available' : 'Only ' + available(v) + ' available', stockColor: available(v) >= l[1] ? 'var(--muted-foreground)' : 'var(--destructive)' };
    });
    vals.priceChanged = changed;
    vals.itemsTotal = money(incValue(i));
    vals.thenTotal = money(i.lines.reduce(function (a, l) { return a + l[1] * l[2]; }, 0));
    var at = STEPS.map(function (x) { return x[0]; }).indexOf(i.step);
    vals.steps = STEPS.map(function (x, k) { return { label: x[1], state: k < at ? 'done' : k === at ? 'now' : 'todo', mark: k < at ? '✓' : String(k + 1), note: k === at ? 'Left here' : k < at ? 'Done' : '' }; });
    vals.nd = s.nd === undefined ? i.note : s.nd;
    vals.onNd = function (e) { up({ nd: e.target.value }); };
    vals.noteSame = vals.nd === i.note;
    vals.saveNote = function () { save({ note: vals.nd }, { nd: undefined, toast: toast('Note saved.') }); };
    vals.contact = function () { save({ contacted: true }, { more: false, toast: toast('Marked as contacted.') }); };
    vals.notContacted = open && !i.contacted;
    vals.create = function () { save({ status: 'ordered', madeInto: 1059 }, { toast: toast('Order #1059 created. It’s waiting to be confirmed.') }); };
    vals.askDismiss = function () { up({ confirm: true, more: false }); };
    vals.confirmOpen = Boolean(s.confirm) && open;
    vals.doDismiss = function () { save({ status: 'dismissed' }, { confirm: false, toast: toast('Dismissed. It’s off the call list.') }); };
    vals.restore = function () { save({ status: 'open' }, { toast: toast('Back on the call list.') }); };
    vals.moreOpen = Boolean(s.more); vals.moreAria = s.more ? 'true' : 'false';
    vals.toggleMore = function () { up({ more: !s.more }); };
    vals.cancelConfirm = function () { up({ confirm: false }); };
    vals.closeAll = function () { up({ more: false, confirm: false }); };
    vals.closePop = function () { up({ more: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ more: false, confirm: false }); } };
    return vals;
  }
}
