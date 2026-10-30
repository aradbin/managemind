var LN = { bn: 'বাংলা', en: 'English' };
var TYPES = [
  { v: 'choice', label: 'One choice', desc: 'Pick one from a list, like fit', icon: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'] },
  { v: 'multi_choice', label: 'Several choices', desc: 'Pick any from a list, like colour', icon: ['m3 17 2 2 4-4', 'm3 7 2 2 4-4', 'M13 6h8', 'M13 12h8', 'M13 18h8'] },
  { v: 'number', label: 'Number', desc: 'A number with a unit, like weight', icon: ['M4 9h16', 'M4 15h16', 'M10 3 8 21', 'M16 3 14 21'] },
  { v: 'text', label: 'Text', desc: 'Typed for each product, like care', icon: ['M12 4v16', 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2', 'M9 20h6'] },
  { v: 'boolean', label: 'Yes or no', desc: 'A simple yes or no, like handmade', icon: ['M6 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M9 5h6a7 7 0 0 1 0 14H9a7 7 0 0 1 0-14z'] }
];
var TYPE_BY = {};
TYPES.forEach(function (t) { TYPE_BY[t.v] = t; });
var vid = 0;
function V(bn, en) { vid++; return { id: 'v' + vid, bn: bn, en: en }; }
function A(id, type, bn, en, o) {
  return Object.assign({ id: id, key: id, type: type, bn: bn, en: en, system: false, filter: false, shown: true, unit: { bn: '', en: '' }, products: 0, values: [] }, o);
}
var ATTRS = [
  A('brand', 'choice', 'ব্র্যান্ড', 'Brand', { system: true, filter: true, products: 118, values: [V('নকশী', 'Nakshi'), V('হেরিটেজ', 'Heritage'), V('আরবান', 'Urban'), V('কুমুদিনী', 'Kumudini'), V('সেইলর', 'Sailor')] }),
  A('fabric', 'multi_choice', 'কাপড়', 'Fabric', { filter: true, products: 96, values: [V('সুতি', 'Cotton'), V('সিল্ক', 'Silk'), V('পাট', 'Jute'), V('উল', 'Wool'), V('লিনেন', 'Linen'), V('জর্জেট', '')] }),
  A('colour', 'multi_choice', 'রং', 'Colour', { filter: true, products: 130, values: [V('লাল', 'Red'), V('মেরুন', 'Maroon'), V('নীল', 'Blue'), V('নেভি', 'Navy'), V('সবুজ', 'Green'), V('কালো', 'Black'), V('সাদা', 'White'), V('আইভরি', 'Ivory'), V('হলুদ', 'Yellow'), V('গোলাপি', 'Pink'), V('ধূসর', ''), V('বাদামি', '')] }),
  A('fit', 'choice', 'ফিট', 'Fit', { filter: true, products: 34, values: [V('রেগুলার', 'Regular'), V('স্লিম', 'Slim'), V('ঢিলা', 'Loose')] }),
  A('sleeve', 'choice', 'হাতা', 'Sleeve', { products: 28, values: [V('হাফ হাতা', 'Short'), V('ফুল হাতা', 'Long'), V('থ্রি-কোয়ার্টার', 'Three-quarter')] }),
  A('weight', 'number', 'ওজন', 'Weight', { products: 140, unit: { bn: 'গ্রাম', en: 'g' } }),
  A('handmade', 'boolean', 'হাতে তৈরি', 'Handmade', { filter: true, products: 52 }),
  A('origin', 'choice', 'উৎপত্তি', 'Origin', { filter: true, products: 21, values: [V('টাঙ্গাইল', 'Tangail'), V('রাজশাহী', 'Rajshahi'), V('ঢাকা', 'Dhaka'), V('সিলেট', '')] }),
  A('age_group', 'choice', 'বয়স', 'Age group', { filter: true, products: 12, values: [V('০–২ বছর', '0–2 years'), V('৩–৫ বছর', '3–5 years'), V('৬–৯ বছর', '6–9 years'), V('১০–১৪ বছর', '10–14 years')] }),
  A('care', 'text', 'যত্ন', 'Care', { products: 60 }),
  A('supplier_code', 'text', 'সরবরাহকারীর কোড', 'Supplier code', { shown: false, products: 75 })
];
var START = {
  List: {}, 'Type filter': { pop: 'type' }, 'Row menu': { menu: 'fabric' }, Actions: { actions: 'fabric' },
  'Edit choice': { sheet: { mode: 'edit', id: 'fabric' } }, 'Many values': { sheet: { mode: 'edit', id: 'colour' } },
  Reorder: { sheet: { mode: 'edit', id: 'fabric' }, reorder: true },
  'Edit number': { sheet: { mode: 'edit', id: 'weight' } }, 'New attribute': { sheet: { mode: 'create' } },
  'Type list': { sheet: { mode: 'create' }, combo: 'type' }, Delete: { confirm: 'fabric' }
};
var FONTS = {
  Inter: "'Inter', 'Noto Sans Bengali', system-ui, sans-serif",
  Geist: "'Geist', 'Noto Sans Bengali', system-ui, sans-serif"
};
function hasValues(t) { return t === 'choice' || t === 'multi_choice'; }
function ic(t) { var p = (TYPE_BY[t] || TYPES[0]).icon; return { p1: p[0] || 'M0 0', p2: p[1] || 'M0 0', p3: p[2] || 'M0 0', p4: p[3] || 'M0 0', p5: p[4] || 'M0 0' }; }
function slug(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '').slice(0, 40); }
function copy(x) { return JSON.parse(JSON.stringify(x)); }
function plural(n, one, many) { return n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many); }
function sw(on) { return { on: on, aria: on ? 'true' : 'false', bg: on ? 'var(--primary)' : 'var(--input)', x: on ? '14px' : '0px' }; }

class Component extends DCLogic {
  renderVals() {
    var self = this;
    var startKey = this.props.startOn ?? 'List';
    var s = this.state || {};
    if (s.started !== startKey) s = Object.assign({ started: startKey, dark: s.dark }, START[startKey] || {});
    var up = function (patch) { self.setState(Object.assign({}, s, patch, { started: startKey })); };
    var toast = function (text) {
      clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function () { self.setState({ toast: null }); }, 4000);
      return text;
    };
    var vals = {};
    var attrs = s.attrs || ATTRS;
    var name = function (a) { return a.en || a.bn; };
    var where = function (a) { return a.shown && a.filter ? 'Product page, filter' : a.shown ? 'Product page' : a.filter ? 'Filter only' : 'Hidden'; };
    var preview = function (a) {
      if (hasValues(a.type)) {
        var ls = a.values.map(function (x) { return x.en || x.bn; });
        return ls.length ? ls.slice(0, 3).join(', ') + (ls.length > 3 ? ' +' + (ls.length - 3) : '') : 'No values yet';
      }
      if (a.type === 'number') return a.unit.en || a.unit.bn ? 'In ' + (a.unit.en || a.unit.bn) : 'Any number';
      if (a.type === 'boolean') return 'Yes, No';
      return 'Typed for each product';
    };
    var move = function (a, dir) {
      var i = attrs.indexOf(a), j = i + dir;
      if (j < 0 || j >= attrs.length) return;
      var next = attrs.slice(); next[i] = attrs[j]; next[j] = a;
      up({ attrs: next, menu: null, actions: null, toast: toast(name(a) + ' moved ' + (dir < 0 ? 'up.' : 'down.')) });
    };
    var openSheet = function (sheet) { up({ sheet: sheet, draft: null, menu: null, actions: null, pop: null, lang: null, keyOpen: false, vq: '', nv: '', cq: '', reorder: false, combo: null }); };

    // List: search, a type filter, and one row per attribute in store order.
    var q = (s.q || '').trim().toLowerCase();
    var types = s.types || [];
    vals.q = s.q || '';
    vals.onQ = function (e) { up({ q: e.target.value }); };
    var list = attrs.filter(function (a) {
      return (!types.length || types.indexOf(a.type) !== -1) && (!q || name(a).toLowerCase().indexOf(q) !== -1 || a.bn.indexOf(q) !== -1 || a.key.indexOf(q) !== -1);
    });
    var rowOf = function (a) {
      var i = attrs.indexOf(a);
      var t = TYPE_BY[a.type];
      var menuOpen = s.menu === a.id;
      return {
        name: name(a), key: a.key, system: a.system, ic: ic(a.type), typeLabel: t.label,
        preview: preview(a), previewColor: hasValues(a.type) && a.values.length ? 'var(--foreground)' : 'var(--muted-foreground)',
        where: where(a), whereColor: a.shown || a.filter ? 'var(--foreground)' : 'var(--muted-foreground)',
        products: a.products.toLocaleString('en-US'),
        meta: t.label + ' · ' + (hasValues(a.type) ? plural(a.values.length, 'value', 'values') : preview(a)) + ' · ' + plural(a.products, 'product', 'products'),
        sub: (a.system ? 'Built in · ' : '') + where(a) + ' · ' + a.key,
        hidden: !a.shown && !a.filter,
        current: s.actions === a.id || (s.sheet && s.sheet.id === a.id) ? 'true' : 'false',
        edit: function () { openSheet({ mode: 'edit', id: a.id }); },
        menuOpen: menuOpen, menuExpanded: menuOpen ? 'true' : 'false', menuAria: 'Actions for ' + name(a),
        toggleMenu: function () { up({ menu: menuOpen ? null : a.id }); },
        openActions: function () { up({ actions: a.id }); },
        first: i === 0, last: i === attrs.length - 1,
        moveUp: function () { move(a, -1); }, moveDown: function () { move(a, 1); },
        cantDelete: a.system, deleteTitle: a.system ? name(a) + ' is built in and can’t be deleted.' : '',
        askDelete: function () { up({ menu: null, actions: null, confirm: a.id, typed: '' }); }
      };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyCanReset = true;
    vals.emptyReset = function () { up({ q: '', types: [] }); };
    vals.summary = list.length === attrs.length ? plural(attrs.length, 'attribute', 'attributes') : list.length + ' of ' + attrs.length;
    vals.newAttr = function () { openSheet({ mode: 'create' }); };

    var tfOpen = s.pop === 'type';
    var tfq = tfOpen ? (s.tq || '') : '';
    var tfShown = TYPES.filter(function (t) { return !tfq.trim() || t.label.toLowerCase().indexOf(tfq.trim().toLowerCase()) !== -1; });
    vals.tf = {
      open: tfOpen, aria: tfOpen ? 'true' : 'false', toggle: function () { up({ pop: tfOpen ? null : 'type', tq: '' }); },
      query: tfq, onQuery: function (e) { up({ tq: e.target.value }); }, none: tfShown.length === 0,
      hasSel: types.length > 0, noSel: types.length === 0, count: String(types.length),
      selText: types.length === 1 ? TYPE_BY[types[0]].label : types.length + ' selected',
      showText: 'Show ' + plural(list.length, 'attribute', 'attributes'),
      items: tfShown.map(function (t) {
        var on = types.indexOf(t.v) !== -1;
        return {
          label: t.label, ic: ic(t.v), on: on, aria: on ? 'true' : 'false',
          box: on ? 'var(--primary)' : 'transparent', edge: on ? 'var(--primary)' : 'var(--input)',
          count: String(attrs.filter(function (a) { return a.type === t.v; }).length),
          toggle: function () { up({ types: on ? types.filter(function (x) { return x !== t.v; }) : types.concat([t.v]) }); }
        };
      }),
      clear: function () { up({ types: [] }); }
    };

    var acAttr = s.actions ? attrs.filter(function (a) { return a.id === s.actions; })[0] : null;
    vals.actionsOpen = Boolean(acAttr);
    vals.ac = rowOf(acAttr || attrs[0]);

    // Create / edit sheet.
    var sheet = s.sheet || null;
    vals.sheetOpen = Boolean(sheet);
    var editing = sheet && sheet.mode === 'edit' ? attrs.filter(function (a) { return a.id === sheet.id; })[0] : null;
    var dkey = JSON.stringify(sheet);
    var d = s.draft && s.draftFor === dkey ? s.draft : (editing
      ? Object.assign(copy(editing), { langs: editing.en ? ['bn', 'en'] : ['bn'], keyTouched: true })
      : { bn: '', en: '', langs: ['bn'], type: 'choice', key: '', keyTouched: false, unit: { bn: '', en: '' }, filter: true, shown: true, values: [] });
    var setD = function (patch, extra) { up(Object.assign({ draft: Object.assign({}, d, patch), draftFor: dkey }, extra || {})); };
    var multi = d.langs.indexOf('en') !== -1;
    var lang = multi && s.lang === 'en' ? 'en' : 'bn';
    var other = lang === 'bn' ? 'en' : 'bn';
    var t = TYPE_BY[d.type];

    var keyErr = '';
    if (!editing) {
      if (!d.key) keyErr = 'Add an English name or type a key.';
      else if (!/^[a-z][a-z0-9_]{0,39}$/.test(d.key)) keyErr = 'Use lowercase English letters, digits and _, starting with a letter.';
      else if (d.key === 'brand') keyErr = 'brand is built in. Choose another key.';
      else if (attrs.some(function (a) { return a.key === d.key; })) keyErr = 'Another attribute already uses this key.';
    }
    var showKeyErr = Boolean(keyErr) && Boolean(d.key || d.bn.trim());
    var keyOpen = Boolean(s.keyOpen) || showKeyErr;

    var dupText = '';
    ['bn', 'en'].forEach(function (l) {
      var seen = {};
      d.values.forEach(function (x) {
        var k = (x[l] || '').trim().toLowerCase();
        if (!k) return;
        if (seen[k] && !dupText) dupText = 'Two values are both “' + x[l].trim() + '”. Each needs its own name.';
        seen[k] = true;
      });
    });
    var missEn = multi ? d.values.filter(function (x) { return !(x.en || '').trim(); }).length : 0;
    var missBn = d.values.filter(function (x) { return !(x.bn || '').trim(); }).length;
    var missText = [
      missEn ? plural(missEn, 'value has', 'values have') + ' no English name yet. The store shows the বাংলা name instead.' : '',
      missBn ? plural(missBn, 'value has', 'values have') + ' no বাংলা name yet.' : ''
    ].filter(Boolean).join(' ');

    var vq = (s.vq || '').trim().toLowerCase();
    var canSearch = d.values.length > 8;
    var searching = canSearch && Boolean(vq);
    var reorder = Boolean(s.reorder) && d.values.length > 1 && !searching;
    var setVal = function (i, patch) { var n = d.values.slice(); n[i] = Object.assign({}, n[i], patch); setD({ values: n }); };
    var moveVal = function (i, dir) { var n = d.values.slice(); var x = n[i]; n[i] = n[i + dir]; n[i + dir] = x; setD({ values: n }); };
    var valueItems = d.values.map(function (x, i) { return { x: x, i: i }; }).filter(function (o) {
      return !searching || (o.x.bn || '').toLowerCase().indexOf(vq) !== -1 || (o.x.en || '').toLowerCase().indexOf(vq) !== -1;
    }).map(function (o) {
      var x = o.x, i = o.i;
      var shownLabel = x[lang] || x[other] || 'Value ' + (i + 1);
      return {
        value: x[lang] || '', lang: lang, ph: x[other] ? x[other] + ' · add ' + LN[lang] : 'Value name',
        label: (i + 1) + '. ' + shownLabel, labelColor: x[lang] ? 'var(--foreground)' : 'var(--muted-foreground)',
        aria: 'Value ' + (i + 1) + ' (' + LN[lang] + ')',
        onChange: function (e) { var p = {}; p[lang] = e.target.value; setVal(i, p); },
        first: i === 0 || searching, last: i === d.values.length - 1 || searching,
        upAria: 'Move ' + shownLabel + ' up', downAria: 'Move ' + shownLabel + ' down', removeAria: 'Remove ' + shownLabel,
        up: function () { moveVal(i, -1); }, down: function () { moveVal(i, 1); },
        remove: function () { setD({ values: d.values.filter(function (_, j) { return j !== i; }) }); }
      };
    });
    var addValue = function () {
      var v = (s.nv || '').trim();
      if (!v) return;
      var nx = { id: 'n' + Date.now(), bn: '', en: '' };
      nx[lang] = v;
      up({ draft: Object.assign({}, d, { values: d.values.concat([nx]) }), draftFor: dkey, nv: '', vq: '' });
    };
    var shownSw = sw(d.shown);
    var filterSw = sw(d.filter && d.type !== 'text');

    vals.sh = {
      title: editing ? 'Edit attribute' : 'New attribute',
      sub: editing ? (editing.system ? 'Built in · used by ' : 'Used by ') + plural(editing.products, 'product', 'products') : 'A product fact, shown on product pages and used as a store filter.',
      isEdit: Boolean(editing), isNew: !editing, single: !multi, multi: multi, lang: lang,
      bnSel: lang === 'bn' ? 'true' : 'false', enSel: lang === 'en' ? 'true' : 'false',
      pickBn: function () { up({ lang: 'bn' }); }, pickEn: function () { up({ lang: 'en' }); },
      addEn: function () { up({ draft: Object.assign({}, d, { langs: ['bn', 'en'] }), draftFor: dkey, lang: 'en' }); },
      name: d[lang] || '', namePh: lang === 'bn' ? 'যেমন: কাপড়' : 'For example: Fabric',
      onName: function (e) {
        var p = {}; p[lang] = e.target.value;
        if (lang === 'en' && !editing && !d.keyTouched) p.key = slug(e.target.value);
        setD(p);
      },
      ic: ic(d.type), typeLabel: t.label, typeDesc: t.desc,
      key: d.key, onKey: function (e) { setD({ key: e.target.value.toLowerCase(), keyTouched: true }); },
      keyErr: keyErr, hasKeyErr: showKeyErr, keyPreview: d.key || 'not set yet',
      keyOpen: keyOpen, keyAria: keyOpen ? 'true' : 'false', toggleKey: function () { up({ keyOpen: !keyOpen }); },
      isNumber: d.type === 'number', isText: d.type === 'text', isBool: d.type === 'boolean', hasValues: hasValues(d.type),
      unit: d.unit[lang] || '', unitPh: lang === 'bn' ? 'যেমন: গ্রাম' : 'For example: g',
      onUnit: function (e) { var u = Object.assign({}, d.unit); u[lang] = e.target.value; setD({ unit: u }); },
      unitHint: 'Shown after the number, like “350 ' + (d.unit[lang] || (lang === 'bn' ? 'গ্রাম' : 'g')) + '”.',
      shownAria: shownSw.aria, shownBg: shownSw.bg, shownX: shownSw.x,
      toggleShown: function () { setD({ shown: !d.shown }); },
      filterAria: filterSw.aria, filterBg: filterSw.bg, filterX: filterSw.x, filterOff: d.type === 'text',
      toggleFilter: function () { if (d.type !== 'text') setD({ filter: !d.filter }); },
      filterHint: d.type === 'text' ? 'Text is different for every product, so it can’t be a filter.' : 'Shoppers can narrow products by it.',
      valueCount: plural(d.values.length, 'value', 'values'),
      canSearch: canSearch, vq: s.vq || '', onVq: function (e) { up({ vq: e.target.value }); },
      values: valueItems, hasVals: valueItems.length > 0, noVals: d.values.length === 0, noMatch: searching && valueItems.length === 0,
      noMatchText: 'No value matches “' + (s.vq || '').trim() + '”.',
      nv: s.nv || '', onNv: function (e) { up({ nv: e.target.value }); },
      nvKey: function (e) { if (e.key === 'Enter') { e.preventDefault(); addValue(); } },
      addValue: addValue, nvPh: lang === 'bn' ? 'নতুন মান, যেমন: সুতি' : 'New value, like Cotton',
      dup: Boolean(dupText), dupText: dupText, miss: Boolean(missText), missText: missText,
      canReorder: d.values.length > 1 && !searching, reorder: reorder, notReorder: !reorder,
      reorderText: reorder ? 'Done' : 'Reorder', reorderAria: reorder ? 'true' : 'false',
      toggleReorder: function () { up({ reorder: !reorder }); },
      cantDelete: editing ? editing.system : true,
      deleteTitle: editing && editing.system ? name(editing) + ' is built in and can’t be deleted.' : '',
      askDelete: function () { if (editing) up({ confirm: editing.id, typed: '' }); },
      cantSave: !d.bn.trim() || Boolean(keyErr) || Boolean(dupText),
      saveText: editing ? 'Save' : 'Create attribute',
      save: function () {
        var clean = {
          bn: d.bn.trim(), en: multi ? (d.en || '').trim() : '', type: d.type,
          filter: d.type === 'text' ? false : d.filter, shown: d.shown, unit: d.unit,
          values: hasValues(d.type) ? d.values : []
        };
        var next = editing
          ? attrs.map(function (a) { return a.id === editing.id ? Object.assign({}, a, clean) : a; })
          : attrs.concat([Object.assign({ id: d.key, key: d.key, system: false, products: 0 }, clean)]);
        up({ attrs: next, sheet: null, draft: null, combo: null, reorder: false, toast: toast(editing ? 'Attribute saved.' : 'Attribute created.') });
      }
    };

    // Type: a searchable list, only while creating.
    var cOpen = s.combo === 'type' && Boolean(sheet) && !editing;
    var cq = cOpen ? (s.cq || '').trim().toLowerCase() : '';
    var typeShown = TYPES.filter(function (x) { return !cq || x.label.toLowerCase().indexOf(cq) !== -1 || x.desc.toLowerCase().indexOf(cq) !== -1; });
    vals.tc = {
      open: cOpen, aria: cOpen ? 'true' : 'false', query: cOpen ? (s.cq || '') : '', none: typeShown.length === 0,
      toggle: function () { up({ combo: cOpen ? null : 'type', cq: '' }); },
      onQuery: function (e) { up({ cq: e.target.value }); },
      items: typeShown.map(function (x) {
        var on = d.type === x.v;
        return {
          label: x.label, desc: x.desc, ic: ic(x.v), check: on ? '1' : '0', aria: on ? 'true' : 'false',
          pick: function () { setD({ type: x.v, filter: x.v === 'text' ? false : d.filter }, { combo: null }); }
        };
      })
    };
    vals.comboOpen = cOpen;
    vals.closeCombo = function () { up({ combo: null }); };
    vals.comboEsc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); up({ combo: null }); } };

    // Delete: typing the key is asked for when products use it.
    var delA = s.confirm ? attrs.filter(function (a) { return a.id === s.confirm; })[0] : null;
    vals.confirmOpen = Boolean(delA);
    var typed = s.typed || '';
    vals.cf = delA ? {
      needsType: delA.products > 0,
      text: delA.products > 0 ? name(delA) + ' is removed from ' + plural(delA.products, 'product', 'products') + '. This can’t be undone.' : name(delA) + ' isn’t used by any product.',
      typeLabel: 'Type ' + delA.key + ' to confirm', key: delA.key, typed: typed,
      onTyped: function (e) { up({ typed: e.target.value }); },
      cant: delA.products > 0 && typed.trim() !== delA.key
    } : { needsType: false, text: '', typeLabel: '', key: '', typed: '', onTyped: null, cant: true };
    vals.cancelConfirm = function () { up({ confirm: null, typed: '' }); };
    vals.doDelete = function () {
      if (!delA) return;
      up({
        attrs: attrs.filter(function (a) { return a.id !== delA.id; }), confirm: null, typed: '', sheet: null, draft: null,
        toast: toast(delA.products ? 'Attribute deleted from ' + plural(delA.products, 'product', 'products') + '.' : 'Attribute deleted.')
      });
    };

    var reset = { menu: null, pop: null, actions: null, sheet: null, draft: null, combo: null, confirm: null, typed: '', reorder: false };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ pop: null, menu: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(s.confirm ? { confirm: null, typed: '' } : reset); } };
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
