var TC_PRODUCTS = [
  { id: 'p1', name: 'Cotton Panjabi — Ivory', price: 1850, sel: ['cat:men', 'cat:panjabi', 'col:eid', 'col:best'] },
  { id: 'p2', name: 'Handloom Tangail Saree', price: 3400, sel: ['cat:women', 'cat:saree', 'col:eid', 'col:festive', 'col:best'] },
  { id: 'p3', name: 'Embroidered Kurti', price: 1250, sel: ['cat:women', 'cat:kurti', 'col:eid', 'col:festive'] },
  { id: 'p4', name: 'Leather Kolhapuri Sandal', price: 1650, sel: ['col:best'] },
  { id: 'p7', name: 'Jute Tote Bag', price: 650, sel: ['cat:acc', 'col:best'] },
  { id: 'p9', name: 'Winter Shawl — Kashmiri', price: 2400, sel: ['cat:acc', 'col:winter'] }
];
var AREAS = [['Dhanmondi, Dhaka', 'inside'], ['Gulshan, Dhaka', 'inside'], ['Mirpur, Dhaka', 'inside'], ['Tongi, Gazipur', 'suburbs'], ['Narayanganj Sadar', 'suburbs'], ['Halishahar, Chattogram', 'outside'], ['Sylhet Sadar, Sylhet', 'outside']];
var FEES = { inside: 60, suburbs: 100, outside: 120 };
var KNOWN = { '01712345678': { name: 'Rahim Ahmed', tags: ['vip', 'dhaka'], first: false } };
var STATUSES = [
  { v: 'active', label: 'Active', sub: 'Live while its dates allow' },
  { v: 'draft', label: 'Draft', sub: 'Not applied. Only staff see it' },
  { v: 'paused', label: 'Paused', sub: 'Stopped for now; resume any time' },
  { v: 'ended', label: 'Ended', sub: 'Stopped for good' }
];
var PERCENT_ACTIONS = ['percent_off_order', 'percent_off_items', 'delivery_percent_off', 'buy_x_get_y'];
var AMOUNT_ACTIONS = ['amount_off_order', 'amount_off_items', 'delivery_amount_off'];
var START = {
  'Code promotion': { pid: 'eid' }, Automatic: { pid: 'freedel' }, 'Buy X get Y': { pid: 'bxgy' }, 'New promotion': { pid: 'new' },
  'What it gives': { pid: 'eid', combo: 'action' }, 'Add a condition': { pid: 'eid', addCond: true }, 'Test cart': { pid: 'eid', tc: true },
  'Generate codes': { pid: 'vip', gen: true }, Status: { pid: 'eid', stOpen: true }, 'Missing details': { pid: 'new', tried: true }
};

