var START = {
  'Partly received': { id: 'po16' }, Ordered: { id: 'po17' }, Draft: { id: 'po18' }, 'New purchase order': { id: 'new' },
  'Add an item': { id: 'po18', combo: 'item' }, 'Unsaved changes': { id: 'po18', d: { sup: 's2', expected: '2026-11-10', supRef: '', note: '', lines: [['v6', '10', '890', 0], ['v7', '15', '890', 0], ['v4', '6', '1450', 0]], costs: [['Courier', '600']] } },
  'Missing details': { id: 'new', tried: true, d: { sup: '', expected: '', supRef: '', note: '', lines: [['v1', '0', '', 0]], costs: [['', '']] } },
  'More menu': { id: 'po16', more: true }, 'Close order': { id: 'po16', confirm: 'close' }, Received: { id: 'po15' }
};
function draftOf(po) {
  return po ? { sup: po.sup, expected: po.expected, supRef: po.supRef, note: po.note, lines: po.lines.map(function (l) { return [l[0], String(l[1]), String(l[2]), l[3]]; }), costs: po.costs.map(function (c) { return [c[0], String(c[1])]; }) }
    : { sup: '', expected: '', supRef: '', note: '', lines: [], costs: [] };
}

class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Partly received');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var pos = s.pos || POS;
    var id = s.id || 'po16';
    var po = id === 'new' ? null : pos.filter(function (p) { return p.id === id; })[0];
    var status = po ? po.status : 'draft';
    var editable = !po || ['draft', 'ordered', 'partially_received'].indexOf(status) !== -1;
    var supEditable = !po || status === 'draft';
    var orig = draftOf(po);
    var d = s.d || orig;
    var dirty = !po || JSON.stringify(d) !== JSON.stringify(orig);
    var setD = function (patch, extra) { up(Object.assign({ d: Object.assign({}, d, patch) }, extra || {})); };
    var tried = Boolean(s.tried);

    // Header.
    var pr = po ? poProgress(po) : { ordered: 0, received: 0 };
    vals.hd = {
      title: po ? po.ref : 'New purchase order', isExisting: Boolean(po), isNew: !po, badge: badgeOf(PO_STATUS, status),
      sub: po ? sById(po.sup).name + ' · Created ' + longDate(po.created) : 'Order from a supplier, then receive what arrives, all at once or in parts.',
      canReceive: status === 'ordered' || status === 'partially_received', canPlace: Boolean(po) && status === 'draft',
      canClose: status === 'partially_received', canCancel: status === 'ordered' && pr.received === 0, canDelete: Boolean(po) && status === 'draft',
      readOnly: !editable, readOnlyText: status === 'received' ? 'Everything on this order has arrived, so it can’t change.' : status === 'closed' ? 'This order is closed. What didn’t arrive won’t be received.' : 'This order was cancelled. Nothing was received.'
    };
    vals.hasMore = vals.hd.canClose || vals.hd.canCancel || vals.hd.canDelete;
    vals.stats = po && status !== 'draft' ? [
      { label: 'Ordered', value: plural(pr.ordered, 'unit', 'units') },
      { label: 'Received', value: pr.received + ' of ' + pr.ordered },
      { label: 'To come', value: status === 'closed' || status === 'cancelled' ? '—' : String(pr.ordered - pr.received) },
      { label: 'Expected on', value: po.expected ? short(po.expected) : '—' }
    ] : [];
    vals.hasStats = vals.stats.length > 0;
    vals.progPct = pr.ordered ? Math.round(pr.received / pr.ordered * 100) + '%' : '0%';

    // Comboboxes: supplier and the item picker.
    var allCombos = {};
    var combo = function (key, cfg) {
      var open = s.combo === key;
      var ql = open ? (s.cq || '').trim().toLowerCase() : '';
      var opts = cfg.options.filter(function (o) { return !ql || (o.label + ' ' + (o.sub || '')).toLowerCase().indexOf(ql) !== -1; });
      var cur = cfg.options.filter(function (o) { return o.v === cfg.current; })[0];
      var obj = {
        open: open, aria: open ? 'true' : 'false', title: cfg.title, ph: cfg.ph, query: open ? (s.cq || '') : '', none: opts.length === 0, disabled: Boolean(cfg.disabled),
        display: cur ? cur.label : cfg.placeholder, color: cur ? 'var(--foreground)' : 'var(--muted-foreground)',
        toggle: function () { up({ combo: open ? null : key, cq: '' }); }, onQuery: function (e) { up({ cq: e.target.value }); },
        items: opts.map(function (o) { var on = o.v === cfg.current; return { label: o.label, sub: o.sub || '', hasSub: Boolean(o.sub), check: on ? '1' : '0', aria: on ? 'true' : 'false', pick: function () { cfg.onPick(o.v); } }; })
      };
      allCombos[key] = obj;
      return obj;
    };
    vals.sup = combo('sup', {
      title: 'Supplier', ph: 'Search suppliers', placeholder: 'Choose a supplier', current: d.sup,
      options: SUPPLIERS.filter(function (x) { return !x.archived; }).map(function (x) { return { v: x.id, label: x.name, sub: x.contact }; }),
      onPick: function (v) { setD({ sup: v }, { combo: null }); }
    });
    vals.supEditable = supEditable && editable;
    vals.supFixed = !(supEditable && editable);
    vals.supName = d.sup ? sById(d.sup).name : '';
    vals.supErr = tried && !d.sup;
    vals.item = combo('item', {
      title: 'Add an item', ph: 'Search titles and SKUs', placeholder: 'Add an item', current: '',
      options: VARIANTS.filter(function (v) { return v.track && !d.lines.some(function (l) { return l[0] === v.id; }); }).map(function (v) { return { v: v.id, label: label(v), sub: v.sku + ' · ' + v.oh + ' on hand' }; }),
      onPick: function (v) { var vv = vById(v); setD({ lines: d.lines.concat([[v, '1', vv.cost === null ? '' : String(vv.cost), 0]]) }, { combo: null, cq: '' }); }
    });
    var active = allCombos[s.combo] || null;
    vals.comboOpen = Boolean(active);
    vals.cbd = active || vals.sup;
    vals.closeCombo = function () { up({ combo: null }); };
    vals.comboEsc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); up({ combo: null }); } };

    // Details.
    vals.expected = d.expected; vals.onExpected = function (e) { setD({ expected: e.target.value }); };
    vals.supRef = d.supRef; vals.onSupRef = function (e) { setD({ supRef: e.target.value }); };
    vals.note = d.note; vals.onNote = function (e) { setD({ note: e.target.value }); };
    vals.locked = !editable;
    vals.hasEdit = editable;
    vals.supErrAria = tried && !d.sup ? 'true' : 'false';

    // Items.
    var problems = [];
    vals.lines = d.lines.map(function (l, i) {
      var v = vById(l[0]), q = num(l[1]), c = l[2].trim() === '' ? null : num(l[2]);
      var minQ = Math.max(1, l[3]);
      var qBad = q === null || !Number.isInteger(q) || q < minQ, cBad = l[2].trim() !== '' && (c === null || c < 0);
      if (qBad) problems.push(label(v));
      var setLine = function (k, val) { var nl = d.lines.map(function (x, j) { if (j !== i) return x; var y = x.slice(); y[k] = val; return y; }); setD({ lines: nl }); };
      return {
        title: v.t, opts: v.o, hasOpts: Boolean(v.o),
        sub: [v.sku, po && status !== 'draft' ? l[3] + ' of ' + l[1] + ' received' : v.oh + ' on hand'].join(' · '),
        qty: l[1], cost: l[2], onQty: function (e) { setLine(1, e.target.value); }, onCost: function (e) { setLine(2, e.target.value); },
        qBad: qBad ? 'true' : 'false', cBad: cBad ? 'true' : 'false', showErr: tried && qBad,
        err: l[3] > 0 ? 'At least ' + l[3] + ': that many came already.' : 'At least 1.',
        total: q !== null && c !== null ? money(q * c) : '—',
        canRemove: editable && l[3] === 0, cantRemove: !(editable && l[3] === 0),
        removeAria: 'Remove ' + label(v), remove: function () { setD({ lines: d.lines.filter(function (x, j) { return j !== i; }) }); },
        qtyAria: 'Ordered: ' + label(v), costAria: 'Cost each: ' + label(v)
      };
    });
    vals.hasLines = d.lines.length > 0;
    vals.noLines = d.lines.length === 0;
    vals.linesErr = tried && d.lines.length === 0;
    vals.linesEdge = tried && d.lines.length === 0 ? 'var(--destructive)' : 'var(--border)';
    vals.lineCount = plural(d.lines.length, 'item', 'items');
    vals.canReorder = editable && Boolean(d.sup);
    vals.reorder = function () {
      var add = VARIANTS.filter(function (v) { return v.sup === d.sup && isLow(v) && !d.lines.some(function (l) { return l[0] === v.id; }); });
      if (!add.length) { up({ toast: toast('Nothing from this supplier is low.') }); return; }
      setD({ lines: d.lines.concat(add.map(function (v) { return [v.id, String(Math.max(1, v.low * 2 - available(v))), v.cost === null ? '' : String(v.cost), 0]; })) }, { toast: toast(plural(add.length, 'low item', 'low items') + ' added.') });
    };

    // Other costs.
    var costBad = 0;
    vals.costs = d.costs.map(function (c, i) {
      var a = num(c[1]), bad = !c[0].trim() || a === null || a <= 0;
      if (bad) costBad++;
      var setC = function (k, val) { var nc = d.costs.map(function (x, j) { if (j !== i) return x; var y = x.slice(); y[k] = val; return y; }); setD({ costs: nc }); };
      return {
        label: c[0], amount: c[1], onLabel: function (e) { setC(0, e.target.value); }, onAmount: function (e) { setC(1, e.target.value); },
        bad: tried && bad ? 'true' : 'false', removeAria: 'Remove ' + (c[0] || 'this cost'), remove: function () { setD({ costs: d.costs.filter(function (x, j) { return j !== i; }) }); }
      };
    });
    vals.hasCosts = d.costs.length > 0;
    vals.noCosts = d.costs.length === 0;
    vals.canAddCost = editable && d.costs.length < 10;
    vals.addCost = function () { setD({ costs: d.costs.concat([['', '']]) }); };
    vals.costQuick = ['Transport', 'Courier', 'Labour'].map(function (lab) { return { label: lab, add: function () { setD({ costs: d.costs.concat([[lab, '']]) }); } }; });
    var tt = poTotals(d.lines.map(function (l) { return [l[0], l[1], l[2] || 0]; }), d.costs);
    vals.goods = money(tt.goods); vals.other = money(tt.other); vals.total = money(tt.total);

    // Deliveries.
    vals.receipts = po ? po.receipts.map(function (r) { return { ref: r[0], date: longDate(r[1]), units: plural(r[2], 'unit', 'units'), value: money(r[3]) }; }) : [];
    vals.hasReceipts = vals.receipts.length > 0;

    // Save.
    if (!d.sup) problems.unshift('the supplier');
    var valid = d.sup && d.lines.length > 0 && problems.length === 0 && costBad === 0;
    vals.showProblems = tried && !valid;
    var msg = [];
    if (!d.sup) msg.push('Choose the supplier.');
    if (!d.lines.length) msg.push('Add the items you are ordering.');
    var qtyProblems = problems.filter(function (p) { return p !== 'the supplier'; }).length;
    if (qtyProblems) msg.push('Check the quantity of ' + plural(qtyProblems, 'item', 'items') + '.');
    if (costBad) msg.push('Each other cost needs what it’s for and an amount.');
    vals.problemsText = msg.join(' ');
    vals.bar = {
      show: editable && dirty, label: po ? 'Unsaved changes' : 'New purchase order',
      cancel: po ? 'Discard' : 'Cancel', save: status === 'draft' ? 'Save draft' : 'Save'
    };
    vals.discard = function () { up({ d: null, tried: false }); };
    vals.save = function () {
      if (!valid) { up({ tried: true }); return; }
      var lines = d.lines.map(function (l) { return [l[0], Number(num(l[1])), num(l[2]) || 0, l[3]]; });
      var costs = d.costs.map(function (c) { return [c[0].trim(), num(c[1])]; });
      if (po) {
        up({ pos: pos.map(function (p) { return p.id === po.id ? Object.assign({}, p, { sup: d.sup, expected: d.expected, supRef: d.supRef.trim(), note: d.note.trim(), lines: lines, costs: costs }) : p; }), d: null, tried: false, toast: toast('Purchase order saved.') });
      } else {
        var np = { id: 'po19', ref: 'PO-0019', sup: d.sup, status: 'draft', created: TODAY, expected: d.expected, supRef: d.supRef.trim(), note: d.note.trim(), lines: lines, costs: costs, receipts: [] };
        up({ pos: [np].concat(pos), id: 'po19', d: null, tried: false, toast: toast('Purchase order saved.') });
      }
    };
    vals.place = function () {
      if (dirty) { up({ toast: toast('Save the changes first.') }); return; }
      up({ pos: pos.map(function (p) { return p.id === po.id ? Object.assign({}, p, { status: 'ordered' }) : p; }), toast: toast('Marked as ordered.') });
    };
    vals.print = function () { up({ more: false, toast: toast((po ? po.ref : 'The order') + ' opened for printing.') }); };

    // More: close, cancel or delete.
    vals.moreOpen = Boolean(s.more);
    vals.moreAria = s.more ? 'true' : 'false';
    vals.hasDanger = vals.hd.canCancel || vals.hd.canDelete;
    vals.toggleMore = function () { up({ more: !s.more }); };
    var cf = s.confirm || null;
    vals.closeOpen = cf === 'close'; vals.cancelOpen = cf === 'cancel'; vals.deleteOpen = cf === 'delete';
    vals.askClose = function () { up({ more: false, confirm: 'close' }); };
    vals.askCancel = function () { up({ more: false, confirm: 'cancel' }); };
    vals.askDelete = function () { up({ more: false, confirm: 'delete' }); };
    vals.cfRef = po ? po.ref : '';
    vals.closeTitle = 'Close ' + vals.cfRef + '?'; vals.cancelTitle = 'Cancel ' + vals.cfRef + '?'; vals.deleteTitle = 'Delete draft ' + vals.cfRef + '?';
    vals.closeBody = po ? plural(pr.ordered - pr.received, 'unit', 'units') + ' haven’t arrived and won’t be received. The quantities stay on the PO.' : '';
    var move = function (st, text) { up({ pos: pos.map(function (p) { return p.id === po.id ? Object.assign({}, p, { status: st }) : p; }), confirm: null, d: null, toast: toast(text) }); };
    vals.doClose = function () { move('closed', 'Purchase order closed.'); };
    vals.doCancel = function () { move('cancelled', 'Purchase order cancelled.'); };
    vals.doDelete = function () { up({ confirm: null, toast: toast('Draft deleted.') }); };
    vals.cancelConfirm = function () { up({ confirm: null }); };

    var reset = { more: false, combo: null, confirm: null };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ more: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(s.combo ? { combo: null } : reset); } };
    return vals;
  }
}
