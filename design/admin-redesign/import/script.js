var GROUPS = [
  { g: 'Product', items: [['handle', 'Handle'], ['title:bn', 'Title (বাংলা)'], ['title:en', 'Title (English)'], ['slug', 'URL slug'], ['description:bn', 'Description (বাংলা)'], ['description:en', 'Description (English)'], ['seoTitle:bn', 'SEO title (বাংলা)'], ['seoTitle:en', 'SEO title (English)'], ['status', 'Status'], ['categories', 'Categories'], ['tags', 'Tags'], ['brand', 'Brand'], ['vatCategory', 'VAT category']] },
  { g: 'Variant', items: [['option1Name', 'Option1 name'], ['option1Value', 'Option1 value'], ['option2Name', 'Option2 name'], ['option2Value', 'Option2 value'], ['option3Name', 'Option3 name'], ['option3Value', 'Option3 value'], ['sku', 'SKU'], ['barcode', 'Barcode'], ['price', 'Price'], ['compareAtPrice', 'Compare-at price'], ['costPrice', 'Cost price'], ['weightGrams', 'Weight (grams)']] },
  { g: 'Stock', items: [['stock', 'Stock'], ['trackInventory', 'Track stock'], ['allowBackorder', 'Sell when out of stock'], ['lowStockThreshold', 'Low stock alert']] },
  { g: 'Images', items: [['images', 'Image URLs'], ['variantImage', 'Variant image URL']] },
  { g: 'Attributes', items: [['attr:fabric', 'Fabric'], ['attr:colour', 'Colour'], ['attr:fit', 'Fit'], ['attr:sleeve', 'Sleeve'], ['attr:weight', 'Weight'], ['attr:handmade', 'Handmade'], ['attr:origin', 'Origin'], ['attr:age_group', 'Age group'], ['attr:care:bn', 'Care (বাংলা)'], ['attr:care:en', 'Care (English)']] }
];
var FILE = {
  name: 'nakshi-products.xlsx', rows: 248, products: 98,
  columns: [
    { h: 'Handle', sample: 'cotton-panjabi-ivory', auto: 'handle' },
    { h: 'নাম', sample: 'সুতি পাঞ্জাবি — আইভরি', auto: 'title:bn' },
    { h: 'Title (en)', sample: 'Cotton Panjabi — Ivory', auto: 'title:en' },
    { h: 'Category', sample: 'Men › Panjabi', auto: 'categories' },
    { h: 'Tags', sample: 'cotton, eid', auto: 'tags' },
    { h: 'Option1 name', sample: 'Size', auto: 'option1Name' },
    { h: 'Option1 value', sample: 'M', auto: 'option1Value' },
    { h: 'Variant SKU', sample: 'PJ-IV-M', auto: 'sku' },
    { h: 'দাম', sample: '1850', auto: 'price' },
    { h: 'Compare at price', sample: '2200', auto: 'compareAtPrice' },
    { h: 'Stock', sample: '12', auto: 'stock' },
    { h: 'Image Src', sample: 'https://cdn.nakshi.com/p/pj-iv-1.jpg', auto: 'images' },
    { h: 'Fabric', sample: 'Cotton', auto: 'attr:fabric' },
    { h: 'material', sample: 'Khadi', auto: 'new:material' },
    { h: 'Supplier note', sample: 'Ask Rahim before reordering', auto: '' },
    { h: '', sample: '10023', auto: '' }
  ]
};
var PROBLEMS = [
  { row: 14, t: 'price', msg: 'Not a number: “1,8OO”.' },
  { row: 22, t: 'title:bn', msg: 'Empty. Every product needs a name in বাংলা.' },
  { row: 37, t: 'stock', msg: 'Not a whole number: “12.5”.' },
  { row: 58, t: 'sku', msg: 'PJ-IV-M is already used in row 3.' },
  { row: 58, t: 'option1Value', msg: 'M appears twice for this product.' },
  { row: 91, t: 'categories', msg: 'There’s no category “Mens › Panjabi”.' },
  { row: 120, t: 'price', msg: 'Empty. Every variant needs a price.' },
  { row: 120, t: 'compareAtPrice', msg: 'Lower than the price.' },
  { row: 203, t: 'images', msg: 'Not a web address: “pj-iv-3.jpg”.' }
];
var JOBS = [
  { id: 'j3', file: 'winter-stock.xlsx', when: '21 Oct, 4:12 pm', phase: 'done', total: 96, processed: 96, created: 84, updated: 12, failed: 0, imgTotal: 190, imgDone: 190, imgFailed: 0, errors: [] },
  {
    id: 'j2', file: 'eid-collection.csv', when: '2 Oct, 11:40 am', phase: 'done', total: 137, processed: 137, created: 120, updated: 14, failed: 3, imgTotal: 410, imgDone: 410, imgFailed: 5,
    errors: [{ row: 31, col: 'Categories', msg: 'The category was deleted while importing.' }, { row: 77, col: 'SKU', msg: 'EID-KR-L is used by a product added meanwhile.' }, { row: 102, col: 'Image URLs', msg: 'The image is larger than 20 MB.' }]
  },
  { id: 'j1', file: 'shopify-export.csv', when: '14 Sep, 9:05 pm', phase: 'failed', total: 180, processed: 42, created: 40, updated: 0, failed: 2, imgTotal: 0, imgDone: 0, imgFailed: 0, lastError: 'the connection to the server dropped', errors: [{ row: 12, col: 'Variant Price', msg: 'Not a number: “Tk 950”.' }, { row: 40, col: 'Handle', msg: 'Two products use the handle “kurti”.' }] }
];
var TYPES = [{ v: 'choice', label: 'One choice' }, { v: 'multi_choice', label: 'Several choices' }, { v: 'number', label: 'Number' }, { v: 'text', label: 'Text' }, { v: 'boolean', label: 'Yes or no' }];
var STEPS = ['Choose a file', 'Match columns', 'Check', 'Import'];
var STATUS = {
  staging: { label: 'Getting ready', tone: 'run' }, running: { label: 'Importing', tone: 'run' }, images: { label: 'Adding images', tone: 'run' },
  done: { label: 'Done', tone: 'ok' }, failed: { label: 'Stopped', tone: 'bad' }, cancelled: { label: 'Cancelled', tone: 'off' }
};
function job(phase, extra) {
  return Object.assign({ id: 'new', file: FILE.name, when: 'Just now', phase: phase, live: false, chunks: 10, sent: 10, total: 91, processed: 0, created: 0, updated: 0, failed: 0, imgTotal: 540, imgDone: 0, imgFailed: 0, errors: [], leftOut: 7, dryCount: 9 }, extra);
}
var START = {
  'Choose file': {}, 'Unreadable file': { err: true }, 'Match columns': { step: 'map' }, 'Column list': { step: 'map', combo: 'c13' },
  'New attribute': { step: 'map', combo: 'a13' }, Check: { step: 'check' },
  Importing: { step: 'job', job: job('running', { processed: 54, created: 47, updated: 7 }) },
  'Adding images': { step: 'job', job: job('images', { processed: 91, created: 78, updated: 13, imgDone: 312, imgFailed: 1 }) },
  Done: { step: 'job', job: job('done', { processed: 91, created: 78, updated: 13, imgDone: 540, imgFailed: 2 }) },
  'Stopped import': { step: 'job', job: JOBS[2] }
};
var FONTS = {
  Inter: "'Inter', 'Noto Sans Bengali', system-ui, sans-serif",
  Geist: "'Geist', 'Noto Sans Bengali', system-ui, sans-serif"
};
function copy(x) { return JSON.parse(JSON.stringify(x)); }
function n(x) { return x.toLocaleString('en-US'); }
function plural(x, one, many) { return n(x) + ' ' + (x === 1 ? one : many); }
function advance(j) {
  j = Object.assign({}, j);
  if (j.phase === 'staging') {
    j.sent = Math.min(j.chunks, j.sent + 2);
    if (j.sent >= j.chunks) j.phase = 'running';
  } else if (j.phase === 'running') {
    j.processed = Math.min(j.total, j.processed + 4);
    j.created = Math.round(j.processed * 0.86);
    j.updated = j.processed - j.created;
    if (j.processed >= j.total) j.phase = j.imgTotal ? 'images' : 'done';
  } else if (j.phase === 'images') {
    j.imgDone = Math.min(j.imgTotal, j.imgDone + 18);
    j.imgFailed = j.imgDone > 400 ? 2 : j.imgDone > 150 ? 1 : 0;
    if (j.imgDone >= j.imgTotal) { j.phase = 'done'; j.live = false; }
  }
  return j;
}