function evaluate(p, cart, asThis) {
  var sub = cart.subtotal;
  var inSel = function (line, sel) { return sel.some(function (v) { return v === 'p:' + line.id || line.sel.indexOf(v) !== -1; }); };
  if (p.kind === 'code') {
    var entered = (cart.code || '').trim().toUpperCase();
    if (!entered || (p.code && entered !== p.code.toUpperCase())) return { applied: false, reason: asThis ? 'Enter its code to try it.' : 'No such code.' };
  }
  for (var i = 0; i < p.conds.length; i++) {
    var c = p.conds[i];
    if (c.type === 'min_subtotal' && num(c.value) && sub < num(c.value)) return { applied: false, reason: 'The order is below the minimum.' };
    if (c.type === 'min_quantity' && num(c.value) && cart.qty < num(c.value)) return { applied: false, reason: 'Not enough items.' };
    if (c.type === 'items' && c.items && c.items.length && !cart.lines.some(function (l) { return inSel(l, c.items); })) return { applied: false, reason: 'The cart doesn’t have the right items.' };
    if (c.type === 'zones' && c.ids && c.ids.length && c.ids.indexOf(cart.zone) === -1) return { applied: false, reason: 'Not for this delivery area.' };
    if (c.type === 'first_order' && !cart.customer.first) return { applied: false, reason: 'First orders only.' };
    if (c.type === 'tags' && c.tags && c.tags.length && !c.tags.some(function (t) { return cart.customer.tags.indexOf(t) !== -1; })) return { applied: false, reason: 'Not for this customer.' };
    if (c.type === 'phones' && String(c.text || '').trim() && String(c.text).replace(/[^0-9\n]/g, '').split('\n').indexOf(cart.phone) === -1) return { applied: false, reason: 'Not for this customer.' };
    if (c.type === 'payment' && c.methods && c.methods.length && c.methods.indexOf(cart.pay) === -1) return { applied: false, reason: 'Not for this payment method.' };
  }
  var pc = (num(p.percent) || 0) / 100, am = num(p.amount) || 0, amount = 0, delivery = false;
  var matching = function (sel) { return cart.lines.filter(function (l) { return inSel(l, sel); }); };
  switch (p.action) {
    case 'percent_off_order': amount = sub * pc; break;
    case 'amount_off_order': amount = Math.min(am, sub); break;
    case 'percent_off_items': amount = matching(p.target).reduce(function (a, l) { return a + l.price * l.qty; }, 0) * pc; break;
    case 'amount_off_items': amount = matching(p.target).reduce(function (a, l) { return a + Math.min(am, l.price) * l.qty; }, 0); break;
    case 'buy_x_get_y':
      var units = [];
      matching(p.buyItems).forEach(function (l) { for (var k = 0; k < l.qty; k++) units.push(l.price); });
      units.sort(function (a, b) { return a - b; });
      var b = num(p.buyQty) || 0, g = num(p.getQty) || 0;
      var sets = b + g ? Math.floor(units.length / (b + g)) : 0;
      if (num(p.maxUses)) sets = Math.min(sets, num(p.maxUses));
      amount = units.slice(0, sets * g).reduce(function (a, x) { return a + x; }, 0) * pc;
      break;
    case 'delivery_percent_off': amount = cart.fee * pc; delivery = true; break;
    case 'delivery_amount_off': amount = Math.min(am, cart.fee); delivery = true; break;
  }
  if (num(p.maxDiscount)) amount = Math.min(amount, num(p.maxDiscount));
  amount = Math.round(amount);
  if (!amount) return { applied: false, reason: 'Gives nothing off this cart.' };
  return { applied: true, amount: amount, delivery: delivery };
}

class Component extends DCLogic {
  renderVals() {
    var self = this;
    var startKey = this.props.startOn ?? 'Code promotion';
    var s = this.state || {};
    if (s.started !== startKey) s = Object.assign({ started: startKey, dark: s.dark }, copy(START[startKey] || {}));
    var up = function (patch) { self.setState(Object.assign({}, s, patch, { started: startKey })); };
    var toast = function (text) {
      clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function () { self.setState({ toast: null }); }, 4000);
      return text;
    };
    var vals = {};
    var pid = s.pid || 'eid';
    var isNew = pid === 'new';
    var saved = s.saved || (isNew ? P({ id: 'new', status: 'draft' }) : PROMOS.filter(function (p) { return p.id === pid; })[0]);
    var d = s.draft || copy(saved);
    var setD = function (patch, extra) { up(Object.assign({ draft: Object.assign({}, d, patch), dirty: true }, extra || {})); };
    var setCond = function (i, patch, extra) { var n = d.conds.slice(); n[i] = Object.assign({}, n[i], patch); setD({ conds: n }, extra); };

