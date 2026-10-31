var GEO = {
  Dhaka: { Dhaka: ['Badda', 'Banani', 'Dhanmondi', 'Gulshan', 'Mirpur', 'Mohammadpur', 'Motijheel', 'Tejgaon', 'Uttara'], Gazipur: ['Gazipur Sadar', 'Kaliakair', 'Sreepur', 'Tongi'], Narayanganj: ['Narayanganj Sadar', 'Rupganj', 'Sonargaon'], Tangail: ['Delduar', 'Mirzapur', 'Tangail Sadar'] },
  Chattogram: { Chattogram: ['Double Mooring', 'Halishahar', 'Kotwali', 'Pahartali', 'Panchlaish'], 'Cox’s Bazar': ['Cox’s Bazar Sadar', 'Teknaf', 'Ukhia'], Cumilla: ['Cumilla Sadar', 'Laksam'] },
  Rajshahi: { Rajshahi: ['Boalia', 'Motihar', 'Paba'], Bogura: ['Bogura Sadar', 'Sherpur'] },
  Khulna: { Khulna: ['Daulatpur', 'Khulna Sadar', 'Sonadanga'], Jashore: ['Benapole', 'Jashore Sadar'] },
  Sylhet: { Sylhet: ['Beanibazar', 'Sylhet Sadar'], Moulvibazar: ['Moulvibazar Sadar', 'Sreemangal'] },
  Barishal: { Barishal: ['Bakerganj', 'Barishal Sadar'] },
  Rangpur: { Rangpur: ['Pirganj', 'Rangpur Sadar'], Dinajpur: ['Dinajpur Sadar'] },
  Mymensingh: { Mymensingh: ['Mymensingh Sadar', 'Trishal'] }
};
var DETAIL = {
  c1: {
    risk: { decided: 10, delivered: 9, returned: 1, fake: 0, wrongNumber: 0, noAnswer: 0, cancelled: 1, open: 1, score: 90, reasons: [] },
    list: [
      { n: 1048, date: '26 Oct', status: 'Confirmed', delivery: 'Not shipped', total: 2750 },
      { n: 1031, date: '14 Oct', status: 'Completed', delivery: 'Delivered', total: 1850 },
      { n: 1002, date: '28 Sep', status: 'Completed', delivery: 'Delivered', total: 4200 },
      { n: 987, date: '9 Sep', status: 'Cancelled', delivery: 'Not shipped', total: 1250 },
      { n: 951, date: '21 Aug', status: 'Completed', delivery: 'Delivery failed', total: 3400 },
      { n: 920, date: '30 Jul', status: 'Completed', delivery: 'Delivered', total: 2100 }
    ],
    addresses: [
      { id: 'a1', label: 'Home', name: 'Rahim Ahmed', phone: '01712345678', div: 'Dhaka', dist: 'Dhaka', area: 'Dhanmondi', line: 'House 12, Road 5, near Abahani field', isDefault: true },
      { id: 'a2', label: 'Office', name: 'Rahim Ahmed', phone: '01712345678', div: 'Dhaka', dist: 'Dhaka', area: 'Gulshan', line: 'Level 4, 32 Gulshan Avenue', isDefault: false }
    ]
  },
  c3: {
    risk: { decided: 3, delivered: 1, returned: 2, fake: 0, wrongNumber: 0, noAnswer: 0, cancelled: 0, open: 0, score: 33, reasons: ['failed_deliveries', 'low_score'] },
    list: [
      { n: 1040, date: '20 Oct', status: 'Completed', delivery: 'Delivery failed', total: 1650 },
      { n: 1012, date: '3 Oct', status: 'Completed', delivery: 'Delivery failed', total: 1400 },
      { n: 966, date: '2 Jul', status: 'Completed', delivery: 'Delivered', total: 1150 }
    ],
    addresses: [{ id: 'a3', label: '', name: 'Tanvir Hasan', phone: '01911778899', div: 'Chattogram', dist: 'Chattogram', area: 'Halishahar', line: 'Block K, Lane 3, H 22', isDefault: true }]
  },
  c7: { risk: { decided: 0, delivered: 0, returned: 0, fake: 0, wrongNumber: 0, noAnswer: 0, cancelled: 0, open: 0, score: null, reasons: [] }, list: [], addresses: [] }
};
var STATUS_TONE = { Completed: 'ok', Confirmed: 'run', Pending: 'run', Processing: 'run', Cancelled: 'off' };
var DELIVERY_DOT = { Delivered: 'var(--success)', 'Delivery failed': 'var(--destructive)', Shipped: 'var(--sidebar-primary)', 'Partly shipped': 'var(--sidebar-primary)', 'Not shipped': 'var(--muted-foreground)' };
var START = {
  Customer: { cid: 'c1' }, 'Flagged customer': { cid: 'c3' }, 'No orders yet': { cid: 'c7' }, 'More menu': { cid: 'c1', more: true },
  'Edit customer': { cid: 'c1', form: { mode: 'edit', id: 'c1' } }, 'Add address': { cid: 'c1', addr: { mode: 'new' } }, 'Edit address': { cid: 'c1', addr: { mode: 'edit', id: 'a2' } },
  'Area list': { cid: 'c1', addr: { mode: 'edit', id: 'a2' }, combo: 'area' }, 'Delete personal data': { cid: 'c1', confirm: 'anon' }
};

