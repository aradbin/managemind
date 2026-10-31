var START = {
  'To call': {}, Later: { tab: 'later' }, Unreachable: { tab: 'unreachable' }, 'Risky first': { risky: true },
  'Call panel': { call: 'o58' }, 'Call back later': { call: 'o57', out: 'later', when: 'evening' },
  'Cancelled on the call': { call: 'o57', out: 'cancelled', code: 'fake', block: true }, 'All done': { done: ['o58', 'o57', 'o56'] }
};
var OUTCOMES = [['confirmed', 'Confirmed', 'They want it. It moves to To ship.'], ['no_answer', 'No answer', 'Try again later. After 3 tries it goes to Unreachable.'], ['later', 'Call back later', 'They asked you to call at another time.'], ['wrong', 'Wrong number', 'The order is cancelled.'], ['cancelled', 'Cancelled', 'They don’t want it any more.']];
var WHENS = [['hour', 'In an hour', '2026-10-29 13:00'], ['three', 'In 3 hours', '2026-10-29 15:00'], ['evening', 'This evening at 8', '2026-10-29 20:00'], ['tomorrow', 'Tomorrow at 10', '2026-10-30 10:00']];
var NOW = '2026-10-29 12:00';
var LOCKS = { o54: 'Shapla Akter' };
function bucket(o) {
  var c = o.conf || {};
  if (o.flags.indexOf('unreachable') !== -1 || c.attempts >= 3) return 'unreachable';
  if (c.dueAt && c.dueAt > NOW) return 'later';
  return 'call';
}
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'To call');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var orders = s.orders || ORDERS;
    var done = s.done || [];
    var queue = orders.filter(function (o) { return o.status === 'pending' && o.conf && o.conf.inQueue && done.indexOf(o.id) === -1; });
    var tab = s.tab || 'call';
    vals.tabs = [['call', 'To call'], ['later', 'Later'], ['unreachable', 'Unreachable']].map(function (t) {
      var n = queue.filter(function (o) { return bucket(o) === t[0]; }).length;
      return { label: t[1], count: n ? String(n) : '', on: tab === t[0] ? 'true' : 'false', pick: function () { up({ tab: t[0] }); } };
    });
    var list = queue.filter(function (o) { return bucket(o) === tab; });
    if (s.risky) list = list.slice().sort(function (a, c) { return (a.score === null ? 101 : a.score) - (c.score === null ? 101 : c.score); });
    vals.risky = checkOf(Boolean(s.risky), function () { up({ risky: !s.risky }); });
    var waiting = queue.filter(function (o) { return bucket(o) === 'call'; });
    vals.summary = plural(waiting.length, 'order', 'orders') + ' to call · ' + money(waiting.reduce(function (a, o) { return a + totalsOf(o).cod; }, 0)) + ' on delivery';
    var cardOf = function (o) {
      var c = o.conf || {}, t = totalsOf(o), lock = LOCKS[o.id];
      var info = c.attempts ? 'Called ' + plural(c.attempts, 'time', 'times') + (c.lastNote ? ': “' + c.lastNote + '”' : ', no answer') : 'Not called yet';
      return {
        id: o.id, n: '#' + o.n, name: o.name, phone: fmtPhone(o.phone), area: [o.area, o.district].join(', '), placed: when(o.placed),
        items: itemsText(o.lines), cod: money(t.cod) + ' on delivery', risk: riskChip(o.score, o.risky), info: info,
        due: c.dueAt ? 'Call back ' + (c.dueAt.slice(0, 10) === TODAY ? 'at ' : short(c.dueAt.slice(0, 10)) + ', ') + clock(c.dueAt.slice(11, 16)) : '', hasDue: Boolean(c.dueAt),
        dueFlag: bucket(o) === 'later' ? 'true' : 'false',
        sms: c.linkSent ? 'Confirmation SMS sent ' + clock(c.linkSent.slice(11, 16)) + ': no reply yet' : '', hasSms: Boolean(c.linkSent),
        dup: o.dupOf ? 'Possible duplicate of #' + oById(o.dupOf).n : '', hasDup: Boolean(o.dupOf),
        locked: Boolean(lock), lockText: lock ? lock + ' is calling' : '', free: !lock,
        callText: 'Call ' + fmtPhone(o.phone), aria: 'Open order #' + o.n,
        call: function () { up({ call: o.id, out: null, when: null, code: null, block: false, cnote: '', otried: false }); }
      };
    };
    vals.cards = list.map(cardOf);
    vals.empty = list.length === 0;
    vals.allDone = queue.length === 0;
    vals.emptyText = queue.length === 0 ? 'All caught up. New orders show up here to call.' : tab === 'later' ? 'No call-backs waiting.' : tab === 'unreachable' ? 'Nobody is unreachable.' : 'Nothing to call now. Check Later for call-backs.';

    // The call panel.
    var o = s.call ? orders.filter(function (x) { return x.id === s.call; })[0] : null;
    var out = s.out, when_ = s.when, code = s.code;
    var t = o ? totalsOf(o) : null;
    var bad = Boolean(s.otried) && (!out || out === 'later' && !when_ || out === 'cancelled' && !code);
    vals.cl = {
      open: Boolean(o), title: o ? 'Call ' + o.name : '', sub: o ? 'Order #' + o.n + ' · ' + fmtPhone(o.phone) : '', tel: o ? 'tel:' + o.phone : '#', callText: o ? 'Call ' + fmtPhone(o.phone) : '',
      script: o ? 'Assalamu alaikum. I’m calling from Nakshi Fashion about your order: ' + o.lines.map(function (l) { return l[1] + ' ' + vById(l[0]).t; }).join(' and ') + ', ' + money(t.total) + ' with delivery to ' + o.area + '. Shall we send it?' : '',
      lines: o ? o.lines.map(function (l) { return { text: l[1] + ' × ' + lineLabel(l[0]), value: money(l[1] * l[2]) }; }) : [],
      total: t ? money(t.cod) + ' on delivery' : '', address: o ? [o.line, o.area, o.district].join(', ') : '',
      outcomes: OUTCOMES.map(function (x) { var on = out === x[0]; return { label: x[1], hasSub: true, sub: x[2], on: on, aria: on ? 'true' : 'false', pick: function () { up({ out: x[0] }); } }; }),
      isLater: out === 'later', isCancel: out === 'cancelled' || out === 'wrong', isCancelled: out === 'cancelled',
      whens: WHENS.map(function (w) { return { label: w[1], on: when_ === w[0] ? 'true' : 'false', pick: function () { up({ when: w[0] }); } }; }),
      codes: CANCEL_CODES.filter(function (c) { return c[0] !== 'no_answer' && c[0] !== 'wrong_number'; }).map(function (c) { var on = code === c[0]; return { label: c[1], hasSub: false, sub: '', on: on, aria: on ? 'true' : 'false', pick: function () { up({ code: c[0] }); } }; }),
      block: checkOf(Boolean(s.block), function () { up({ block: !s.block }); }),
      note: s.cnote || '', onNote: function (e) { up({ cnote: e.target.value }); },
      bad: bad, badText: !out ? 'Pick what happened on the call.' : out === 'later' ? 'Pick when to call back.' : 'Pick why they cancelled.',
      hasNext: false, saveText: 'Save and next'
    };
    if (o) {
      var rest = list.filter(function (x) { return x.id !== o.id && !LOCKS[x.id]; });
      vals.cl.saveText = rest.length ? 'Save and next' : 'Save';
      vals.cl.save = function () {
        if (!out || out === 'later' && !when_ || out === 'cancelled' && !code) { up({ otried: true }); return; }
        var c = Object.assign({}, o.conf), patch = {}, msg = '';
        if (out === 'confirmed') { patch = { status: 'confirmed', conf: { via: 'call' } }; msg = 'Order #' + o.n + ' is confirmed.'; }
        if (out === 'no_answer') { c.attempts = (c.attempts || 0) + 1; c.lastNote = (s.cnote || '').trim(); patch = { conf: c, flags: c.attempts >= 3 ? o.flags.concat(['unreachable']) : o.flags }; msg = c.attempts >= 3 ? 'No answer 3 times. #' + o.n + ' moved to Unreachable.' : 'No answer. Try again later.'; }
        if (out === 'later') { c.attempts = (c.attempts || 0) + 1; c.dueAt = WHENS.filter(function (w) { return w[0] === when_; })[0][2]; c.lastNote = (s.cnote || '').trim(); patch = { conf: c }; msg = 'Call back ' + WHENS.filter(function (w) { return w[0] === when_; })[0][1].toLowerCase() + '. It’s in Later.'; }
        if (out === 'wrong') { patch = { status: 'cancelled', cancel: ['wrong_number', s.cnote || ''], conf: null }; msg = 'Order #' + o.n + ' is cancelled: wrong number.'; }
        if (out === 'cancelled') { patch = { status: 'cancelled', cancel: [code, s.cnote || ''], conf: null }; msg = 'Order #' + o.n + ' is cancelled.' + (s.block ? ' The phone is blocked.' : ''); }
        var next = rest[0];
        up({ orders: orders.map(function (x) { return x.id === o.id ? Object.assign({}, x, patch) : x; }), call: next ? next.id : null, out: null, when: null, code: null, block: false, cnote: '', otried: false, toast: toast(msg) });
      };
      vals.cl.stop = function () { up({ orders: orders.map(function (x) { return x.id === o.id ? Object.assign({}, x, { conf: Object.assign({}, x.conf, { inQueue: false }) }) : x; }), call: null, toast: toast('Taken off the call list. #' + o.n + ' stays pending.') }); };
    } else { vals.cl.save = function () {}; vals.cl.stop = function () {}; }
    vals.closeCall = function () { up({ call: null }); };
    vals.closeAll = function () { up({ call: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ call: null }); } };
    return vals;
  }
}