    // Comboboxes: a popover on desktop, a drawer on phone.
    var allCombos = {};
    var combo = function (key, cfg) {
      var open = s.combo === key;
      var ql = open ? (s.cq || '').trim().toLowerCase() : '';
      var items = [], lastGroup = null;
      cfg.options.forEach(function (o) {
        if (ql && o.label.toLowerCase().indexOf(ql) === -1) return;
        if (o.group && o.group !== lastGroup) { items.push({ head: true, isOpt: false, label: o.group, sub: '', hasSub: false, check: '0', aria: 'false', pick: null }); lastGroup = o.group; }
        var on = cfg.multi ? cfg.current.indexOf(o.v) !== -1 : cfg.current === o.v;
        items.push({ head: false, isOpt: true, label: o.label, sub: o.sub || '', hasSub: Boolean(o.sub), check: on ? '1' : '0', aria: on ? 'true' : 'false', pick: function () { cfg.onPick(o.v, on); } });
      });
      var cur = cfg.multi ? null : cfg.options.filter(function (o) { return o.v === cfg.current; })[0];
      var obj = {
        open: open, aria: open ? 'true' : 'false', title: cfg.title, ph: cfg.ph || 'Search', empty: cfg.empty || 'Nothing found.',
        query: open ? (s.cq || '') : '', none: items.length === 0, items: items, multi: cfg.multi ? 'true' : 'false', isMulti: Boolean(cfg.multi),
        doneText: cfg.multi ? 'Done · ' + cfg.current.length + ' chosen' : 'Done',
        display: cur ? cur.label : (cfg.placeholder || 'Choose…'), color: cur ? 'var(--foreground)' : 'var(--muted-foreground)',
        toggle: function () { up({ combo: open ? null : key, cq: '', addCond: false }); },
        onQuery: function (e) { up({ cq: e.target.value }); }
      };
      allCombos[key] = obj;
      return obj;
    };
    var itemOptions = [];
    ITEM_GROUPS.forEach(function (g) { g.items.forEach(function (it) { itemOptions.push({ v: it[0], label: it[1], group: g.g }); }); });
    var toggleIn = function (list, v, on) { return on ? list.filter(function (x) { return x !== v; }) : list.concat([v]); };
    var chipsOf = function (list, nameOf, onRemove) {
      return list.map(function (v) { return { label: nameOf(v), removeAria: 'Remove ' + nameOf(v), remove: function () { onRemove(v); } }; });
    };
    var selector = function (key, title, field) {
      var cur = d[field];
      return {
        combo: combo(key, { title: title, ph: 'Search categories, collections, products', multi: true, current: cur, options: itemOptions, onPick: function (v, on) { var p = {}; p[field] = toggleIn(cur, v, on); setD(p); } }),
        chips: chipsOf(cur, itemName, function (v) { var p = {}; p[field] = cur.filter(function (x) { return x !== v; }); setD(p); }),
        none: cur.length === 0
      };
    };

