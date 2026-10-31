var START = { 'Online store': {}, 'Not live yet': { hidden: true } };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Online store');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    vals.live = !s.hidden; vals.notLive = Boolean(s.hidden);
    vals.cards = [
      { title: 'Theme', desc: 'Colours, fonts and the homepage. Shoppers see changes when you publish.', status: 'You have changes that aren’t published yet.', warn: true, href: P('Theme'), icon: 'palette' },
      { title: 'Pages', desc: 'About, contact, your policies and other pages. They’re listed in the store’s footer.', status: '6 pages · 5 published', warn: false, href: P('StorePages'), icon: 'file' },
      { title: 'Store settings', desc: 'Search engines, tracking, cookies, chat buttons and holiday mode.', status: s.hidden ? 'Hidden from search engines' : 'Shown in search engines', warn: Boolean(s.hidden), href: P('StoreSettings'), icon: 'sliders' }
    ].map(function (c) { c.color = c.warn ? 'var(--warn)' : 'var(--muted-foreground)'; c.is_palette = c.icon === 'palette'; c.is_file = c.icon === 'file'; c.is_sliders = c.icon === 'sliders'; return c; });
    vals.copy = function () { up({ toast: toast('Store link copied.') }); };
    return vals;
  }
}
