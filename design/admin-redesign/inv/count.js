var START = {
  Counting: { cid: 'sc7' }, 'After a scan': { cid: 'sc7', last: ['v1', 19], lines: { sc7: [['v1', 18, 19], ['v2', 4, 3], ['v3', 0, 0], ['v4', 9, null], ['v5', 14, null]] } },
  'Not counted only': { cid: 'sc7', left: true }, 'Code not found': { cid: 'sc7', code: '8941100100999', notFound: '8941100100999' },
  'In review': { cid: 'sc6' }, 'Apply differences': { cid: 'sc6', confirm: 'apply' }, 'Cancel count': { cid: 'sc7', confirm: 'cancel' }, Applied: { cid: 'sc5' }
};

class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Counting');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var statuses = s.statuses || {};
    var c0 = COUNTS.filter(function (c) { return c.id === (s.cid || 'sc7'); })[0];
    var allLines = s.lines || {};
    var c = Object.assign({}, c0, { status: statuses[c0.id] || c0.status, lines: allLines[c0.id] || c0.lines });
    var setLines = function (nl, extra) { var o = Object.assign({}, allLines); o[c.id] = nl; up(Object.assign({ lines: o }, extra || {})); };
    var counting = c.status === 'counting', review = c.status === 'review', done = c.status === 'applied' || c.status === 'cancelled';
    var d = countDiff(c);
    vals.hd = {
      ref: c.ref, badge: badgeOf(COUNT_STATUS, c.status), counting: counting, review: review, open: counting || review,
      sub: scopeText(c) + ' · Started ' + longDate(c.created), note: c.note, hasNote: Boolean(c.note),
      progress: d.counted + ' of ' + c.lines.length + ' counted', pct: Math.round(d.counted / c.lines.length * 100) + '%', complete: d.counted === c.lines.length,
      progColor: d.counted === c.lines.length ? 'var(--success)' : 'var(--primary)', left: plural(c.lines.length - d.counted, 'item', 'items') + ' to go'
    };
    vals.isApplied = c.status === 'applied';
    vals.appliedText = c.status === 'applied' ? 'Applied ' + longDate(c.applied || c.created) + '. Stock changed by ' + signed(d.units) + ' units, worth ' + money(d.value) + ' at cost.' : '';
    vals.isCancelled = c.status === 'cancelled';

    // Scanning: a code adds one of the item it names.
    var scan = function (code) {
      var w = String(code || '').trim().toLowerCase();
      if (!w) return;
      var i = -1;
      c.lines.forEach(function (l, j) { var v = vById(l[0]); if (i === -1 && (v.bc === w || v.sku.toLowerCase() === w)) i = j; });
      if (i === -1) { up({ code: '', notFound: code.trim(), last: null }); return; }
      var next = (c.lines[i][2] || 0) + 1;
      setLines(c.lines.map(function (l, j) { return j === i ? [l[0], l[1], next] : l; }), { code: '', last: [c.lines[i][0], next], notFound: '' });
    };
    vals.code = s.code || '';
    vals.onCode = function (e) { up({ code: e.target.value }); };
    vals.codeKey = function (e) { if (e.key === 'Enter') { e.preventDefault(); scan(s.code); } };
    vals.addCode = function () { scan(s.code); };
    vals.tryScan = function () { scan(vById(c.lines[3] ? c.lines[3][0] : c.lines[0][0]).bc); };
    vals.camera = Boolean(s.camera);
    vals.cameraText = s.camera ? 'Stop camera' : 'Scan with camera';
    vals.toggleCamera = function () { up({ camera: !s.camera }); };
    vals.hasLast = Boolean(s.last);
    vals.lastText = s.last ? label(vById(s.last[0])) + ': ' + s.last[1] : '';
    vals.hasNotFound = Boolean(s.notFound);
    vals.notFoundText = 'Nothing in this count matches ' + (s.notFound || '') + '.';

    // The lines. Counters never see what is expected.
    var left = Boolean(s.left);
    var showDiffOnly = review && s.view !== 'all';
    var shown = c.lines.map(function (l, i) { return { l: l, i: i }; }).filter(function (x) {
      if (counting && left) return x.l[2] === null;
      if (showDiffOnly) return x.l[2] !== null && x.l[2] !== x.l[1];
      return true;
    });
    if (review || done) shown.sort(function (a, b2) { var va = Math.abs((a.l[2] === null ? 0 : a.l[2] - a.l[1]) * (vById(a.l[0]).cost || 0)), vb = Math.abs((b2.l[2] === null ? 0 : b2.l[2] - b2.l[1]) * (vById(b2.l[0]).cost || 0)); return vb - va; });
    vals.lines = shown.map(function (x) {
      var l = x.l, v = vById(l[0]), diff = l[2] === null ? null : l[2] - l[1];
      var setC = function (val) { setLines(c.lines.map(function (y, j) { return j === x.i ? [y[0], y[1], val] : y; }), { last: null, notFound: '' }); };
      return {
        title: v.t, opts: v.o, sub: [v.sku, v.bc].filter(Boolean).join(' · '), counted: l[2] === null ? '' : String(l[2]), isCounted: l[2] !== null,
        onCount: function (e) { var n = e.target.value.trim() === '' ? null : num(e.target.value); setC(n === null ? null : Math.max(0, Math.round(n))); },
        plus: function () { setC((l[2] || 0) + 1); }, minus: function () { setC(Math.max(0, (l[2] || 0) - 1)); }, minusOff: !l[2],
        expected: String(l[1]), diff: diff === null ? '—' : signed(diff), diffColor: diff ? 'var(--destructive)' : 'var(--muted-foreground)', diffWeight: diff ? '600' : '400',
        value: diff && v.cost !== null ? money(diff * v.cost) : diff ? '—' : '', countedText: l[2] === null ? 'Not counted' : String(l[2]),
        aria: 'Counted: ' + label(v), isLast: Boolean(s.last) && s.last[0] === l[0], rowBg: s.last && s.last[0] === l[0] ? 'color-mix(in oklch, var(--success) 8%, transparent)' : 'transparent'
      };
    });
    vals.editable = counting || review;
    vals.readOnly = done;
    vals.ctabs = [['all', 'All', c.lines.length], ['left', 'Not counted', c.lines.length - d.counted]].map(function (t) {
      var on = (t[0] === 'left') === left;
      return { label: t[1], count: String(t[2]), on: on ? 'true' : 'false', pick: function () { up({ left: t[0] === 'left' }); } };
    });
    vals.rtabs = [['diff', 'Differences', d.lines], ['all', 'All', c.lines.length]].map(function (t) {
      var on = (t[0] === 'all') === (s.view === 'all');
      return { label: t[1], count: String(t[2]), on: on ? 'true' : 'false', pick: function () { up({ view: t[0] }); } };
    });
    vals.noLines = shown.length === 0;
    vals.noLinesText = counting ? 'Everything is counted. Press Done counting to review the differences.' : 'Everything counted matches.';
    vals.summary = d.lines === 0 ? 'Everything counted matches.' : 'Differences: ' + plural(d.lines, 'item', 'items') + ', ' + signed(d.units) + ' units · ' + money(d.value) + ' at cost';
    vals.hasMissing = review && d.counted < c.lines.length;
    vals.missingText = plural(c.lines.length - d.counted, 'item wasn’t', 'items weren’t') + ' counted. They keep their stock when you apply.';

    // Moves.
    var setStatus = function (st, extra) { var o = Object.assign({}, statuses); o[c.id] = st; up(Object.assign({ statuses: o, confirm: null, more: false }, extra || {})); };
    vals.submit = function () { setStatus('review', { view: 'diff', last: null, toast: toast(d.counted < c.lines.length ? 'Ready to review. ' + plural(c.lines.length - d.counted, 'item wasn’t', 'items weren’t') + ' counted.' : 'Ready to review.') }); };
    vals.reopen = function () { setStatus('counting', { toast: toast('Back to counting.') }); };
    vals.askApply = function () { up({ confirm: 'apply' }); };
    vals.askCancel = function () { up({ confirm: 'cancel', more: false }); };
    vals.applyOpen = s.confirm === 'apply'; vals.cancelOpen = s.confirm === 'cancel';
    vals.applyTitle = 'Apply ' + c.ref + '?';
    vals.applyBody = plural(d.lines, 'item changes', 'items change') + ' by ' + signed(d.units) + ' units in all.';
    vals.applyValue = 'Worth ' + money(d.value) + ' at cost.';
    vals.overThreshold = Math.abs(d.value) > THRESHOLD;
    vals.approvalText = 'Above ' + money(THRESHOLD) + ', an owner or manager has to apply this count. You’re the owner.';
    vals.cancelTitle = 'Cancel ' + c.ref + '?';
    vals.doApply = function () { setStatus('applied', { toast: toast('Count applied.') }); };
    vals.doCancel = function () { setStatus('cancelled', { toast: toast('Count cancelled.') }); };
    vals.cancelConfirm = function () { up({ confirm: null }); };
    vals.moreOpen = Boolean(s.more); vals.moreAria = s.more ? 'true' : 'false';
    vals.toggleMore = function () { up({ more: !s.more }); };
    vals.printSheet = function () { up({ more: false, toast: toast('Count sheet opened for printing.') }); };
    var reset = { more: false, confirm: null };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ more: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    return vals;
  }
}