class Component extends DCLogic {
  renderVals() {
    var self = this;
    var startKey = this.props.startOn ?? 'Customer';
    var s = this.state || {};
    if (s.started !== startKey) s = Object.assign({ started: startKey, dark: s.dark }, copy(START[startKey] || {}));
    var up = function (patch) { self.setState(Object.assign({}, s, patch, { started: startKey })); };
    var toast = function (text) {
      clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function () { self.setState({ toast: null }); }, 4000);
      return text;
    };
    var vals = {};
    var cid = s.cid || 'c1';
    var c = s.cust || Object.assign(copy(CUSTOMERS.filter(function (x) { return x.id === cid; })[0]), copy(DETAIL[cid] || DETAIL.c7));
    var setC = function (patch, extra) { up(Object.assign({ cust: Object.assign({}, c, patch) }, extra || {})); };
    var r = c.risk;
    r.risky = c.flagged || r.reasons.length > 0;
    c.score = r.score;
    c.risky = r.risky;

    // Header.
    vals.c = {
      name: c.name, initials: initials(c.name),
      meta: [fmtPhone(c.phone), c.email, c.since ? 'Customer since ' + c.since : 'Added, no orders yet'].filter(Boolean).join(' · '),
      tel: 'tel:+88' + c.phone, wa: 'https://wa.me/88' + c.phone,
      badge: riskBadge(c)
    };
    var reasonText = c.flagged
      ? 'Flagged by staff. Orders from this phone ask for the delivery charge in advance or a code, as the store chose.'
      : r.reasons.indexOf('failed_deliveries') !== -1
        ? 'Flagged: ' + plural(c.failed || r.returned, 'delivery', 'deliveries') + ' came back. Orders from this phone ask for the delivery charge in advance or a code, as the store chose.'
        : 'Risky: the delivery score is under the store’s threshold. Orders from this phone ask for the delivery charge in advance or a code, as the store chose.';
    var clearable = c.flagged || r.reasons.indexOf('failed_deliveries') !== -1;
    vals.flag = {
      on: r.risky, text: reasonText, clearable: clearable,
      clear: function () {
        var nr = Object.assign({}, r, { reasons: r.reasons.filter(function (x) { return x === 'low_score'; }) });
        setC({ flagged: false, failed: 0, risk: nr }, { more: false, toast: toast('Flag cleared. Failed deliveries are reset.') });
      },
      canFlag: !c.flagged,
      set: function () { setC({ flagged: true }, { more: false, toast: toast(c.name + ' is flagged.') }); },
      menuText: c.flagged || clearable ? 'Clear the flag' : 'Flag this customer'
    };
    vals.flagToggle = clearable ? vals.flag.clear : vals.flag.set;

