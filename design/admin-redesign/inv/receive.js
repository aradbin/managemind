var START = {
  'For PO-0016': { mode: 'po', po: 'po16' }, 'For PO-0017': { mode: 'po', po: 'po17' }, 'Choose a purchase order': { mode: 'po', po: '', combo: 'po' },
  'Without a purchase order': { mode: 'direct', sup: 's3', lines: [['v14', '20', '58', null], ['v5', '6', '', null]], cost: ['Rickshaw van', '150'] },
  'Item picker': { mode: 'direct', combo: 'item' }, 'Pay now': { mode: 'po', po: 'po17', pay: true, payAmt: '20000', method: 'bkash' },
  'More than ordered': { mode: 'po', po: 'po16', lines: [['v2', '10', '', 8], ['v3', '10', '', 10], ['v10', '2', '', 2]] },
  'Missing costs': { mode: 'direct', sup: '', lines: [['v12', '4', '', null]], tried: true }
};
function openPos(pos) { return pos.filter(function (p) { return p.status === 'ordered' || p.status === 'partially_received'; }); }
function linesFor(po) { return po ? po.lines.filter(function (l) { return l[1] - l[3] > 0; }).map(function (l) { return [l[0], String(l[1] - l[3]), '', l[1] - l[3]]; }) : []; }