class Component extends DCLogic {
  renderVals() {
    var self = this;
    var startKey = this.props.startOn ?? 'Choose file';
    var s = this.state || {};
    if (s.started !== startKey) s = Object.assign({ started: startKey, dark: s.dark }, copy(START[startKey] || {}));
    var up = function (patch) { self.setState(Object.assign({}, s, patch, { started: startKey })); };
    var toast = function (text) {
      clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function () { self.setState({ toast: null }); }, 4000);
      return text;
    };
    var vals = {};
    var step = s.step || 'choose';
    var created = s.created || [];
    var maps = s.maps || FILE.columns.map(function (c) { return c.auto; });

    // Steps.
    var at = { choose: 0, map: 1, check: 2, job: 3 }[step];
    var finished = step === 'job' && s.job && ['done', 'failed', 'cancelled'].indexOf(s.job.phase) !== -1;
    vals.steps = STEPS.map(function (label, i) {
      var done = i < at || (finished && i === at);
      var cur = i === at && !done;
      return {
        label: label, num: String(i + 1), done: done, notDone: !done, current: cur ? 'step' : 'false',
        bg: done || cur ? 'var(--primary)' : 'transparent', fg: done || cur ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
        edge: done || cur ? 'var(--primary)' : 'var(--border)', color: done || cur ? 'var(--foreground)' : 'var(--muted-foreground)',
        weight: cur ? '600' : '500', notLast: i < STEPS.length - 1, line: i < at ? 'var(--primary)' : 'var(--border)',
        seg: i <= at ? 'var(--primary)' : 'var(--border)'
      };
    });
    vals.stepText = 'Step ' + (at + 1) + ' of 4 · ' + STEPS[at];
    vals.isChoose = step === 'choose'; vals.isMap = step === 'map'; vals.isCheck = step === 'check'; vals.isJob = step === 'job';
    vals.inWizard = step !== 'choose';
    vals.sample = function () { up({ toast: toast('Sample file downloaded: products-sample.xlsx') }); };