    // Problems, shown once they try to save.
    var pc = num(d.percent), am = num(d.amount);
    var problems = {};
    if (!d.titleBn.trim() && !d.titleEn.trim()) problems.title = 'Give it a title in at least one language.';
    if (d.kind === 'code' && d.code && !/^[A-Za-z0-9_-]{3,32}$/.test(d.code)) problems.code = 'Use 3 to 32 letters, digits, - or _.';
    if (PERCENT_ACTIONS.indexOf(d.action) !== -1 && !(pc >= 0.01 && pc <= 100)) problems.percent = 'Enter a percentage from 0.01 to 100.';
    if (AMOUNT_ACTIONS.indexOf(d.action) !== -1 && !(am > 0)) problems.amount = 'Enter an amount.';
    if ((d.action === 'percent_off_items' || d.action === 'amount_off_items') && !d.target.length) problems.target = 'Choose at least one item.';
    if (d.action === 'buy_x_get_y' && (!num(d.buyQty) || !d.buyItems.length)) problems.buy = 'Enter how many to buy, and choose the items.';
    if (d.action === 'buy_x_get_y' && (!num(d.getQty) || (!d.getSame && !d.getItems.length))) problems.get = 'Enter how many they get, and choose the items.';
    if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) problems.dates = 'It must end after it starts.';
    var tried = Boolean(s.tried);
    vals.pr = {};
    ['title', 'code', 'percent', 'amount', 'target', 'buy', 'get', 'dates'].forEach(function (k) { vals.pr[k] = tried && problems[k] ? problems[k] : ''; vals.pr['has' + k] = Boolean(tried && problems[k]); });
    var problemCount = Object.keys(problems).length;
    vals.showProblems = tried && problemCount > 0;
    vals.problemsText = 'Fix ' + (problemCount === 1 ? 'the highlighted field' : 'the ' + problemCount + ' highlighted fields') + ' to save.';

    // Header: title, state and status.
    var state = stateOf(d), ss = STATE_STYLE[state];
    var stOpen = Boolean(s.stOpen);
    vals.hd = {
      title: isNew ? (d.titleEn || d.titleBn || 'New promotion') : title(d), isExisting: !isNew,
      state: ss.label, sBg: ss.bg, sFg: ss.fg, sEdge: ss.edge || 'transparent',
      stOpen: stOpen, stAria: stOpen ? 'true' : 'false', toggleSt: function () { up({ stOpen: !stOpen }); },
      statuses: STATUSES.map(function (o) {
        var on = d.status === o.v;
        return { label: o.label, sub: o.sub, check: on ? '1' : '0', aria: on ? 'true' : 'false', pick: function () { setD({ status: o.v }, { stOpen: false }); } };
      }),
      stButtonAria: 'Status: ' + ss.label
    };
    var limit = num(saved.usageLimit);
    vals.stats = [
      { label: 'Uses', value: limit ? saved.uses.toLocaleString('en-US') + ' / ' + limit.toLocaleString('en-US') : saved.uses.toLocaleString('en-US') },
      { label: 'Orders', value: saved.orders.toLocaleString('en-US') },
      { label: 'Discount given', value: money(saved.discount) },
      { label: 'Sales', value: money(saved.sales) }
    ];
    vals.summary = summary(d);

    // Name and type.
    var multi = Boolean(d.titleEn) || Boolean(s.addedEn) || !isNew;
    var lang = multi && s.lang === 'en' ? 'en' : (multi && !s.lang && !isNew ? 'en' : 'bn');
    if (s.lang === 'bn') lang = 'bn';
    vals.nm = {
      single: !multi, multi: multi, lang: lang, bnSel: lang === 'bn' ? 'true' : 'false', enSel: lang === 'en' ? 'true' : 'false',
      pickBn: function () { up({ lang: 'bn' }); }, pickEn: function () { up({ lang: 'en' }); }, addEn: function () { up({ addedEn: true, lang: 'en' }); },
      value: lang === 'bn' ? d.titleBn : d.titleEn, ph: lang === 'bn' ? 'যেমন: ঈদে ১০% ছাড়' : 'For example: Eid 10% off',
      onTitle: function (e) { setD(lang === 'bn' ? { titleBn: e.target.value } : { titleEn: e.target.value }); },
      isAuto: d.kind !== 'code', isCode: d.kind === 'code', autoAria: d.kind !== 'code' ? 'true' : 'false', codeAria: d.kind === 'code' ? 'true' : 'false',
      kindLocked: !isNew, kindNote: !isNew ? 'The type can’t change once it’s created.' : '',
      pickAuto: function () { if (isNew) setD({ kind: 'automatic' }); }, pickCode: function () { if (isNew) setD({ kind: 'code' }); },
      code: d.code, onCode: function (e) { setD({ code: e.target.value.toUpperCase().replace(/\s/g, '') }); },
      makeCode: function () { setD({ code: ((d.titleEn || 'SAVE').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'SAVE') + (pc && PERCENT_ACTIONS.indexOf(d.action) !== -1 ? Math.round(pc) : am ? Math.round(am) : '10') }); }
    };

    // Discount.
    vals.act = combo('action', { title: 'What it gives', ph: 'Search', current: d.action, options: ACTIONS, onPick: function (v) { setD({ action: v }, { combo: null }); } });
    vals.ds = {
      isPercent: PERCENT_ACTIONS.indexOf(d.action) !== -1 && d.action !== 'buy_x_get_y', isAmount: AMOUNT_ACTIONS.indexOf(d.action) !== -1,
      isItems: d.action === 'percent_off_items' || d.action === 'amount_off_items', isBxgy: d.action === 'buy_x_get_y',
      isDelivery: d.action === 'delivery_percent_off', percent: d.percent, onPercent: function (e) { setD({ percent: e.target.value }); },
      percentLabel: d.action === 'delivery_percent_off' ? 'Percent off delivery' : 'Percent off',
      amount: d.amount, onAmount: function (e) { setD({ amount: e.target.value }); },
      amountLabel: d.action === 'amount_off_items' ? 'Amount off each item' : d.action === 'delivery_amount_off' ? 'Amount off delivery' : 'Amount off',
      freeOn: d.action === 'delivery_percent_off' && pc === 100 ? 'true' : 'false', makeFree: function () { setD({ percent: '100' }); },
      buyQty: d.buyQty, onBuyQty: function (e) { setD({ buyQty: e.target.value }); },
      getQty: d.getQty, onGetQty: function (e) { setD({ getQty: e.target.value }); },
      getSameAria: d.getSame ? 'true' : 'false', getSameBg: d.getSame ? 'var(--primary)' : 'var(--input)', getSameX: d.getSame ? '14px' : '0px',
      toggleGetSame: function () { setD({ getSame: !d.getSame }); }, getOther: !d.getSame,
      maxUses: d.maxUses, onMaxUses: function (e) { setD({ maxUses: e.target.value }); }
    };
    vals.target = selector('target', 'Which items', 'target');
    vals.buyItems = selector('buy', 'Of these items', 'buyItems');
    vals.getItems = selector('get', 'Get these items', 'getItems');

    // Who gets it: conditions are added one at a time.
    var present = d.conds.map(function (c) { return c.type; });
    vals.conds = d.conds.map(function (c, i) {
      var t = COND_TYPES.filter(function (x) { return x.v === c.type; })[0];
      var o = {
        type: c.type, label: t.label, notFirst: i > 0, removeAria: 'Remove ' + t.label.toLowerCase(),
        remove: function () { setD({ conds: d.conds.filter(function (_, j) { return j !== i; }) }); },
        isMinSub: c.type === 'min_subtotal', isMinQty: c.type === 'min_quantity', isItems: c.type === 'items', isZones: c.type === 'zones',
        isFirst: c.type === 'first_order', isTags: c.type === 'tags', isPhones: c.type === 'phones', isPayment: c.type === 'payment',
        value: c.value || '', onValue: function (e) { setCond(i, { value: e.target.value }); },
        text: c.text || '', onText: function (e) { setCond(i, { text: e.target.value }); },
        phoneCount: (function () { var n = String(c.text || '').split('\n').filter(function (x) { return x.trim(); }).length; return n ? plural(n, 'phone', 'phones') + '. One per line.' : 'One per line.'; })()
      };
      if (c.type === 'items') {
        var cur = c.items || [];
        o.combo = combo('c' + i, { title: 'The cart holds one of these', ph: 'Search categories, collections, products', multi: true, current: cur, options: itemOptions, onPick: function (v, on) { setCond(i, { items: toggleIn(cur, v, on) }); } });
        o.chips = chipsOf(cur, itemName, function (v) { setCond(i, { items: cur.filter(function (x) { return x !== v; }) }); });
      } else if (c.type === 'zones') {
        var zs = c.ids || [];
        var zName = function (v) { return ZONES.filter(function (z) { return z[0] === v; })[0][1]; };
        o.combo = combo('c' + i, { title: 'Delivery zones', ph: 'Search zones', multi: true, current: zs, options: ZONES.map(function (z) { return { v: z[0], label: z[1] }; }), onPick: function (v, on) { setCond(i, { ids: toggleIn(zs, v, on) }); } });
        o.chips = chipsOf(zs, zName, function (v) { setCond(i, { ids: zs.filter(function (x) { return x !== v; }) }); });
      } else if (c.type === 'tags') {
        var ts = c.tags || [];
        o.combo = combo('c' + i, { title: 'Customers tagged', ph: 'Search tags', multi: true, current: ts, options: TAGS.map(function (t2) { return { v: t2, label: t2 }; }), onPick: function (v, on) { setCond(i, { tags: toggleIn(ts, v, on) }); } });
        o.chips = chipsOf(ts, function (v) { return v; }, function (v) { setCond(i, { tags: ts.filter(function (x) { return x !== v; }) }); });
      } else {
        o.combo = { open: false, aria: 'false', toggle: null, items: [] };
        o.chips = [];
      }
      var ms = c.methods || [];
      o.methods = PAYMENTS.map(function (m) {
        var on = ms.indexOf(m[0]) !== -1;
        return { label: m[1], aria: on ? 'true' : 'false', on: on, box: on ? 'var(--primary)' : 'transparent', edge: on ? 'var(--primary)' : 'var(--input)', toggle: function () { setCond(i, { methods: toggleIn(ms, m[0], on) }); } };
      });
      o.noChips = o.chips.length === 0;
      return o;
    });
    vals.noConds = d.conds.length === 0;
    vals.hasConds = d.conds.length > 0;
    var addOpen = Boolean(s.addCond);
    vals.add = {
      open: addOpen, aria: addOpen ? 'true' : 'false', toggle: function () { up({ addCond: !addOpen, combo: null }); },
      items: COND_TYPES.filter(function (t) { return present.indexOf(t.v) === -1; }).map(function (t) {
        return {
          label: t.label, sub: t.sub,
          pick: function () {
            var c = { type: t.v };
            if (t.v === 'min_subtotal' || t.v === 'min_quantity') c.value = '';
            if (t.v === 'items') c.items = [];
            if (t.v === 'zones') c.ids = [];
            if (t.v === 'tags') c.tags = [];
            if (t.v === 'payment') c.methods = ['cod'];
            if (t.v === 'phones') c.text = '';
            var extra = { addCond: false };
            if (t.v === 'items' || t.v === 'zones' || t.v === 'tags') { extra.combo = 'c' + d.conds.length; extra.cq = ''; }
            setD({ conds: d.conds.concat([c]) }, extra);
          }
        };
      }),
      full: present.length === COND_TYPES.length
    };

    // Dates and limits.
    var moreOpen = Boolean(s.moreLimits) || Boolean(d.maxDiscount) || d.exclusive || (num(d.priority) || 0) !== 0;
    var exSw = d.exclusive;
    vals.lm = {
      startsAt: d.startsAt, onStarts: function (e) { setD({ startsAt: e.target.value }); },
      endsAt: d.endsAt, onEnds: function (e) { setD({ endsAt: e.target.value }); },
      usageLimit: d.usageLimit, onUsage: function (e) { setD({ usageLimit: e.target.value }); },
      perCustomer: d.perCustomer, onPer: function (e) { setD({ perCustomer: e.target.value }); },
      maxDiscount: d.maxDiscount, onMax: function (e) { setD({ maxDiscount: e.target.value }); },
      priority: d.priority, onPriority: function (e) { setD({ priority: e.target.value }); },
      moreOpen: moreOpen, moreAria: moreOpen ? 'true' : 'false', toggleMore: function () { up({ moreLimits: !moreOpen }); },
      exAria: exSw ? 'true' : 'false', exBg: exSw ? 'var(--primary)' : 'var(--input)', exX: exSw ? '14px' : '0px', toggleEx: function () { setD({ exclusive: !d.exclusive }); }
    };

    // Codes.
    vals.codes = {
      show: d.kind === 'code', existing: !isNew, isNew: isNew,
      text: saved.codeCount ? plural(saved.codeCount, 'generated code', 'generated codes') + ' · ' + saved.codesUsed + ' used' : 'No generated codes yet.',
      canExport: saved.codeCount > 0,
      exportCodes: function () { up({ toast: toast('Exported ' + plural(saved.codeCount, 'code', 'codes') + ' with their uses.') }); },
      openGen: function () { up({ gen: true }); }
    };
    var gc = s.gc === undefined ? '100' : s.gc, gp = s.gp || '', gu = s.gu === undefined ? '1' : s.gu;
    var gOk = Number.isInteger(Number(gc)) && Number(gc) >= 1 && Number(gc) <= 5000 && /^[A-Za-z0-9]{0,10}$/.test(gp) && Number.isInteger(Number(gu)) && Number(gu) >= 1;
    vals.gen = {
      open: Boolean(s.gen), count: gc, onCount: function (e) { up({ gc: e.target.value }); },
      prefix: gp, onPrefix: function (e) { up({ gp: e.target.value.toUpperCase() }); },
      uses: gu, onUses: function (e) { up({ gu: e.target.value }); },
      sample: 'Like ' + (gp || '') + 'K7Q2M9', bad: !gOk, ok: gOk,
      go: function () {
        if (!gOk) return;
        up({ gen: false, saved: Object.assign({}, saved, { codeCount: saved.codeCount + Number(gc) }), toast: toast(Number(gc).toLocaleString('en-US') + ' codes made and downloaded.') });
      },
      close: function () { up({ gen: false }); }
    };

    // Test cart: this promotion tried as if it were live, with the live ones.
    var tcOpen = Boolean(s.tc);
    var lines = s.tcLines || [{ id: 'p1', qty: 1 }, { id: 'p2', qty: 1 }];
    var areaName = s.tcArea || AREAS[0][0];
    var area = AREAS.filter(function (a) { return a[0] === areaName; })[0];
    var pay = s.tcPay || 'cod';
    var phone = (s.tcPhone || '').replace(/[^0-9]/g, '').replace(/^880/, '0');
    var code = s.tcCode === undefined ? (d.code || '') : s.tcCode;
    var cartLines = lines.map(function (l) { var p = TC_PRODUCTS.filter(function (x) { return x.id === l.id; })[0]; return Object.assign({ qty: l.qty }, p); });
    var subtotal = cartLines.reduce(function (a, l) { return a + l.price * l.qty; }, 0);
    var cart = {
      lines: cartLines, subtotal: subtotal, qty: cartLines.reduce(function (a, l) { return a + l.qty; }, 0), zone: area[1], fee: FEES[area[1]], pay: pay,
      phone: phone, code: code, customer: KNOWN[phone] || { tags: [], first: true }
    };
    var others = PROMOS.filter(function (p) { return p.id !== d.id && stateOf(p) === 'live' && (p.kind !== 'code' || (code && p.code && p.code.toUpperCase() === code.trim().toUpperCase())); });
    var results = [{ p: d, mine: true }].concat(others.map(function (p) { return { p: p, mine: false }; })).map(function (r) {
      var e = cartLines.length ? evaluate(r.p, cart, r.mine) : { applied: false, reason: '' };
      return { name: r.mine ? (title(r.p) === 'Untitled promotion' ? 'This promotion' : title(r.p)) + ' (this one)' : title(r.p), mine: r.mine, applied: e.applied, amount: e.applied ? '−' + money(e.amount) : 'Not applied', reason: e.reason || '', hasReason: !e.applied && Boolean(e.reason), color: e.applied ? 'var(--success)' : 'var(--muted-foreground)', delivery: e.delivery, value: e.applied ? e.amount : 0 };
    });
    var itemOff = results.filter(function (r) { return r.applied && !r.delivery; }).reduce(function (a, r) { return a + r.value; }, 0);
    var delOff = Math.min(cart.fee, results.filter(function (r) { return r.applied && r.delivery; }).reduce(function (a, r) { return a + r.value; }, 0));
    var setLines = function (n) { up({ tcLines: n }); };
    vals.tc = {
      open: tcOpen, aria: tcOpen ? 'true' : 'false', toggle: function () { up({ tc: !tcOpen }); },
      lines: cartLines.map(function (l, i) {
        return {
          name: l.name, price: money(l.price * l.qty), qty: String(l.qty), minusAria: 'One fewer ' + l.name, plusAria: 'One more ' + l.name, removeAria: 'Remove ' + l.name,
          minus: function () { var n = lines.slice(); n[i] = { id: l.id, qty: Math.max(1, l.qty - 1) }; setLines(n); },
          plus: function () { var n = lines.slice(); n[i] = { id: l.id, qty: l.qty + 1 }; setLines(n); },
          remove: function () { setLines(lines.filter(function (_, j) { return j !== i; })); }
        };
      }),
      hasLines: cartLines.length > 0, noLines: cartLines.length === 0,
      product: combo('tcp', { title: 'Add a product', ph: 'Search products', current: '', placeholder: 'Add a product…', options: TC_PRODUCTS.map(function (p) { return { v: p.id, label: p.name, sub: money(p.price) }; }), onPick: function (v) { var has = lines.filter(function (l) { return l.id === v; })[0]; up({ tcLines: has ? lines.map(function (l) { return l.id === v ? { id: v, qty: l.qty + 1 } : l; }) : lines.concat([{ id: v, qty: 1 }]), combo: null }); } }),
      area: combo('tca', { title: 'Delivery area', ph: 'Search areas', current: areaName, options: AREAS.map(function (a) { return { v: a[0], label: a[0], sub: ZONES.filter(function (z) { return z[0] === a[1]; })[0][1] }; }), onPick: function (v) { up({ tcArea: v, combo: null }); } }),
      pays: PAYMENTS.map(function (m) { return { label: m[1], on: pay === m[0] ? 'true' : 'false', pick: function () { up({ tcPay: m[0] }); } }; }),
      phone: s.tcPhone || '', onPhone: function (e) { up({ tcPhone: e.target.value }); },
      code: code, onCode: function (e) { up({ tcCode: e.target.value.toUpperCase() }); },
      who: KNOWN[phone] ? KNOWN[phone].name + ' · tagged ' + KNOWN[phone].tags.join(', ') : phone.length === 11 ? 'A new customer' : '',
      hasWho: Boolean(KNOWN[phone]) || phone.length === 11,
      results: results, emptyText: 'Add a product to try it.',
      subtotal: money(subtotal), discount: itemOff ? '−' + money(itemOff) : money(0), hasDiscount: itemOff > 0,
      delivery: delOff ? money(cart.fee - delOff) + ' (was ' + money(cart.fee) + ')' : money(cart.fee),
      total: money(subtotal - itemOff + cart.fee - delOff)
    };

    var active = allCombos[s.combo] || null;
    vals.comboOpen = Boolean(active);
    vals.cbd = active || vals.act;
    vals.closeCombo = function () { up({ combo: null }); };
    vals.comboEsc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); up({ combo: null }); } };

    // Saving.
    vals.bar = {
      show: isNew || Boolean(s.dirty), label: isNew ? 'New promotion' : 'Unsaved changes',
      cancel: isNew ? 'Cancel' : 'Discard', save: isNew ? 'Create promotion' : 'Save'
    };
    vals.discard = function () { if (isNew) up({ draft: null, dirty: false, tried: false }); else up({ draft: null, dirty: false, tried: false, combo: null }); };
    vals.save = function () {
      if (problemCount) { up({ tried: true, combo: null }); return; }
      up({ saved: Object.assign({}, d, { id: isNew ? 'new1' : d.id }), pid: isNew ? 'new1' : pid, draft: null, dirty: false, tried: false, combo: null, toast: toast(isNew ? 'Promotion created.' : 'Promotion saved.') });
    };
    vals.more = { open: Boolean(s.more), toggle: function () { up({ more: !s.more }); } };
    vals.copyCode = function () { up({ more: false, toast: toast(d.code ? 'Code ' + d.code + ' copied.' : 'No shared code to copy.') }); };
    vals.endNow = function () { setD({ status: 'ended' }, { more: false }); };

    var reset = { combo: null, addCond: false, stOpen: false, gen: false, more: false };
    vals.closeAll = function () { up(reset); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(reset); } };
    vals.hasToast = Boolean(s.toast);
    vals.toastText = s.toast || '';

    var dark = typeof s.dark === 'boolean' ? s.dark : (this.props.dark ?? false);
    vals.themeClass = ROOT + (dark ? ' dark' : '');
    vals.fontStack = FONTS[this.props.font ?? 'Inter'] || FONTS.Inter;
    vals.isDark = dark;
    vals.isLight = !dark;
    vals.themeLabel = dark ? 'Switch to light theme' : 'Switch to dark theme';
    vals.toggleTheme = function () { up({ dark: !dark }); };
    return vals;
  }
}
