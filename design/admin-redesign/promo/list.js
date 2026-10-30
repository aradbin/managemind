var START = { List: {}, 'Live only': { st: 'live' }, 'Type filter': { pop: 'kind' }, 'Row menu': { menu: 'eid' }, 'End now': { confirm: 'flash' } };

class Component extends DCLogic {
  renderVals() {
    var self = this;
    var startKey = this.props.startOn ?? 'List';
    var s = this.state || {};
    if (s.started !== startKey) s = Object.assign({ started: startKey, dark: s.dark }, copy(START[startKey] || {}));
    var up = function (patch) { self.setState(Object.assign({}, s, patch, { started: startKey })); };
    var toast = function (text) {
      clearTimeout(self.toastTimer);
      self.toastTimer = setTimeout(function () { self.setState({ toast: null }); }, 4000);
      return text;
    };
    var vals = {};
    var promos = s.promos || PROMOS;
    var setP = function (id, patch, text) {
      up({ promos: promos.map(function (p) { return p.id === id ? Object.assign({}, p, patch) : p; }), menu: null, confirm: null, toast: toast(text) });
    };
    var q = (s.q || '').trim().toLowerCase();
    var st = s.st || 'all';
    var kinds = s.kinds || [];
    vals.q = s.q || '';
    vals.onQ = function (e) { up({ q: e.target.value }); };
    var base = promos.filter(function (p) {
      return (!kinds.length || kinds.indexOf(p.kind) !== -1) && (!q || title(p).toLowerCase().indexOf(q) !== -1 || p.titleBn.indexOf(q) !== -1 || (p.code && p.code.toLowerCase().indexOf(q) !== -1));
    });
    vals.stTabs = [['all', 'All'], ['live', 'Live'], ['scheduled', 'Scheduled'], ['draft', 'Draft'], ['paused', 'Paused'], ['ended', 'Ended']].map(function (t) {
      var n = t[0] === 'all' ? base.length : base.filter(function (p) { return stateOf(p) === t[0]; }).length;
      return { label: t[1], count: String(n), on: st === t[0] ? 'true' : 'false', pick: function () { up({ st: t[0] }); } };
    });
    var list = base.filter(function (p) { return st === 'all' || stateOf(p) === st; });
    var rowOf = function (p) {
      var state = stateOf(p), ss = STATE_STYLE[state];
      var menuOpen = s.menu === p.id;
      var limit = num(p.usageLimit);
      return {
        title: title(p), isCode: p.kind === 'code', isAuto: p.kind !== 'code',
        code: p.code ? p.code : '', hasCode: Boolean(p.code), codes: p.code ? '' : plural(p.codeCount, 'code', 'codes'), noShared: p.kind === 'code' && !p.code,
        what: actionText(p),
        state: ss.label, sBg: ss.bg, sFg: ss.fg, sEdge: ss.edge || 'transparent',
        uses: limit ? p.uses.toLocaleString('en-US') + ' / ' + limit.toLocaleString('en-US') : p.uses.toLocaleString('en-US'),
        usePct: limit ? Math.min(100, Math.round(p.uses / limit * 100)) + '%' : '0%', hasLimit: Boolean(limit),
        orders: p.orders.toLocaleString('en-US'), discount: p.discount ? money(p.discount) : '—', sales: p.sales ? money(p.sales) : '—',
        dates: p.startsAt && p.endsAt ? day(p.startsAt) + ' – ' + day(p.endsAt) : p.startsAt ? 'From ' + day(p.startsAt) : p.endsAt ? 'Until ' + day(p.endsAt) : 'No end date',
        meta: (p.kind === 'code' ? (p.code ? p.code : plural(p.codeCount, 'code', 'codes')) : 'Automatic') + ' · ' + actionText(p),
        stats: p.uses ? plural(p.uses, 'use', 'uses') + ' · ' + money(p.discount) + ' off' : 'Not used yet',
        menuOpen: menuOpen, menuExpanded: menuOpen ? 'true' : 'false', menuAria: 'Actions for ' + title(p),
        toggleMenu: function () { up({ menu: menuOpen ? null : p.id }); },
        canCopy: Boolean(p.code), copyCode: function () { setP(p.id, {}, 'Code ' + p.code + ' copied.'); },
        canPause: state === 'live' || state === 'scheduled', pause: function () { setP(p.id, { status: 'paused' }, title(p) + ' is paused.'); },
        canResume: state === 'paused', resume: function () { setP(p.id, { status: 'active' }, title(p) + ' is live again.'); },
        canActivate: state === 'draft', activate: function () { setP(p.id, { status: 'active' }, title(p) + ' is active.'); },
        canEnd: state !== 'ended' && state !== 'draft', askEnd: function () { up({ menu: null, confirm: p.id }); }
      };
    };
    vals.rows = list.map(rowOf);
    vals.empty = list.length === 0;
    vals.emptyText = q || kinds.length || st !== 'all' ? 'No promotions match.' : 'No promotions yet.';
    vals.emptyCanReset = Boolean(q || kinds.length || st !== 'all');
    vals.emptyReset = function () { up({ q: '', kinds: [], st: 'all' }); };
    var mp = s.menu ? promos.filter(function (p) { return p.id === s.menu; })[0] : null;
    vals.menuOpen = Boolean(mp);
    vals.mp = rowOf(mp || promos[0]);

    var kOpen = s.pop === 'kind';
    var kq = kOpen ? (s.kq || '') : '';
    var kShown = [['automatic', 'Automatic'], ['code', 'Code']].filter(function (k) { return !kq.trim() || k[1].toLowerCase().indexOf(kq.trim().toLowerCase()) !== -1; });
    vals.kf = {
      open: kOpen, aria: kOpen ? 'true' : 'false', toggle: function () { up({ pop: kOpen ? null : 'kind', kq: '' }); },
      query: kq, onQuery: function (e) { up({ kq: e.target.value }); }, none: kShown.length === 0,
      has: kinds.length > 0, label: kinds.length === 1 ? (kinds[0] === 'code' ? 'Code' : 'Automatic') : '2 selected',
      count: String(kinds.length), buttonText: kinds.length === 1 ? (kinds[0] === 'code' ? 'Code' : 'Automatic') : 'Type',
      items: kShown.map(function (k) {
        var on = kinds.indexOf(k[0]) !== -1;
        return {
          label: k[1], on: on, aria: on ? 'true' : 'false', box: on ? 'var(--primary)' : 'transparent', edge: on ? 'var(--primary)' : 'var(--input)',
          count: String(promos.filter(function (p) { return p.kind === k[0]; }).length),
          toggle: function () { up({ kinds: on ? kinds.filter(function (x) { return x !== k[0]; }) : kinds.concat([k[0]]) }); }
        };
      }),
      clear: function () { up({ kinds: [], pop: null }); }
    };
    vals.hasFilters = Boolean(q || kinds.length);
    vals.clearAll = function () { up({ q: '', kinds: [] }); };

    var ep = s.confirm ? promos.filter(function (p) { return p.id === s.confirm; })[0] : null;
    vals.confirmOpen = Boolean(ep);
    vals.confirmTitle = ep ? 'End ' + title(ep) + '?' : '';
    vals.confirmText = 'It stops applying now. Orders that used it keep their discount, and its numbers stay here.';
    vals.doEnd = function () { setP(ep.id, { status: 'ended' }, title(ep) + ' has ended.'); };
    vals.cancelConfirm = function () { up({ confirm: null }); };

    var reset = { menu: null, pop: null, confirm: null };
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
