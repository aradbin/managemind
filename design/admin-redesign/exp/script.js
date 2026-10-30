var TODAY = '2026-10-29';
var SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
};
var METHODS = [['cash', 'Cash'], ['bank', 'Bank'], ['bkash', 'bKash'], ['nagad', 'Nagad'], ['card', 'Card'], ['other', 'Other']];
var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var CATS = [
  { id: 'rent', en: 'Rent', bn: 'ভাড়া', slot: 0, archived: false },
  { id: 'salaries', en: 'Salaries', bn: 'বেতন', slot: 1, archived: false },
  { id: 'ads', en: 'Facebook ads', bn: 'ফেসবুক বিজ্ঞাপন', slot: 2, archived: false },
  { id: 'courier', en: 'Courier', bn: 'কুরিয়ার', slot: 3, archived: false },
  { id: 'packaging', en: 'Packaging', bn: 'প্যাকেজিং', slot: 4, archived: false },
  { id: 'utilities', en: 'Utilities', bn: 'বিল', slot: 5, archived: false },
  { id: 'other', en: 'Other', bn: 'অন্যান্য', slot: 6, archived: false },
  { id: 'photo', en: 'Photography', bn: 'ফটোগ্রাফি', slot: 7, archived: true }
];
var n = 0;
function E(date, cat, payee, method, amount, o) { n++; return Object.assign({ id: 'e' + n, date: date, cat: cat, payee: payee, method: method, amount: amount, note: '', receipt: '', rec: '' }, o || {}); }
var EXPENSES = [
  E('2026-10-28', 'utilities', 'Water bill — WASA', 'bkash', 900, { receipt: 'wasa-oct.jpg' }),
  E('2026-10-27', 'other', 'Stationery', 'cash', 680, { note: 'Invoice paper and pens' }),
  E('2026-10-25', 'ads', 'Meta', 'card', 12400, { note: 'Winter launch boost. $103 on the card statement.', receipt: 'meta-1025.png' }),
  E('2026-10-22', 'courier', 'Pathao', 'nagad', 8920),
  E('2026-10-20', 'packaging', 'Poly bags', 'cash', 2300, { receipt: 'polybags.jpg' }),
  E('2026-10-18', 'other', 'Tea and snacks', 'cash', 1240),
  E('2026-10-15', 'utilities', 'Internet — Link3', 'bkash', 1500, { rec: 'r3' }),
  E('2026-10-12', 'ads', 'Meta', 'card', 9800, { receipt: 'meta-1012.png' }),
  E('2026-10-09', 'courier', 'Steadfast', 'bank', 12640, { note: 'September COD charges' }),
  E('2026-10-07', 'utilities', 'Electricity — DESCO', 'bkash', 3850, { receipt: 'desco-oct.jpg' }),
  E('2026-10-05', 'packaging', 'Dhaka Packaging House', 'cash', 6200, { receipt: 'dph-1005.jpg' }),
  E('2026-10-03', 'ads', 'Meta', 'card', 18500, { note: 'Eid campaign boost. $155 on the card statement.', receipt: 'meta-1003.png' }),
  E('2026-10-01', 'salaries', 'Staff salaries (3)', 'bank', 54000, { rec: 'r2' }),
  E('2026-10-01', 'rent', 'Landlord — Mr. Karim', 'bank', 45000, { rec: 'r1', receipt: 'rent-oct.jpg' }),
  E('2026-09-27', 'ads', 'Meta', 'card', 15200),
  E('2026-09-21', 'courier', 'Steadfast', 'bank', 10980),
  E('2026-09-15', 'utilities', 'Internet — Link3', 'bkash', 1500, { rec: 'r3' }),
  E('2026-09-12', 'packaging', 'Dhaka Packaging House', 'cash', 5400),
  E('2026-09-08', 'utilities', 'Electricity — DESCO', 'bkash', 4120),
  E('2026-09-05', 'ads', 'Meta', 'card', 21300),
  E('2026-09-01', 'salaries', 'Staff salaries (3)', 'bank', 54000, { rec: 'r2' }),
  E('2026-09-01', 'rent', 'Landlord — Mr. Karim', 'bank', 45000, { rec: 'r1' }),
  E('2026-09-14', 'photo', 'Studio Aloha', 'bkash', 7500)
];
var RECURRING = [
  { id: 'r1', cat: 'rent', payee: 'Landlord — Mr. Karim', method: 'bank', amount: 45000, cadence: 'monthly', day: 1, startsOn: '2025-01-01', endsOn: '', active: true },
  { id: 'r2', cat: 'salaries', payee: 'Staff salaries (3)', method: 'bank', amount: 54000, cadence: 'monthly', day: 1, startsOn: '2025-06-01', endsOn: '', active: true },
  { id: 'r3', cat: 'utilities', payee: 'Internet — Link3', method: 'bkash', amount: 1500, cadence: 'monthly', day: 15, startsOn: '2025-03-15', endsOn: '', active: true },
  { id: 'r4', cat: 'other', payee: 'Cleaner', method: 'cash', amount: 500, cadence: 'weekly', day: 6, startsOn: '2026-02-07', endsOn: '', active: true },
  { id: 'r5', cat: 'ads', payee: 'Meta — always-on boost', method: 'card', amount: 5000, cadence: 'weekly', day: 1, startsOn: '2026-05-04', endsOn: '', active: false },
  { id: 'r6', cat: 'utilities', payee: 'Generator rent', method: 'cash', amount: 3000, cadence: 'monthly', day: 5, startsOn: '2026-04-05', endsOn: '2026-09-30', active: true }
];
var START = {
  Expenses: {}, 'Filtered by category': { fcat: 'ads' }, 'Record expense': { form: { kind: 'exp', id: 'new' } },
  'Edit expense': { form: { kind: 'exp', id: 'e14' } }, 'Category list': { form: { kind: 'exp', id: 'new' }, combo: 'cat' },
  'Delete expense': { confirm: { kind: 'exp', id: 'e3' } }, 'Previous month': { month: '2026-09' },
  Recurring: { tab: 'recurring' }, 'New recurring': { tab: 'recurring', form: { kind: 'rec', id: 'new' } }, 'Edit recurring': { tab: 'recurring', form: { kind: 'rec', id: 'r4' } },
  Categories: { tab: 'categories' }, 'Edit category': { tab: 'categories', catForm: 'ads' }, 'Add category': { tab: 'categories', catForm: 'new' }, 'Row actions': { menu: 'e3' }
};
var FONTS = {
  Inter: "'Inter', 'Noto Sans Bengali', system-ui, sans-serif",
  Geist: "'Geist', 'Noto Sans Bengali', system-ui, sans-serif"
};
function copy(x) { return JSON.parse(JSON.stringify(x)); }
function money(v) { return '৳' + Math.round(Number(v) || 0).toLocaleString('en-US'); }
function plural(x, one, many) { return Number(x).toLocaleString('en-US') + ' ' + (x === 1 ? one : many); }
function num(x) { var v = parseFloat(String(x).replace(/,/g, '')); return isNaN(v) ? null : v; }
function dt(s) { return new Date(s + 'T00:00:00Z'); }
function iso(d) { return d.toISOString().slice(0, 10); }
function addDays(s, k) { var d = dt(s); d.setUTCDate(d.getUTCDate() + k); return iso(d); }
function weekday(s) { var w = dt(s).getUTCDay(); return w === 0 ? 7 : w; }
function short(s) { return MONTHS[Number(s.slice(5, 7)) - 1].slice(0, 3) + ' ' + Number(s.slice(8, 10)); }
function dayLabel(s) { return WEEKDAYS[weekday(s) - 1] + ', ' + short(s); }
function monthName(m) { return MONTHS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4); }
function shiftMonth(m, by) { var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 1 + by; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return y + '-' + String(mo + 1).padStart(2, '0'); }
function lastDay(m) { var d = dt(shiftMonth(m, 1) + '-01'); d.setUTCDate(0); return iso(d); }
function methodLabel(v) { return (METHODS.filter(function (m) { return m[0] === v; })[0] || METHODS[5])[1]; }
function nextOn(r) {
  if (!r.active) return null;
  var next;
  if (r.cadence === 'weekly') {
    var k = (r.day - weekday(TODAY) + 7) % 7 || 7;
    next = addDays(TODAY, k);
  } else {
    var m = TODAY.slice(0, 7);
    var inMonth = function (mm) { return r.day === 0 ? lastDay(mm) : mm + '-' + String(r.day).padStart(2, '0'); };
    next = inMonth(m) > TODAY ? inMonth(m) : inMonth(shiftMonth(m, 1));
  }
  if (r.startsOn && next < r.startsOn) next = r.startsOn;
  if (r.endsOn && next > r.endsOn) return null;
  return next;
}
function schedule(r) {
  if (r.cadence === 'weekly') return 'Every ' + WEEKDAYS_LONG[r.day - 1];
  return r.day === 0 ? 'Monthly on the last day' : 'Monthly, on day ' + r.day;
}

