var START = { Pages: {}, 'New page menu': { menu: true }, 'Row menu': { rmenu: 'p3' }, 'Delete page': { dlg: 'p6' } };
var SPAGES = [['p1', 'about', 'আমাদের কথা', 'About us', true, '2026-08-14'], ['p2', 'contact', 'যোগাযোগ', 'Contact', true, '2026-08-14'], ['p3', 'returns', 'রিটার্ন নীতি', 'Returns', true, '2026-10-02'],
  ['p4', 'delivery', 'ডেলিভারি', 'Delivery', true, '2026-10-02'], ['p5', 'privacy', 'গোপনীয়তা নীতি', 'Privacy policy', true, '2026-08-20'], ['p6', 'custom', 'ঈদ কালেকশন গাইড', 'Eid collection guide', false, '2026-10-21']];
var KINDS = [['about', 'About us'], ['contact', 'Contact'], ['privacy', 'Privacy policy'], ['returns', 'Returns'], ['delivery', 'Delivery'], ['terms', 'Terms and conditions'], ['custom', 'Other page']];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Pages');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var pages = s.pages || SPAGES;
    vals.rows = pages.map(function (p) {
      var kind = KINDS.filter(function (k) { return k[0] === p[1]; })[0][1], t = p[4] ? TONE.good : ['var(--muted)', 'var(--muted-foreground)'];
      return { title: p[3], titleBn: p[2], kind: kind, chip: { label: p[4] ? 'Published' : 'Hidden', bg: t[0], fg: t[1], edge: 'transparent' }, updated: longDate(p[5]), href: P('StorePage'), aria: 'Edit ' + p[3],
        menuOpen: s.rmenu === p[0], menuAria: 'Actions for ' + p[3], toggleMenu: function () { up({ rmenu: s.rmenu === p[0] ? null : p[0] }); },
        isPub: p[4], isHidden: !p[4], toggle: function () { up({ rmenu: null, pages: pages.map(function (x) { return x === p ? [x[0], x[1], x[2], x[3], !x[4], x[5]] : x; }), toast: toast(p[4] ? p[3] + ' is hidden.' : p[3] + ' is published.') }); },
        view: function () { up({ rmenu: null, toast: toast('Opening ' + p[3] + ' in your store.') }); }, del: function () { up({ rmenu: null, dlg: p[0] }); } };
    });
    var used = pages.map(function (p) { return p[1]; });
    vals.kinds = KINDS.map(function (k) { var taken = k[0] !== 'custom' && used.indexOf(k[0]) !== -1; return { label: k[1], taken: taken, free: !taken, note: taken ? 'already added' : '', href: P('StorePage') }; });
    vals.menuOpen = Boolean(s.menu); vals.menuAria = s.menu ? 'true' : 'false'; vals.toggleNew = function () { up({ menu: !s.menu }); };
    vals.count = pages.length + ' of 30 pages';
    var d = pages.filter(function (p) { return p[0] === s.dlg; })[0];
    vals.dl = { open: Boolean(d), title: d ? 'Delete “' + d[3] + '”?' : '', confirm: function () { up({ dlg: null, pages: pages.filter(function (p) { return p !== d; }), toast: toast('Page deleted.') }); } };
    vals.closePop = function () { up({ menu: false, rmenu: null }); };
    vals.closeAll = function () { up({ menu: false, rmenu: null, dlg: null }); };
    return vals;
  }
}