    // 1. Choose a file, and recent imports.
    vals.err = Boolean(s.err);
    vals.pickFile = function () { up({ step: 'map', err: false, maps: null, created: [], combo: null, atype: {} }); };
    vals.recent = JOBS.map(function (j) {
      var st = STATUS[j.phase];
      return {
        file: j.file, when: j.when, status: st.label,
        meta: j.when + ' · ' + j.created + ' added · ' + j.updated + ' updated · ' + (j.failed ? plural(j.failed, 'problem', 'problems') : 'no problems'),
        counts: j.created + ' added · ' + j.updated + ' updated · ' + (j.failed ? plural(j.failed, 'problem', 'problems') : 'no problems'),
        dotBg: st.tone === 'ok' ? 'var(--success)' : st.tone === 'bad' ? 'var(--destructive)' : 'var(--muted-foreground)',
        open: function () { up({ step: 'job', job: copy(j) }); }
      };
    });

    // 2. Match columns: each column of the file maps to one field, or is left out.
    var newAttrs = created.map(function (k) { return ['attr:' + k, k]; });
    var groups = GROUPS.map(function (g) { return g.g === 'Attributes' ? { g: g.g, items: g.items.concat(newAttrs) } : g; });
    var labelOf = function (v) {
      if (!v) return 'Don’t import';
      if (v.indexOf('new:') === 0) return v.slice(4) + ' (new attribute)';
      for (var i = 0; i < groups.length; i++) for (var k = 0; k < groups[i].items.length; k++) if (groups[i].items[k][0] === v) return groups[i].items[k][1];
      return v;
    };
    var colName = function (i) { return FILE.columns[i].h || 'Column ' + (i + 1); };
    var setMap = function (i, v) {
      var next = maps.map(function (m, k) { return k !== i && v && m === v ? '' : m; });
      next[i] = v;
      up({ maps: next, combo: null });
    };
    var allCombos = {};
    var colCombo = function (i) {
      var key = 'c' + i, open = s.combo === key;
      var ql = open ? (s.cq || '').trim().toLowerCase() : '';
      var items = [];
      var opt = function (v, label) {
        var on = maps[i] === v;
        var other = v ? maps.indexOf(v) : -1;
        var usedBy = other !== -1 && other !== i ? 'Now set for “' + colName(other) + '”' : '';
        return { head: false, isOpt: true, label: label, sub: usedBy, hasSub: Boolean(usedBy), check: on ? '1' : '0', aria: on ? 'true' : 'false', pick: function () { setMap(i, v); } };
      };
      if (!ql || 'don’t import skip'.indexOf(ql) !== -1) items.push(opt('', 'Don’t import'));
      groups.forEach(function (g) {
        var its = g.items.filter(function (it) { return !ql || it[1].toLowerCase().indexOf(ql) !== -1; });
        if (!its.length) return;
        items.push({ head: true, isOpt: false, label: g.g, sub: '', hasSub: false, check: '0', aria: 'false', pick: null });
        its.forEach(function (it) { items.push(opt(it[0], it[1])); });
      });
      var v = maps[i];
      var obj = {
        open: open, aria: open ? 'true' : 'false', title: 'What is “' + colName(i) + '”?', ph: 'Search fields', empty: 'No field found.',
        query: open ? (s.cq || '') : '', none: items.length === 0, items: items, multi: 'false', isMulti: false, doneText: '',
        display: labelOf(v), color: v ? 'var(--foreground)' : 'var(--muted-foreground)',
        toggle: function () { up({ combo: open ? null : key, cq: '' }); },
        onQuery: function (e) { up({ cq: e.target.value }); }
      };
      allCombos[key] = obj;
      return obj;
    };
    var atype = s.atype || {};
    var typeCombo = function (i, k) {
      var key = 'a' + i, open = s.combo === key;
      var ql = open ? (s.cq || '').trim().toLowerCase() : '';
      var cur = atype[k] || '';
      var items = TYPES.filter(function (t) { return !ql || t.label.toLowerCase().indexOf(ql) !== -1; }).map(function (t) {
        var on = cur === t.v;
        return {
          head: false, isOpt: true, label: t.label, sub: '', hasSub: false, check: on ? '1' : '0', aria: on ? 'true' : 'false',
          pick: function () { var a = Object.assign({}, atype); a[k] = t.v; up({ atype: a, combo: null }); }
        };
      });
      var curT = TYPES.filter(function (t) { return t.v === cur; })[0];
      var obj = {
        open: open, aria: open ? 'true' : 'false', title: 'Type for “' + k + '”', ph: 'Search types', empty: 'No type found.',
        query: open ? (s.cq || '') : '', none: items.length === 0, items: items, multi: 'false', isMulti: false, doneText: '',
        display: curT ? curT.label : 'Choose a type', color: curT ? 'var(--foreground)' : 'var(--muted-foreground)',
        toggle: function () { up({ combo: open ? null : key, cq: '' }); },
        onQuery: function (e) { up({ cq: e.target.value }); }
      };
      allCombos[key] = obj;
      return obj;
    };
    vals.cols = FILE.columns.map(function (c, i) {
      var v = maps[i];
      var unknown = Boolean(v) && v.indexOf('new:') === 0;
      var k = unknown ? v.slice(4) : '';
      var curType = TYPES.filter(function (t) { return t.v === atype[k]; })[0];
      return {
        name: colName(i), sample: c.sample || 'Empty', nameColor: c.h ? 'var(--foreground)' : 'var(--muted-foreground)',
        nameStyle: c.h ? 'normal' : 'italic',
        combo: colCombo(i), ignored: !v, unknown: unknown, key: k,
        unknownText: 'There’s no attribute with the key “' + k + '”. Create it as:',
        type: typeCombo(i, k), cantCreate: !curType,
        create: function () {
          if (!curType) return;
          var next = maps.slice(); next[i] = 'attr:' + k;
          up({ maps: next, created: created.concat([k]), combo: null, toast: toast('Attribute “' + k + '” created as ' + curType.label.toLowerCase() + '.') });
        },
        skip: function () { setMap(i, ''); }
      };
    });
    var importing = maps.filter(function (m) { return m && m.indexOf('new:') !== 0; }).length;
    var skipped = maps.filter(function (m) { return !m; }).length;
    var attention = maps.filter(function (m) { return m && m.indexOf('new:') === 0; }).length;
    vals.fileName = FILE.name;
    vals.fileMeta = plural(FILE.rows, 'row', 'rows') + ' · ' + plural(FILE.columns.length, 'column', 'columns');
    vals.sumImport = importing + ' to import';
    vals.sumSkip = skipped + ' skipped';
    vals.hasAttention = attention > 0;
    vals.sumAttention = plural(attention, 'needs', 'need') + ' a choice';
    var missing = [];
    if (maps.indexOf('title:bn') === -1) missing.push('a title in বাংলা');
    if (maps.indexOf('price') === -1) missing.push('a price');
    vals.missing = missing.length > 0;
    vals.missingText = 'The file needs ' + missing.join(' and ') + '. Set the columns that hold them.';
    vals.cantCheck = missing.length > 0 || attention > 0;
    vals.checkHint = attention > 0 ? 'Choose what to do with the new attribute first.' : '';
    vals.hasCheckHint = attention > 0 && missing.length === 0;
    vals.check = function () { up({ step: 'check', combo: null }); };
    vals.chooseAgain = function () { up({ step: 'choose', maps: null, combo: null }); };