    // Numbers.
    vals.stats = [
      { label: 'Total spent', value: c.orders ? money(c.spent) : '—' },
      { label: 'Orders', value: String(c.orders) },
      { label: 'Average order', value: c.orders ? money(c.spent / c.orders) : '—' },
      { label: 'Last order', value: c.last || '—' }
    ];

    // Orders.
    var list = c.list || [];
    vals.orders = list.slice(0, 5).map(function (o) {
      var tone = STATUS_TONE[o.status] || 'run';
      return {
        number: '#' + o.n, date: o.date, status: o.status, delivery: o.delivery, total: money(o.total),
        dot: DELIVERY_DOT[o.delivery] || 'var(--muted-foreground)',
        sBg: tone === 'ok' ? 'var(--secondary)' : tone === 'off' ? 'transparent' : 'var(--primary)',
        sFg: tone === 'ok' ? 'var(--secondary-foreground)' : tone === 'off' ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
        sEdge: tone === 'off' ? 'var(--border)' : 'transparent',
        aria: 'Order #' + o.n + ', ' + o.date + ', ' + o.status + ', ' + o.delivery + ', ' + money(o.total)
      };
    });
    vals.hasOrders = list.length > 0;
    vals.noOrders = list.length === 0;
    vals.moreOrders = c.orders > 5;
    vals.allOrdersText = 'View all ' + c.orders + ' orders';

    // Delivery record.
    var counts = [
      r.returned && plural(r.returned, 'came back', 'came back').replace(/^(\d+) came back$/, '$1 came back'),
      r.fake && r.fake + ' fake', r.wrongNumber && r.wrongNumber + ' wrong number', r.noAnswer && r.noAnswer + ' no answer',
      r.cancelled && r.cancelled + ' cancelled for other reasons', r.open && r.open + ' open'
    ].filter(Boolean);
    var reasons = [];
    if (c.flagged) reasons.push('Flagged by staff.');
    if (r.reasons.indexOf('failed_deliveries') !== -1) reasons.push(plural(c.failed || r.returned, 'delivery', 'deliveries') + ' came back.');
    if (r.reasons.indexOf('low_score') !== -1) reasons.push('The score is under the store’s threshold.');
    vals.risk = {
      isNew: r.decided === 0, known: r.decided > 0,
      big: r.decided ? r.delivered + ' of ' + r.decided + ' delivered' : 'No history yet',
      bar: r.decided ? Math.round(r.delivered / r.decided * 100) + '%' : '0%',
      counts: counts.join(' · '), hasCounts: counts.length > 0,
      reasons: reasons.map(function (x) { return { text: x }; }), hasReasons: reasons.length > 0,
      newText: 'No delivered or undelivered orders from this phone yet.'
    };

    // Addresses.
    var addrs = c.addresses || [];
    vals.addresses = addrs.map(function (a) {
      var menuOpen = s.amenu === a.id;
      return {
        title: a.label || a.name, isDefault: a.isDefault, notDefault: !a.isDefault,
        who: a.name + ' · ' + fmtPhone(a.phone), line: a.line, place: a.area + ', ' + a.dist,
        menuOpen: menuOpen, menuAria: 'Actions for ' + (a.label || 'address'), menuExpanded: menuOpen ? 'true' : 'false',
        toggleMenu: function () { up({ amenu: menuOpen ? null : a.id }); },
        edit: function () { up({ amenu: null, addr: { mode: 'edit', id: a.id }, ad: null }); },
        makeDefault: function () { setC({ addresses: addrs.map(function (x) { return Object.assign({}, x, { isDefault: x.id === a.id }); }) }, { amenu: null, toast: toast('Default address changed.') }); },
        remove: function () {
          var rest = addrs.filter(function (x) { return x.id !== a.id; });
          if (a.isDefault && rest.length) rest[0] = Object.assign({}, rest[0], { isDefault: true });
          setC({ addresses: rest }, { amenu: null, toast: toast('Address deleted.') });
        }
      };
    });
    vals.hasAddresses = addrs.length > 0;
    vals.noAddresses = addrs.length === 0;
    vals.canAddAddress = addrs.length < 10;
    vals.addAddress = function () { up({ addr: { mode: 'new' }, ad: null, more: false }); };