class Component extends DCLogic {
  renderVals() {
    var self = this;
    var startKey = this.props.startOn ?? 'Expenses';
    var s = this.state || {};
    if (s.started !== startKey) s = Object.assign({ started: startKey, dark: s.dark }, copy(START[startKey] || {}));
    var up = function (patch) { self.setState(Object.assign({}, s, patch, { started: startKey })); };
    var toast = function (text) {
      clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function () { self.setState({ toast: null }); }, 4000);
      return text;
    };
    var vals = {};
    var dark = typeof s.dark === 'boolean' ? s.dark : (this.props.dark ?? false);
    var series = SERIES[dark ? 'dark' : 'light'];
    var cats = s.cats || CATS;
    var exps = s.exps || EXPENSES;
    var recs = s.recs || RECURRING;
    var catById = function (id) { return cats.filter(function (c) { return c.id === id; })[0] || cats[cats.length - 1]; };
    var colorOf = function (id) { return series[catById(id).slot % series.length]; };
    var tab = s.tab || 'entries';
    vals.tabs = [['entries', 'Expenses'], ['recurring', 'Recurring'], ['categories', 'Categories']].map(function (t) {
      return { label: t[1], on: tab === t[0] ? 'true' : 'false', pick: function () { up({ tab: t[0], menu: null, pop: null }); } };
    });
    vals.isEntries = tab === 'entries'; vals.isRecurring = tab === 'recurring'; vals.isCategories = tab === 'categories';
    vals.primaryText = tab === 'recurring' ? 'New recurring expense' : tab === 'categories' ? 'New category' : 'Record expense';
    vals.primaryShort = tab === 'recurring' ? 'New' : tab === 'categories' ? 'New' : 'Record';
    vals.primary = function () {
      if (tab === 'recurring') up({ form: { kind: 'rec', id: 'new' }, fd: null });
      else if (tab === 'categories') up({ catForm: 'new', cn: null, clang: 'bn' });
      else up({ form: { kind: 'exp', id: 'new' }, fd: null });
    };