class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'For PO-0016');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var pos = s.pos || POS;
    var mode = s.mode || 'po';
    var po = mode === 'po' && s.po ? pos.filter(function (p) { return p.id === s.po; })[0] : null;
    var lines = s.lines || (mode === 'po' ? linesFor(po) : []);
    var supId = po ? po.sup : (s.sup || '');
    var tried = Boolean(s.tried);
    var setLines = function (nl, extra) { up(Object.assign({ lines: nl }, extra || {})); };
    var poCost = function (vid) { var l = po ? po.lines.filter(function (x) { return x[0] === vid; })[0] : null; return l ? l[2] : null; };

    vals.modes = [['po', 'From a purchase order'], ['direct', 'Without one']].map(function (m) {
      return { label: m[1], on: mode === m[0] ? 'true' : 'false', pick: function () { up({ mode: m[0], po: '', sup: '', lines: null, cost: null, pay: false, payAmt: '', tried: false, combo: null }); } };
    });
    vals.isPo = mode === 'po'; vals.isDirect = mode === 'direct';

    // Comboboxes: purchase order, supplier and the item picker.
    var allCombos = {};
    var combo = function (key, cfg) {
      var open = s.combo === key;
      var ql = open ? (s.cq || '').trim().toLowerCase() : '';
      var opts = cfg.options.filter(function (o) { return !ql || (o.label + ' ' + (o.sub || '')).toLowerCase().indexOf(ql) !== -1; });
      var cur = cfg.options.filter(function (o) { return o.v === cfg.current; })[0];
      var obj = {
        open: open, aria: open ? 'true' : 'false', title: cfg.title, ph: cfg.ph, query: open ? (s.cq || '') : '', none: opts.length === 0, disabled: false,
        display: cur ? cur.label : cfg.placeholder, color: cur && cfg.current !== '' ? 'var(--foreground)' : 'var(--muted-foreground)',
        toggle: function () { up({ combo: open ? null : key, cq: '' }); }, onQuery: function (e) { up({ cq: e.target.value }); },
        items: opts.map(function (o) { var on = o.v === cfg.current; return { label: o.label, sub: o.sub || '', hasSub: Boolean(o.sub), check: on ? '1' : '0', aria: on ? 'true' : 'false', pick: function () { cfg.onPick(o.v); } }; })
      };
      allCombos[key] = obj;
      return obj;
    };
    vals.poc = combo('po', {
      title: 'Purchase order', ph: 'Search PO or supplier', placeholder: 'Choose the order that arrived', current: s.po || '',
      options: openPos(pos).map(function (p) { var pr = poProgress(p); return { v: p.id, label: p.ref + ' · ' + sById(p.sup).name, sub: pr.text + (p.expected ? ' · expected ' + short(p.expected) : '') }; }),
      onPick: function (v) { up({ po: v, lines: null, combo: null, pay: false, payAmt: '' }); }
    });
    vals.supc = combo('sup', {
      title: 'Supplier', ph: 'Search suppliers', placeholder: 'No supplier', current: s.sup || '',
      options: [{ v: '', label: 'No supplier', sub: 'A market purchase' }].concat(SUPPLIERS.filter(function (x) { return !x.archived; }).map(function (x) { return { v: x.id, label: x.name, sub: x.contact }; })),
      onPick: function (v) { up({ sup: v, combo: null, pay: v ? s.pay : false }); }
    });
    vals.item = combo('item', {
      title: 'Add an item', ph: 'Search titles and SKUs', placeholder: '', current: '',
      options: VARIANTS.filter(function (v) { return v.track && !lines.some(function (l) { return l[0] === v.id; }); }).map(function (v) { return { v: v.id, label: label(v), sub: v.sku + ' · ' + v.oh + ' on hand' }; }),
      onPick: function (v) { setLines(lines.concat([[v, '1', '', null]]), { combo: null, cq: '' }); }
    });
    var active = allCombos[s.combo] || null;
    vals.comboOpen = Boolean(active);
    vals.cbd = active || vals.poc;
    vals.closeCombo = function () { up({ combo: null }); };
    vals.comboEsc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); up({ combo: null }); } };
    vals.hasPo = Boolean(po);
    vals.poText = po ? 'Receiving ' + po.ref + ' from ' + sById(po.sup).name + '.' : '';
    vals.poSub = po ? poProgress(po).text + (po.expected ? ' · expected ' + longDate(po.expected) : '') : '';
    vals.poRef = po ? po.ref : '';

    vals.date = s.date || TODAY; vals.onDate = function (e) { up({ date: e.target.value }); };
    vals.todayOn = (s.date || TODAY) === TODAY ? 'true' : 'false'; vals.pickToday = function () { up({ date: TODAY }); };
    vals.invoice = s.invoice || ''; vals.onInvoice = function (e) { up({ invoice: e.target.value }); };

    // Lines: what arrived and what it cost.
    var cost = s.cost || ['', ''];
    var other = cost[1].trim() ? num(cost[1]) : 0;
    var parsed = lines.map(function (l) { var q = num(l[1]); var c = l[2].trim() === '' ? null : num(l[2]); return { q: q, c: c, unit: c !== null ? c : poCost(l[0]) }; });
    var goods = parsed.reduce(function (a, p) { return a + (p.q > 0 && p.unit ? p.q * p.unit : 0); }, 0);
    var badCount = 0, missingCost = 0;
    vals.lines = lines.map(function (l, i) {
      var v = vById(l[0]), p = parsed[i];
      var qBad = p.q === null || !Number.isInteger(p.q) || p.q < 0;
      var cMissing = !po && p.q > 0 && p.c === null;
      if (qBad) badCount++;
      if (cMissing) missingCost++;
      var extra = l[3] !== null && p.q > l[3] ? p.q - l[3] : 0;
      var landed = other > 0 && goods > 0 && p.q > 0 && p.unit ? p.unit + other * (p.unit / goods) : 0;
      var setL = function (k, val) { setLines(lines.map(function (x, j) { if (j !== i) return x; var y = x.slice(); y[k] = val; return y; })); };
      return {
        title: v.t, opts: v.o, sub: [v.sku, l[3] !== null ? 'To come: ' + l[3] : v.oh + ' on hand'].filter(Boolean).join(' · '),
        qty: l[1], cost: l[2], costPh: poCost(l[0]) !== null ? String(poCost(l[0])) : '', onQty: function (e) { setL(1, e.target.value); }, onCost: function (e) { setL(2, e.target.value); },
        qBad: qBad ? 'true' : 'false', cBad: tried && cMissing ? 'true' : 'false',
        over: extra > 0, overText: extra + ' more than ordered: received anyway.',
        hasLanded: landed > 0 && extra === 0, landedText: 'With other costs: ' + money(Math.round(landed)) + ' each',
        showErr: tried && cMissing, errText: 'Enter what each cost.',
        canRemove: !po, removeAria: 'Remove ' + label(v), remove: function () { setLines(lines.filter(function (x, j) { return j !== i; })); },
        qtyAria: 'Received: ' + label(v), costAria: 'Cost each: ' + label(v)
      };
    });
    vals.hasLines = lines.length > 0;
    vals.noLines = lines.length === 0;
    vals.emptyText = mode === 'po' ? (po ? 'Everything on ' + po.ref + ' has arrived.' : 'Choose the purchase order that arrived. Its items come in with what’s still to come.') : 'Add what arrived.';
    vals.canAdd = !po && mode === 'direct';
    vals.costHint = po ? 'Leave the cost empty to use the purchase order’s.' : '';
    vals.hasCostHint = Boolean(po);
    vals.costLabel = cost[0]; vals.costAmount = cost[1];
    vals.onCostLabel = function (e) { up({ cost: [e.target.value, cost[1]] }); };
    vals.onCostAmount = function (e) { up({ cost: [cost[0], e.target.value] }); };
    var units = parsed.reduce(function (a, p) { return a + (p.q > 0 ? p.q : 0); }, 0);
    var total = goods + (other || 0);
    vals.goods = money(goods); vals.other = money(other || 0); vals.total = money(total);

    // Pay now.
    var pay = Boolean(s.pay) && Boolean(supId);
    vals.canPay = Boolean(supId);
    vals.payTitle = supId ? 'Pay ' + sById(supId).name + ' now' : '';
    vals.payBal = supId ? 'Their balance now: ' + balanceOf(sById(supId).balance).text.replace('You owe', 'you owe') + '.' : '';
    vals.pay = pay; vals.payAria = pay ? 'true' : 'false'; vals.payBg = pay ? 'var(--primary)' : 'var(--input)'; vals.payX = pay ? '14px' : '0px';
    vals.togglePay = function () { up({ pay: !s.pay }); };
    vals.payAmt = s.payAmt || ''; vals.onPayAmt = function (e) { up({ payAmt: e.target.value }); };
    vals.payAllText = 'All ' + money(total); vals.payAll = function () { up({ payAmt: String(total) }); };
    var method = s.method || 'cash';
    vals.methods = METHODS.map(function (m) { return { label: m[1], on: method === m[0] ? 'true' : 'false', pick: function () { up({ method: m[0] }); } }; });
    var paid = num(s.payAmt || '');
    var payBad = pay && !(paid > 0);
    vals.payErr = tried && payBad;

    var valid = units > 0 && badCount === 0 && missingCost === 0 && !payBad;
    vals.showProblems = tried && !valid;
    var msg = [];
    if (!units) msg.push(mode === 'po' && !po ? 'Choose the purchase order.' : 'Enter how many arrived.');
    if (badCount) msg.push('Check the quantity of ' + plural(badCount, 'item', 'items') + '.');
    if (missingCost) msg.push('Enter the cost of ' + plural(missingCost, 'item', 'items') + ': without a purchase order there is no cost to use.');
    if (payBad) msg.push('Enter the amount paid, or turn Pay now off.');
    vals.problemsText = msg.join(' ');
    vals.bar = { show: lines.length > 0, label: plural(units, 'unit', 'units') + ' · ' + money(total), cancel: 'Clear', save: 'Receive' };
    vals.discard = function () { up({ lines: mode === 'po' ? null : [], cost: null, pay: false, payAmt: '', tried: false, invoice: '' }); };
    vals.save = function () {
      if (!valid) { up({ tried: true }); return; }
      var over = vals.lines.filter(function (l) { return l.over; }).length;
      var text = 'Received GRN-0032' + (paid > 0 && pay ? ', and paid ' + money(paid) : '') + '.' + (over ? ' ' + plural(over, 'item', 'items') + ' came in more than ordered.' : '');
      var np = po ? pos.map(function (p) {
        if (p.id !== po.id) return p;
        var nl = p.lines.map(function (l) { var x = lines.filter(function (y) { return y[0] === l[0]; })[0]; var q = x ? (num(x[1]) || 0) : 0; return [l[0], l[1], l[2], l[3] + q]; });
        var done = nl.every(function (l) { return l[3] >= l[1]; });
        return Object.assign({}, p, { lines: nl, status: done ? 'received' : 'partially_received' });
      }) : pos;
      up({ pos: np, mode: 'po', po: '', lines: null, cost: null, pay: false, payAmt: '', tried: false, invoice: '', toast: toast(text) });
    };
    var reset = { combo: null };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up(reset); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    return vals;
  }
}