    // Note and tags.
    vals.note = c.note || '';
    vals.hasNote = Boolean(c.note);
    vals.tags = c.tags.map(function (t) { return { label: t }; });
    vals.hasTags = c.tags.length > 0;
    vals.noNoteTags = !c.note && !c.tags.length;

    // Edit customer.
    var asList = CUSTOMERS.map(function (x) { return x.id === c.id ? c : x; });
    vals.f = customerForm(s, up, asList, function (data) {
      setC(data, { form: null, fd: null, toast: toast('Customer saved.') });
    }, function () { up({ form: null, fd: null, confirm: 'delete' }); });
    vals.edit = function () { up({ form: { mode: 'edit', id: c.id }, fd: null, more: false }); };
    vals.closeForm = function () { up({ form: null, fd: null }); };

    // Address: division, district and area from the list, then the street.
    var addr = s.addr || null;
    var editingA = addr && addr.mode === 'edit' ? addrs.filter(function (a) { return a.id === addr.id; })[0] : null;
    var akey = JSON.stringify(addr);
    var ad = s.ad && s.adFor === akey ? s.ad : (editingA
      ? Object.assign(copy(editingA), { phone: fmtPhone(editingA.phone), tried: false })
      : { name: c.name, phone: fmtPhone(c.phone), div: '', dist: '', area: '', line: '', label: '', isDefault: addrs.length === 0, tried: false });
    var setA = function (patch, extra) { up(Object.assign({ ad: Object.assign({}, ad, patch), adFor: akey }, extra || {})); };
    var combo = function (key, cfg) {
      var open = s.combo === key;
      var ql = open ? (s.cq || '').trim().toLowerCase() : '';
      var shown = cfg.options.filter(function (o) { return !ql || o.toLowerCase().indexOf(ql) !== -1; });
      return {
        open: open, aria: open ? 'true' : 'false', title: cfg.title, ph: cfg.ph, disabled: cfg.disabled,
        query: open ? (s.cq || '') : '', none: shown.length === 0, empty: cfg.empty,
        display: cfg.current || 'Choose…', color: cfg.current ? 'var(--foreground)' : 'var(--muted-foreground)',
        toggle: function () { up({ combo: open ? null : key, cq: '' }); },
        onQuery: function (e) { up({ cq: e.target.value }); },
        items: shown.map(function (o) {
          var on = o === cfg.current;
          return { label: o, check: on ? '1' : '0', aria: on ? 'true' : 'false', pick: function () { cfg.pick(o); } };
        })
      };
    };
    var cDiv = combo('div', { title: 'Division', ph: 'Search divisions', empty: 'No division found.', current: ad.div, options: Object.keys(GEO), disabled: false, pick: function (v) { setA({ div: v, dist: v === ad.div ? ad.dist : '', area: v === ad.div ? ad.area : '' }, { combo: null }); } });
    var cDist = combo('dist', { title: 'District', ph: 'Search districts', empty: 'No district found.', current: ad.dist, options: ad.div ? Object.keys(GEO[ad.div]) : [], disabled: !ad.div, pick: function (v) { setA({ dist: v, area: v === ad.dist ? ad.area : '' }, { combo: null }); } });
    var cArea = combo('area', { title: 'Area (thana or upazila)', ph: 'Search areas', empty: 'No area found.', current: ad.area, options: ad.div && ad.dist ? GEO[ad.div][ad.dist] : [], disabled: !ad.dist, pick: function (v) { setA({ area: v }, { combo: null }); } });
    var aph = phoneOk(ad.phone);
    var ready = ad.name.trim() && aph && ad.area && ad.line.trim();
    var missing = [];
    if (!ad.name.trim()) missing.push('name');
    if (!aph) missing.push('phone');
    if (!ad.area) missing.push('area');
    if (!ad.line.trim()) missing.push('street address');
    var defSw = ad.isDefault;
    vals.ad = {
      open: Boolean(addr), title: editingA ? 'Edit address' : 'Add address', isEdit: Boolean(editingA),
      remove: function () {
        if (!editingA) return;
        var rest = addrs.filter(function (x) { return x.id !== editingA.id; });
        if (editingA.isDefault && rest.length) rest[0] = Object.assign({}, rest[0], { isDefault: true });
        setC({ addresses: rest }, { addr: null, ad: null, combo: null, toast: toast('Address deleted.') });
      },
      name: ad.name, onName: function (e) { setA({ name: e.target.value }); },
      phone: ad.phone, onPhone: function (e) { setA({ phone: e.target.value }); },
      div: cDiv, dist: cDist, area: cArea,
      line: ad.line, onLine: function (e) { setA({ line: e.target.value }); },
      label: ad.label, onLabel: function (e) { setA({ label: e.target.value }); },
      quick: ['Home', 'Office', 'Parents'].map(function (l) { return { label: l, on: ad.label === l ? 'true' : 'false', pick: function () { setA({ label: ad.label === l ? '' : l }); } }; }),
      defAria: defSw ? 'true' : 'false', defBg: defSw ? 'var(--primary)' : 'var(--input)', defX: defSw ? '14px' : '0px',
      defLocked: addrs.length === 0 || Boolean(editingA && editingA.isDefault),
      toggleDef: function () { if (!(addrs.length === 0 || (editingA && editingA.isDefault))) setA({ isDefault: !ad.isDefault }); },
      defHint: addrs.length === 0 ? 'The first address is the default.' : editingA && editingA.isDefault ? 'To change it, make another address the default.' : 'New orders for them start with it.',
      showMissing: ad.tried && !ready, missingText: 'Add the ' + missing.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.',
      save: function () {
        if (!ready) { setA({ tried: true }); return; }
        var saved = { id: editingA ? editingA.id : 'a' + Date.now(), label: ad.label.trim(), name: ad.name.trim(), phone: aph, div: ad.div, dist: ad.dist, area: ad.area, line: ad.line.trim(), isDefault: ad.isDefault };
        var next = editingA ? addrs.map(function (x) { return x.id === saved.id ? saved : x; }) : addrs.concat([saved]);
        if (saved.isDefault) next = next.map(function (x) { return Object.assign({}, x, { isDefault: x.id === saved.id }); });
        setC({ addresses: next }, { addr: null, ad: null, combo: null, toast: toast(editingA ? 'Address saved.' : 'Address added.') });
      }
    };
    vals.closeAddr = function () { up({ addr: null, ad: null, combo: null }); };
    var active = s.combo === 'div' ? cDiv : s.combo === 'dist' ? cDist : s.combo === 'area' ? cArea : null;
    vals.comboOpen = Boolean(active) && Boolean(addr);
    vals.cbd = active || cDiv;
    vals.closeCombo = function () { up({ combo: null }); };
    vals.comboEsc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); up({ combo: null }); } };

    // More: delete, and deleting their personal data on request.
    vals.moreOpen = Boolean(s.more);
    vals.toggleMore = function () { up({ more: !s.more }); };
    vals.copyPhone = function () { up({ more: false, toast: toast('Phone number copied.') }); };
    vals.askDelete = function () { up({ more: false, confirm: 'delete' }); };
    vals.askAnon = function () { up({ more: false, confirm: 'anon', typed: '' }); };
    vals.isDelete = s.confirm === 'delete';
    vals.isAnon = s.confirm === 'anon';
    vals.confirmOpen = Boolean(s.confirm);
    vals.deleteTitle = 'Delete ' + c.name + '?';
    vals.anonTitle = 'Delete ' + c.name + '’s personal data?';
    vals.typed = s.typed || '';
    vals.onTyped = function (e) { up({ typed: e.target.value }); };
    vals.anonReady = phoneOk(s.typed) === c.phone;
    vals.anonNotReady = !vals.anonReady;
    vals.anonLabel = 'Type ' + fmtPhone(c.phone) + ' to confirm';
    vals.cancelConfirm = function () { up({ confirm: null, typed: '' }); };

    var reset = { more: false, amenu: null, form: null, fd: null, addr: null, ad: null, combo: null, confirm: null, typed: '' };
    vals.closeAll = function () { up(reset); };
    vals.closePop = function () { up({ more: false, amenu: null }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up(s.combo ? { combo: null } : reset); } };
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