    // A month of expenses, with the category totals.
    var month = s.month || TODAY.slice(0, 7);
    var inMonth = exps.filter(function (e) { return e.date.slice(0, 7) === month; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var total = inMonth.reduce(function (a, e) { return a + e.amount; }, 0);
    var prevTotal = exps.filter(function (e) { return e.date.slice(0, 7) === shiftMonth(month, -1); }).reduce(function (a, e) { return a + e.amount; }, 0);
    var byCat = {};
    inMonth.forEach(function (e) { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; });
    var catOrder = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    var fcat = s.fcat || '';
    var q = (s.q || '').trim().toLowerCase();
    vals.mo = {
      label: monthName(month), prev: function () { up({ month: shiftMonth(month, -1), fcat: '', hover: null }); },
      next: function () { up({ month: shiftMonth(month, 1), fcat: '', hover: null }); },
      isFuture: month >= TODAY.slice(0, 7), notCurrent: month !== TODAY.slice(0, 7), toToday: function () { up({ month: TODAY.slice(0, 7), fcat: '' }); },
      prevAria: 'Previous month, ' + monthName(shiftMonth(month, -1)), nextAria: 'Next month, ' + monthName(shiftMonth(month, 1))
    };
    var diff = total - prevTotal;
    vals.sum = {
      has: total > 0, none: total === 0, total: money(total), count: plural(inMonth.length, 'expense', 'expenses'),
      vs: prevTotal ? money(Math.abs(diff)) + (diff > 0 ? ' more than ' : diff < 0 ? ' less than ' : ' same as ') + MONTHS[Number(shiftMonth(month, -1).slice(5, 7)) - 1] : '',
      hasVs: prevTotal > 0,
      bars: catOrder.map(function (id) {
        var c = catById(id), pct = byCat[id] / total * 100;
        return {
          id: id, color: colorOf(id), width: pct.toFixed(2) + '%', tip: c.en + ': ' + money(byCat[id]) + ' (' + Math.round(pct) + '%)',
          hover: function () { up({ hover: id }); }, leave: function () { if (s.hover === id) up({ hover: null }); },
          pick: function () { up({ fcat: fcat === id ? '' : id }); },
          dim: fcat && fcat !== id ? '.35' : '1'
        };
      }),
      legend: catOrder.map(function (id) {
        var c = catById(id), pct = byCat[id] / total * 100, on = fcat === id;
        return {
          name: c.en, amount: money(byCat[id]), pct: Math.round(pct) + '%', color: colorOf(id), on: on ? 'true' : 'false',
          aria: (on ? 'Show all categories' : 'Show only ' + c.en) + ', ' + money(byCat[id]),
          pick: function () { up({ fcat: on ? '' : id }); }, dim: fcat && !on ? '.5' : '1'
        };
      })
    };
    var hov = s.hover && byCat[s.hover] ? s.hover : '';
    vals.tip = { show: Boolean(hov), text: hov ? catById(hov).en + ' · ' + money(byCat[hov]) + ' · ' + Math.round(byCat[hov] / total * 100) + '% of the month' : '' };
    var shown = inMonth.filter(function (e) {
      return (!fcat || e.cat === fcat) && (!q || e.payee.toLowerCase().indexOf(q) !== -1 || e.note.toLowerCase().indexOf(q) !== -1 || catById(e.cat).en.toLowerCase().indexOf(q) !== -1);
    });
    var rowOf = function (e) {
      var c = catById(e.cat), menuOpen = s.menu === e.id;
      return {
        date: short(e.date), cat: c.en, color: colorOf(e.cat), isRec: Boolean(e.rec), payee: e.payee || '—', note: e.note, hasNote: Boolean(e.note),
        method: methodLabel(e.method), hasReceipt: Boolean(e.receipt), receiptAria: 'View the receipt for ' + c.en + ', ' + short(e.date),
        amount: money(e.amount), title: c.en + ' · ' + money(e.amount), meta: (e.payee || c.en) + ' · ' + methodLabel(e.method),
        aria: 'Edit ' + c.en + ', ' + (e.payee ? e.payee + ', ' : '') + money(e.amount) + ', ' + short(e.date),
        edit: function () { up({ form: { kind: 'exp', id: e.id }, fd: null, menu: null }); },
        viewReceipt: function () { up({ menu: null, toast: toast('Opened ' + e.receipt + ' in a new tab.') }); },
        menuOpen: menuOpen, menuExpanded: menuOpen ? 'true' : 'false', menuAria: 'Actions for ' + c.en + ', ' + short(e.date),
        toggleMenu: function () { up({ menu: menuOpen ? null : e.id }); },
        askDelete: function () { up({ menu: null, confirm: { kind: 'exp', id: e.id } }); }
      };
    };
    vals.rows = shown.map(rowOf);
    var days = [];
    shown.forEach(function (e) {
      var g = days.filter(function (d) { return d.date === e.date; })[0];
      if (!g) { g = { date: e.date, items: [] }; days.push(g); }
      g.items.push(e);
    });
    vals.days = days.map(function (g) {
      return { label: (g.date === TODAY ? 'Today · ' : g.date === addDays(TODAY, -1) ? 'Yesterday · ' : '') + dayLabel(g.date), total: money(g.items.reduce(function (a, e) { return a + e.amount; }, 0)), rows: g.items.map(rowOf) };
    });
    vals.noRows = shown.length === 0;
    vals.hasRows = shown.length > 0;
    vals.emptyText = inMonth.length ? 'No expenses match.' : 'No expenses in ' + monthName(month) + '.';
    vals.emptyAction = inMonth.length ? 'Reset filters' : 'Record expense';
    vals.emptyDo = function () { if (inMonth.length) up({ fcat: '', q: '' }); else vals.primary(); };
    vals.q = s.q || '';
    vals.onQ = function (e) { up({ q: e.target.value }); };
    var catPop = s.pop === 'cat';
    var fcq = catPop ? (s.fcq || '') : '';
    var fcl = fcq.trim().toLowerCase();
    var fcItems = cats.filter(function (c) { return (!c.archived || byCat[c.id]) && (!fcl || c.en.toLowerCase().indexOf(fcl) !== -1 || c.bn.indexOf(fcq.trim()) !== -1); });
    vals.cf = {
      open: catPop, aria: catPop ? 'true' : 'false', toggle: function () { up({ pop: catPop ? null : 'cat', fcq: '' }); },
      query: fcq, onQuery: function (e) { up({ fcq: e.target.value }); }, none: fcItems.length === 0, showAll: !fcl,
      has: Boolean(fcat), label: fcat ? catById(fcat).en : '', buttonText: fcat ? catById(fcat).en : 'Category',
      allCheck: fcat ? '0' : '1', allAria: fcat ? 'false' : 'true', pickAll: function () { up({ fcat: '', pop: null }); },
      items: fcItems.map(function (c) {
        var on = fcat === c.id;
        return { label: c.en, color: colorOf(c.id), count: byCat[c.id] ? money(byCat[c.id]) : '—', check: on ? '1' : '0', aria: on ? 'true' : 'false', pick: function () { up({ fcat: on ? '' : c.id, pop: null }); } };
      }),
      clear: function () { up({ fcat: '', pop: null }); }
    };
    vals.hasFilters = Boolean(fcat || q);
    vals.clearAll = function () { up({ fcat: '', q: '' }); };
    vals.filterText = shown.length === inMonth.length ? '' : plural(shown.length, 'expense', 'expenses') + ' · ' + money(shown.reduce(function (a, e) { return a + e.amount; }, 0));
    vals.hasFilterText = shown.length !== inMonth.length;
    var exOpen = s.pop === 'export';
    vals.ex = {
      open: exOpen, aria: exOpen ? 'true' : 'false', toggle: function () { up({ pop: exOpen ? null : 'export' }); }, can: inMonth.length > 0, cant: inMonth.length === 0,
      xlsx: function () { up({ pop: null, toast: toast('Exported ' + monthName(month) + ' to Excel.') }); },
      csv: function () { up({ pop: null, toast: toast('Exported ' + monthName(month) + ' to CSV.') }); }
    };
    var mOpen = s.menu ? exps.filter(function (e) { return e.id === s.menu; })[0] : null;
    vals.menuOpen = Boolean(mOpen) && tab === 'entries';
    vals.mx = rowOf(mOpen || exps[0]);

    // Comboboxes, a popover on desktop and a drawer on phone.
    var allCombos = {};
    var combo = function (key, cfg) {
      var open = s.combo === key;
      var ql = open ? (s.cq || '').trim().toLowerCase() : '';
      var opts = cfg.options.filter(function (o) { return !ql || o.label.toLowerCase().indexOf(ql) !== -1; });
      var cur = cfg.options.filter(function (o) { return o.v === cfg.current; })[0];
      var obj = {
        open: open, aria: open ? 'true' : 'false', title: cfg.title, ph: cfg.ph, empty: 'Nothing found.', query: open ? (s.cq || '') : '', none: opts.length === 0,
        display: cur ? cur.label : cfg.placeholder, color: cur ? 'var(--foreground)' : 'var(--muted-foreground)',
        dot: cur && cur.color ? cur.color : 'transparent', hasDot: Boolean(cur && cur.color),
        toggle: function () { up({ combo: open ? null : key, cq: '' }); },
        onQuery: function (e) { up({ cq: e.target.value }); },
        items: opts.map(function (o) {
          var on = o.v === cfg.current;
          return { label: o.label, sub: o.sub || '', hasSub: Boolean(o.sub), color: o.color || 'transparent', hasColor: Boolean(o.color), check: on ? '1' : '0', aria: on ? 'true' : 'false', pick: function () { cfg.onPick(o.v); } };
        })
      };
      allCombos[key] = obj;
      return obj;
    };
    var methodsFor = function (cur, set) {
      return METHODS.map(function (m) { return { label: m[1], on: cur === m[0] ? 'true' : 'false', pick: function () { set(m[0]); } }; });
    };
    var catOptions = function (cur) {
      return cats.filter(function (c) { return !c.archived || c.id === cur; }).map(function (c) { return { v: c.id, label: c.en, sub: c.bn, color: colorOf(c.id) }; });
    };

    // Record or edit an expense.
    var form = s.form || null;
    var fkey = JSON.stringify(form);
    var isExp = form && form.kind === 'exp';
    var editingE = isExp && form.id !== 'new' ? exps.filter(function (e) { return e.id === form.id; })[0] : null;
    var fd = isExp ? (s.fd && s.fdFor === fkey ? s.fd : (editingE
      ? Object.assign(copy(editingE), { amount: String(editingE.amount), tried: false })
      : { amount: '', cat: '', date: month === TODAY.slice(0, 7) ? TODAY : lastDay(month), method: 'cash', payee: '', note: '', receipt: '', tried: false })) : null;
    if (isExp) {
      var setF = function (patch, extra) { up(Object.assign({ fd: Object.assign({}, fd, patch), fdFor: fkey }, extra || {})); };
      var amt = num(fd.amount);
      var errs = { amount: !(amt > 0) ? 'Enter an amount in taka.' : '', cat: !fd.cat ? 'Choose a category.' : '', date: !fd.date ? 'Choose the date.' : '' };
      var ok = !errs.amount && !errs.cat && !errs.date;
      var recOf = editingE && editingE.rec ? recs.filter(function (r) { return r.id === editingE.rec; })[0] : null;
      var payees = [];
      exps.forEach(function (e) { if (fd.cat && e.cat === fd.cat && e.payee && payees.indexOf(e.payee) === -1 && e.payee !== fd.payee) payees.push(e.payee); });
      var saveExp = function (again) {
        if (!ok) { setF({ tried: true }); return; }
        var rec = { id: editingE ? editingE.id : 'n' + exps.length, date: fd.date, cat: fd.cat, payee: fd.payee.trim(), method: fd.method, amount: amt, note: fd.note.trim(), receipt: fd.receipt, rec: editingE ? editingE.rec : '' };
        var next = editingE ? exps.map(function (e) { return e.id === rec.id ? rec : e; }) : [rec].concat(exps);
        if (again) up({ exps: next, fd: Object.assign({}, fd, { amount: '', payee: '', note: '', receipt: '', tried: false }), fdFor: fkey, combo: null, toast: toast('Expense saved. Record the next one.') });
        else up({ exps: next, form: null, fd: null, combo: null, toast: toast('Expense saved.') });
      };
      vals.ef = {
        open: true, title: editingE ? 'Edit expense' : 'Record expense', isEdit: Boolean(editingE), isNew: !editingE,
        amount: fd.amount, onAmount: function (e) { setF({ amount: e.target.value }); },
        amountErr: fd.tried ? errs.amount : '', hasAmountErr: Boolean(fd.tried && errs.amount),
        cat: combo('cat', { title: 'Category', ph: 'Search categories', current: fd.cat, placeholder: 'Choose a category', options: catOptions(fd.cat), onPick: function (v) { setF({ cat: v }, { combo: null }); } }),
        catErr: fd.tried ? errs.cat : '', hasCatErr: Boolean(fd.tried && errs.cat),
        date: fd.date, onDate: function (e) { setF({ date: e.target.value }); },
        todayOn: fd.date === TODAY ? 'true' : 'false', yesterdayOn: fd.date === addDays(TODAY, -1) ? 'true' : 'false',
        pickToday: function () { setF({ date: TODAY }); }, pickYesterday: function () { setF({ date: addDays(TODAY, -1) }); },
        methods: methodsFor(fd.method, function (v) { setF({ method: v }); }),
        payee: fd.payee, onPayee: function (e) { setF({ payee: e.target.value }); },
        payees: payees.slice(0, 4).map(function (p) { return { label: p, pick: function () { setF({ payee: p }); } }; }), hasPayees: payees.length > 0,
        note: fd.note, onNote: function (e) { setF({ note: e.target.value }); },
        hasReceipt: Boolean(fd.receipt), noReceipt: !fd.receipt, receipt: fd.receipt,
        addReceipt: function () { setF({ receipt: 'receipt-' + fd.date + '.jpg' }); },
        removeReceipt: function () { setF({ receipt: '' }); },
        fromRec: Boolean(recOf), recText: recOf ? 'Posted by the recurring ' + catById(recOf.cat).en.toLowerCase() + ' expense (' + schedule(recOf).toLowerCase() + '). Changing this one doesn’t change the others.' : '',
        saveText: editingE ? 'Save' : 'Record expense',
        save: function () { saveExp(false); }, saveAgain: function () { saveExp(true); },
        askDelete: function () { up({ confirm: { kind: 'exp', id: editingE.id } }); }
      };
    } else {
      vals.ef = { open: false, cat: combo('cat', { title: 'Category', ph: 'Search', current: '', placeholder: '', options: [], onPick: function () {} }), methods: [], payees: [] };
    }

    // Recurring expenses.
    var monthly = 0;
    vals.recRows = recs.map(function (r) {
      var nx = nextOn(r), c = catById(r.cat), menuOpen = s.menu === r.id;
      if (nx) monthly += r.cadence === 'weekly' ? r.amount * 52 / 12 : r.amount;
      var state = !r.active ? 'Paused' : nx ? 'Next on ' + dayLabel(nx) : 'Ended';
      return {
        cat: c.en, color: colorOf(r.cat), payee: r.payee || c.en, schedule: schedule(r), state: state,
        stateColor: !r.active || !nx ? 'var(--muted-foreground)' : 'var(--foreground)', isLive: Boolean(nx), isOff: !nx,
        amount: money(r.amount), method: methodLabel(r.method), meta: schedule(r) + ' · ' + methodLabel(r.method),
        edit: function () { up({ form: { kind: 'rec', id: r.id }, fd: null, menu: null }); },
        menuOpen: menuOpen, menuExpanded: menuOpen ? 'true' : 'false', menuAria: 'Actions for ' + (r.payee || c.en),
        toggleMenu: function () { up({ menu: menuOpen ? null : r.id }); },
        canPause: r.active && Boolean(nx), canResume: !r.active,
        pause: function () { up({ recs: recs.map(function (x) { return x.id === r.id ? Object.assign({}, x, { active: false }) : x; }), menu: null, toast: toast((r.payee || c.en) + ' is paused.') }); },
        resume: function () { up({ recs: recs.map(function (x) { return x.id === r.id ? Object.assign({}, x, { active: true }) : x; }), menu: null, toast: toast((r.payee || c.en) + ' is active again.') }); },
        askDelete: function () { up({ menu: null, confirm: { kind: 'rec', id: r.id } }); }
      };
    });
    vals.recSummary = 'About ' + money(Math.round(monthly / 100) * 100) + ' a month from the ' + plural(recs.filter(function (r) { return nextOn(r); }).length, 'active one', 'active ones') + '.';
    vals.noRecs = recs.length === 0;
    var rOpen = s.menu ? recs.filter(function (r) { return r.id === s.menu; })[0] : null;
    vals.recMenuOpen = Boolean(rOpen) && tab === 'recurring';
    vals.mr = rOpen ? vals.recRows[recs.indexOf(rOpen)] : vals.recRows[0];

    var isRec = form && form.kind === 'rec';
    var editingR = isRec && form.id !== 'new' ? recs.filter(function (r) { return r.id === form.id; })[0] : null;
    var rd = isRec ? (s.fd && s.fdFor === fkey ? s.fd : (editingR
      ? Object.assign(copy(editingR), { amount: String(editingR.amount), tried: false })
      : { cat: '', amount: '', method: 'bank', payee: '', cadence: 'monthly', day: 1, startsOn: TODAY, endsOn: '', active: true, tried: false })) : null;
    if (isRec) {
      var setR = function (patch, extra) { up(Object.assign({ fd: Object.assign({}, rd, patch), fdFor: fkey }, extra || {})); };
      var ramt = num(rd.amount);
      var rerr = { amount: !(ramt > 0) ? 'Enter an amount in taka.' : '', cat: !rd.cat ? 'Choose a category.' : '', dates: rd.endsOn && rd.endsOn < rd.startsOn ? 'It must end after it starts.' : '' };
      var rok = !rerr.amount && !rerr.cat && !rerr.dates;
      var preview = Object.assign({}, rd, { amount: ramt || 0 });
      var pn = nextOn(preview);
      var dayOptions = [];
      for (var d = 1; d <= 28; d++) dayOptions.push({ v: d, label: 'Day ' + d });
      dayOptions.push({ v: 0, label: 'The last day' });
      vals.rf = {
        open: true, title: editingR ? 'Edit recurring expense' : 'New recurring expense', isEdit: Boolean(editingR), saveText: editingR ? 'Save' : 'Add recurring expense',
        cat: combo('rcat', { title: 'Category', ph: 'Search categories', current: rd.cat, placeholder: 'Choose a category', options: catOptions(rd.cat), onPick: function (v) { setR({ cat: v }, { combo: null }); } }),
        catErr: rd.tried ? rerr.cat : '', hasCatErr: Boolean(rd.tried && rerr.cat),
        amount: rd.amount, onAmount: function (e) { setR({ amount: e.target.value }); },
        amountErr: rd.tried ? rerr.amount : '', hasAmountErr: Boolean(rd.tried && rerr.amount),
        methods: methodsFor(rd.method, function (v) { setR({ method: v }); }),
        payee: rd.payee, onPayee: function (e) { setR({ payee: e.target.value }); },
        monthlyOn: rd.cadence === 'monthly' ? 'true' : 'false', weeklyOn: rd.cadence === 'weekly' ? 'true' : 'false',
        isMonthly: rd.cadence === 'monthly', isWeekly: rd.cadence === 'weekly',
        pickMonthly: function () { setR({ cadence: 'monthly', day: 1 }); }, pickWeekly: function () { setR({ cadence: 'weekly', day: weekday(TODAY) }); },
        day: combo('day', { title: 'Day of the month', ph: 'Search days', current: rd.day, placeholder: 'Choose a day', options: dayOptions, onPick: function (v) { setR({ day: v }, { combo: null }); } }),
        weekdays: WEEKDAYS.map(function (w, i) { return { label: w, full: WEEKDAYS_LONG[i], on: rd.day === i + 1 ? 'true' : 'false', pick: function () { setR({ day: i + 1 }); } }; }),
        startsOn: rd.startsOn, onStarts: function (e) { setR({ startsOn: e.target.value }); },
        endsOn: rd.endsOn, onEnds: function (e) { setR({ endsOn: e.target.value }); },
        datesErr: rd.tried ? rerr.dates : '', hasDatesErr: Boolean(rd.tried && rerr.dates),
        activeAria: rd.active ? 'true' : 'false', activeBg: rd.active ? 'var(--primary)' : 'var(--input)', activeX: rd.active ? '14px' : '0px',
        toggleActive: function () { setR({ active: !rd.active }); },
        preview: !rd.active ? 'Paused: nothing is posted until you turn it back on.' : pn ? 'Next one: ' + dayLabel(pn) + (ramt ? ' · ' + money(ramt) : '') + '. It posts itself early that morning.' : 'It has ended: nothing more is posted.',
        save: function () {
          if (!rok) { setR({ tried: true }); return; }
          var rec = Object.assign({}, rd, { id: editingR ? editingR.id : 'rn' + recs.length, amount: ramt, payee: rd.payee.trim() });
          delete rec.tried;
          up({ recs: editingR ? recs.map(function (r) { return r.id === rec.id ? rec : r; }) : recs.concat([rec]), form: null, fd: null, combo: null, toast: toast('Recurring expense saved.') });
        },
        askDelete: function () { up({ confirm: { kind: 'rec', id: editingR.id } }); }
      };
    } else {
      vals.rf = { open: false, cat: combo('rcat', { title: '', ph: '', current: '', placeholder: '', options: [], onPick: function () {} }), day: combo('day', { title: '', ph: '', current: '', placeholder: '', options: [], onPick: function () {} }), methods: [], weekdays: [] };
    }
    vals.closeForm = function () { up({ form: null, fd: null, combo: null }); };
    var active = allCombos[s.combo] && form ? allCombos[s.combo] : null;
    vals.comboOpen = Boolean(active);
    vals.cbd = active || vals.ef.cat;
    vals.closeCombo = function () { up({ combo: null }); };
    vals.comboEsc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); up({ combo: null }); } };

    // Categories.
    var activeCats = cats.filter(function (c) { return !c.archived; });
    var monthCount = function (id) { return inMonth.filter(function (e) { return e.cat === id; }).length; };
    var moveCat = function (c, dir) {
      var list = activeCats.slice(), i = list.indexOf(c), j = i + dir;
      if (j < 0 || j >= list.length) return;
      list[i] = list[j]; list[j] = c;
      up({ cats: list.concat(cats.filter(function (x) { return x.archived; })), menu: null, toast: toast(c.en + ' moved ' + (dir < 0 ? 'up.' : 'down.')) });
    };
    var catRow = function (c, i, list) {
      var menuOpen = s.menu === c.id;
      return {
        name: c.en, bn: c.bn, color: colorOf(c.id),
        month: byCat[c.id] ? money(byCat[c.id]) + ' in ' + MONTHS[Number(month.slice(5, 7)) - 1] + ' · ' + plural(monthCount(c.id), 'expense', 'expenses') : 'Nothing in ' + MONTHS[Number(month.slice(5, 7)) - 1],
        aria: 'Edit ' + c.en,
        menuOpen: menuOpen, menuExpanded: menuOpen ? 'true' : 'false', menuAria: 'Actions for ' + c.en,
        toggleMenu: function () { up({ menu: menuOpen ? null : c.id }); },
        edit: function () { up({ catForm: c.id, cn: null, clang: 'bn', menu: null }); },
        first: i === 0, last: i === list.length - 1, moveUp: function () { moveCat(c, -1); }, moveDown: function () { moveCat(c, 1); },
        archive: function () { up({ cats: cats.map(function (x) { return x.id === c.id ? Object.assign({}, x, { archived: true }) : x; }), menu: null, catForm: null, cn: null, toast: toast(c.en + ' is archived. Its expenses stay.') }); },
        restore: function () { up({ cats: cats.map(function (x) { return x.id === c.id ? Object.assign({}, x, { archived: false }) : x; }), toast: toast(c.en + ' is back in the list.') }); }
      };
    };
    vals.catRows = activeCats.map(catRow);
    var archived = cats.filter(function (c) { return c.archived; });
    vals.archRows = archived.map(catRow);
    vals.hasArchived = archived.length > 0;
    vals.archOpen = Boolean(s.showArchived);
    vals.archAria = s.showArchived ? 'true' : 'false';
    vals.archText = 'Archived (' + archived.length + ')';
    vals.toggleArch = function () { up({ showArchived: !s.showArchived }); };

    // Add or edit a category: one name field with বাংলা | English tabs. Both are needed.
    var kfor = s.catForm || null;
    var editingC = kfor && kfor !== 'new' ? cats.filter(function (c) { return c.id === kfor; })[0] : null;
    var cn = s.cn && s.cnFor === kfor ? s.cn : (editingC ? { bn: editingC.bn, en: editingC.en } : { bn: '', en: '' });
    var clang = s.clang || 'bn';
    var setN = function (patch) { up({ cn: Object.assign({}, cn, patch), cnFor: kfor }); };
    vals.kf = {
      open: Boolean(kfor), isEdit: Boolean(editingC), canArchive: Boolean(editingC && !editingC.archived),
      title: editingC ? 'Edit category' : 'New category',
      sub: editingC ? 'Expenses already in it move with the new name.' : 'Groups expenses in the month’s totals and reports.',
      bnSel: clang === 'bn' ? 'true' : 'false', enSel: clang === 'en' ? 'true' : 'false',
      pickBn: function () { up({ clang: 'bn' }); }, pickEn: function () { up({ clang: 'en' }); },
      bnNeeded: !cn.bn.trim(), enNeeded: !cn.en.trim(),
      lang: clang, value: clang === 'bn' ? cn.bn : cn.en, ph: clang === 'bn' ? 'যেমন: অফিস খরচ' : 'For example: Office',
      onValue: function (e) { var patch = {}; patch[clang] = e.target.value; setN(patch); },
      hint: 'Shown in বাংলা and English, so both are needed.',
      cantSave: !cn.en.trim() || !cn.bn.trim(), saveText: editingC ? 'Save' : 'Add category',
      save: function () {
        if (!cn.en.trim() || !cn.bn.trim()) return;
        if (editingC) up({ cats: cats.map(function (x) { return x.id === editingC.id ? Object.assign({}, x, { en: cn.en.trim(), bn: cn.bn.trim() }) : x; }), catForm: null, cn: null, toast: toast('Category saved.') });
        else up({ cats: activeCats.concat([{ id: 'c' + cats.length, en: cn.en.trim(), bn: cn.bn.trim(), slot: cats.length, archived: false }]).concat(archived), catForm: null, cn: null, toast: toast('Category saved.') });
      },
      archive: function () { if (editingC) catRow(editingC, 0, activeCats).archive(); }
    };
    vals.closeCat = function () { up({ catForm: null, cn: null }); };
    var cOpen = s.menu ? cats.filter(function (c) { return c.id === s.menu; })[0] : null;
    vals.catMenuOpen = Boolean(cOpen) && tab === 'categories';
    vals.mc = cOpen ? catRow(cOpen, activeCats.indexOf(cOpen), activeCats) : vals.catRows[0];

    // Delete.
    var cf = s.confirm || null;
    vals.confirmOpen = Boolean(cf);
    var delE = cf && cf.kind === 'exp' ? exps.filter(function (e) { return e.id === cf.id; })[0] : null;
    var delR = cf && cf.kind === 'rec' ? recs.filter(function (r) { return r.id === cf.id; })[0] : null;
    vals.confirmTitle = delE ? 'Delete this expense?' : 'Delete this recurring expense?';
    vals.confirmText = delE ? catById(delE.cat).en + ', ' + money(delE.amount) + ' on ' + short(delE.date) + '. Its receipt photo goes too.' : 'No more expenses are posted. Those already posted stay.';
    vals.doDelete = function () {
      if (delE) up({ exps: exps.filter(function (e) { return e.id !== delE.id; }), confirm: null, form: null, fd: null, toast: toast('Expense deleted.') });
      else if (delR) up({ recs: recs.filter(function (r) { return r.id !== delR.id; }), confirm: null, form: null, fd: null, toast: toast('Recurring expense deleted.') });
    };
    vals.cancelConfirm = function () { up({ confirm: null }); };

    var reset = { menu: null, pop: null, form: null, fd: null, combo: null, confirm: null, catForm: null, cn: null };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ menu: null, pop: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(s.combo ? { combo: null } : s.confirm ? { confirm: null } : reset); } };
    vals.hasToast = Boolean(s.toast);
    vals.toastText = s.toast || '';

    vals.themeClass = ROOT + (dark ? ' dark' : '');
    vals.fontStack = FONTS[this.props.font ?? 'Inter'] || FONTS.Inter;
    vals.isDark = dark;
    vals.isLight = !dark;
    vals.themeLabel = dark ? 'Switch to light theme' : 'Switch to dark theme';
    vals.toggleTheme = function () { up({ dark: !dark }); };
    return vals;
  }
}