    var active = allCombos[s.combo] || null;
    vals.comboOpen = Boolean(active) && step === 'map';
    vals.cbd = active || vals.cols[0].combo;
    vals.closeCombo = function () { up({ combo: null }); };
    vals.comboEsc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); up({ combo: null }); } };

    // 3. Check: the dry run, in the browser, before anything is sent.
    var where = {};
    maps.forEach(function (m, i) { if (m) where[m] = i; });
    var probs = PROBLEMS.filter(function (p) { return p.t in where; }).map(function (p) { return { row: String(p.row), col: colName(where[p.t]), msg: p.msg }; });
    var badRows = probs.map(function (p) { return p.row; }).filter(function (r, i, a) { return a.indexOf(r) === i; }).length;
    var ready = FILE.products - badRows;
    var variants = FILE.rows - badRows * 3;
    vals.dry = {
      ready: n(ready), variants: n(variants), left: n(badRows), probsN: n(probs.length), leftColor: badRows ? 'var(--destructive)' : 'var(--foreground)',
      startShort: 'Import ' + plural(ready, 'product', 'products'),
      readyText: 'Ready: ' + plural(ready, 'product', 'products') + ' with ' + plural(variants, 'variant', 'variants') + '.',
      has: probs.length > 0, none: probs.length === 0,
      summary: plural(probs.length, 'problem', 'problems') + ' in ' + plural(badRows, 'row', 'rows') + '. Those products are left out; fix them in the file and import it again to add them.',
      problems: probs,
      startText: probs.length ? 'Import the ' + n(ready) + ' products without problems' : 'Import ' + plural(ready, 'product', 'products')
    };
    vals.downloadProblems = function () { up({ toast: toast('Downloaded nakshi-products-problems.csv') }); };
    vals.back = function () { up({ step: 'map' }); };
    vals.start = function () {
      up({ step: 'job', job: job('staging', { live: true, sent: 0, chunks: Math.ceil(ready / 10), total: ready, leftOut: badRows, dryCount: probs.length, dryProblems: probs }) });
    };

    // 4. The import: progress, then the image step, then the result.
    var j = s.job || job('running');
    var st = STATUS[j.phase];
    var running = ['staging', 'running', 'images'].indexOf(j.phase) !== -1;
    var pct = j.phase === 'images' || j.phase === 'done' ? 100 : (j.total ? Math.round(j.processed / j.total * 100) : 0);
    var imgPct = j.imgTotal ? Math.round(j.imgDone / j.imgTotal * 100) : 0;
    var errs = (j.errors || []).map(function (e) { return { row: String(e.row), col: e.col, msg: e.msg }; });
    var left = j.dryProblems || [];
    vals.jb = {
      file: j.file, when: j.when, status: st.label,
      badgeBg: st.tone === 'ok' ? 'color-mix(in oklch, var(--success) 14%, transparent)' : st.tone === 'bad' ? 'color-mix(in oklch, var(--destructive) 12%, transparent)' : 'var(--secondary)',
      badgeFg: st.tone === 'ok' ? 'var(--success)' : st.tone === 'bad' ? 'var(--destructive)' : 'var(--secondary-foreground)',
      running: running, staging: j.phase === 'staging', isImages: j.phase === 'images', isDone: j.phase === 'done', isFailed: j.phase === 'failed', isCancelled: j.phase === 'cancelled',
      finished: !running,
      stagingText: 'Sending the file… ' + j.sent + ' of ' + j.chunks + '. Keep this page open until it’s sent.',
      pct: pct + '%', progressText: n(j.processed) + ' of ' + n(j.total) + ' products done',
      added: n(j.created), updated: n(j.updated), failed: n(j.failed),
      showImages: j.imgTotal > 0 && (j.phase === 'images' || j.phase === 'done'),
      imgPct: imgPct + '%', imgText: n(j.imgDone) + ' of ' + n(j.imgTotal) + ' images done',
      imgSummary: 'Images: ' + n(j.imgDone - j.imgFailed) + ' added' + (j.imgFailed ? ', ' + n(j.imgFailed) + ' couldn’t be downloaded. Add those from the product page.' : '.'),
      imgFailedLine: j.imgFailed ? n(j.imgFailed) + ' couldn’t be downloaded' : '',
      doneText: plural(j.created, 'product', 'products') + ' added and ' + n(j.updated) + ' updated' + (j.failed ? '. ' + plural(j.failed, 'row', 'rows') + ' had problems.' : '.'),
      failedText: 'The import stopped: ' + (j.lastError || 'something went wrong') + '. ' + n(j.processed) + ' of ' + n(j.total) + ' products were done before it stopped.',
      cancelledText: 'Import cancelled. ' + plural(j.created + j.updated, 'product was', 'products were') + ' already done and stay as they are.',
      hasErrors: errs.length > 0, errors: errs, errorsTitle: plural(errs.length, 'problem', 'problems') + ' while importing',
      hasLeft: left.length > 0 && !running, leftText: plural(j.leftOut || 0, 'product was', 'products were') + ' left out before importing, with ' + plural(left.length, 'problem', 'problems') + '.',
      cancel: function () { up({ confirm: true }); },
      another: function () { up({ step: 'choose', job: null, maps: null, created: [], atype: {}, err: false }); }
    };
    vals.canBack = step === 'map' || step === 'check' || (step === 'job' && !running);
    vals.headerBack = step === 'check' ? vals.back : step === 'job' ? vals.jb.another : vals.chooseAgain;
    vals.backAria = step === 'check' ? 'Back to columns' : step === 'job' ? 'Back to import' : 'Choose another file';
    vals.confirmOpen = Boolean(s.confirm);
    vals.keepGoing = function () { up({ confirm: false }); };
    vals.doCancel = function () { up({ confirm: false, job: Object.assign({}, j, { phase: 'cancelled', live: false }), toast: toast('Import cancelled.') }); };

    var live = step === 'job' && j.live && running;
    if (live && !this.tick) {
      this.tick = setInterval(function () {
        var cur = self.state;
        if (!cur || !cur.job) return;
        self.setState({ job: advance(cur.job) });
      }, 180);
    }
    if (!live && this.tick) { clearInterval(this.tick); this.tick = null; }

    vals.closeAll = function () { up({ combo: null, confirm: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ combo: null, confirm: false }); } };
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
