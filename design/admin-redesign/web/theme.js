var START = { Theme: {}, 'Phone preview': { size: 'phone' }, 'Editing the banner': { open: 'sections', sec: 'h1' }, 'Low contrast': { colors: { onPrimary: '#ffffff', primary: '#f4a7b9' } }, 'Use a preset': { dlg: 'grocery' }, Publish: { dlg: 'publish' }, 'Everything published': { published: true } };
var PRESETS = {
  fashion: { label: 'Fashion', colors: { primary: '#7a1f3d', onPrimary: '#ffffff', background: '#fffaf6', surface: '#f6ece6', text: '#2b1d1f', accent: '#c99a3b', sale: '#c2410c' }, font: 'hind', radius: 'small' },
  grocery: { label: 'Grocery', colors: { primary: '#166534', onPrimary: '#ffffff', background: '#ffffff', surface: '#f1f7f2', text: '#1c2a20', accent: '#f59e0b', sale: '#dc2626' }, font: 'noto', radius: 'large' },
  general: { label: 'General store', colors: { primary: '#1d4ed8', onPrimary: '#ffffff', background: '#ffffff', surface: '#f4f5f7', text: '#111827', accent: '#0ea5e9', sale: '#dc2626' }, font: 'system', radius: 'small' }
};
var COLOR_LABELS = [['primary', 'Main colour (buttons, links)'], ['onPrimary', 'Text on the main colour'], ['background', 'Page background'], ['surface', 'Cards and footer'], ['text', 'Text'], ['accent', 'Accent'], ['sale', 'Sale price and badge']];
var SEC_TYPES = [['hero', 'Banner'], ['category_grid', 'Category grid'], ['collection_carousel', 'Collections'], ['product_grid', 'Products'], ['image_with_text', 'Image with text'], ['rich_text', 'Text'], ['trust_badges', 'Trust badges']];
var SECS = [['h1', 'hero'], ['c1', 'category_grid'], ['p1', 'product_grid'], ['t1', 'trust_badges']];
var FONTS_T = [['hind', 'Hind Siliguri', "'Hind Siliguri', 'Noto Sans Bengali', sans-serif"], ['noto', 'Noto Sans Bengali', "'Noto Sans Bengali', sans-serif"], ['system', 'The phone’s own font (fastest)', 'system-ui, sans-serif']];
var RADII = [['none', 'Square', '0px'], ['small', 'Slightly rounded', '6px'], ['large', 'Rounded', '14px']];
var SHOP = [['Embroidered Kurti', 1850, 2200, '#d9b8b0'], ['Cotton Panjabi', 1450, 0, '#e7dccb'], ['Tangail Cotton Saree', 2950, 3400, '#b9cdb6'], ['Silk Panjabi', 3200, 0, '#b8c2d6']];
function lum(hex) { var c = hex.replace('#', ''); if (c.length !== 6) return 0.5; var v = [0, 2, 4].map(function (i) { var x = parseInt(c.substr(i, 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Theme');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var base = PRESETS.fashion;
    var colors = Object.assign({}, base.colors, s.colors || {});
    var font = s.font || base.font, radius = s.radius || base.radius;
    var secs = s.secs || SECS;
    var open = s.open === undefined ? 'colors' : s.open;
    var dirty = !s.published;
    var change = function (p) { up(Object.assign({ published: false }, p)); };
    vals.status = dirty ? 'You have changes that aren’t published yet.' : 'Everything is published.'; vals.dirty = dirty; vals.clean = !dirty;
    vals.saved = 'Draft saved';
    var acc = function (k, title) { var on = open === k; return { title: title, open: on, aria: on ? 'true' : 'false', toggle: function () { up({ open: on ? null : k }); } }; };
    vals.a = { preset: acc('preset', 'Starting point'), colors: acc('colors', 'Colours'), type: acc('type', 'Font and corners'), logo: acc('logo', 'Logo and browser tab icon'), ann: acc('ann', 'Announcement bar'), sections: acc('sections', 'Homepage sections'), cards: acc('cards', 'Product cards'), product: acc('product', 'Product pages') };
    vals.presets = Object.keys(PRESETS).map(function (k) { var p = PRESETS[k]; return { label: p.label, dots: ['primary', 'surface', 'accent'].map(function (c) { return { bg: p.colors[c] }; }), pick: function () { up({ dlg: k }); }, aria: 'Start from ' + p.label }; });
    vals.colors = COLOR_LABELS.map(function (c) { return { key: c[0], label: c[1], value: colors[c[0]], id: 'mm-col-' + c[0], on: function (e) { var n = Object.assign({}, s.colors || {}); n[c[0]] = e.target.value; change({ colors: n }); } }; });
    var r = ratio(colors.primary, colors.onPrimary);
    vals.lowContrast = r < 4.5; vals.contrastText = 'Text on the main colour: contrast ' + r.toFixed(1) + ':1. It needs at least 4.5:1 to be readable.';
    vals.fonts = FONTS_T.map(function (x) { var on = font === x[0]; return { label: x[1], hasSub: false, sub: '', on: on, aria: on ? 'true' : 'false', pick: function () { change({ font: x[0] }); } }; });
    vals.radii = RADII.map(function (x) { var on = radius === x[0]; return { label: x[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { change({ radius: x[0] }); } }; });
    var sw = function (k, def) { var v = s[k] === undefined ? def : s[k]; return { on: v, aria: v ? 'true' : 'false', bg: v ? 'var(--primary)' : 'var(--input)', x: v ? '14px' : '0px', toggle: function () { var p = {}; p[k] = !v; change(p); } }; };
    vals.annSw = sw('ann', true); vals.annOn = vals.annSw.on;
    vals.annText = s.annText === undefined ? 'ঢাকার ভেতরে ৳২,০০০+ অর্ডারে ফ্রি ডেলিভারি' : s.annText; vals.onAnn = function (e) { change({ annText: e.target.value }); };
    vals.compare = sw('compare', true); vals.brand = sw('brand', false); vals.related = sw('related', true);
    var shape = s.shape || 'portrait';
    vals.shapes = [['square', 'Square'], ['portrait', 'Portrait']].map(function (x) { var on = shape === x[0]; return { label: x[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { change({ shape: x[0] }); } }; });
    var spec = s.spec || 'table';
    vals.specs = [['table', 'As a table'], ['list', 'As a list']].map(function (x) { var on = spec === x[0]; return { label: x[1], hasSub: false, sub: '', on: on, aria: on ? 'true' : 'false', pick: function () { change({ spec: x[0] }); } }; });
    // Homepage sections.
    var hero = Object.assign({ heading: 'ঈদ কালেকশন ২০২৬', sub: 'হাতে বোনা পাঞ্জাবি আর কুর্তি, সারা দেশে ক্যাশ অন ডেলিভারি', button: 'এখনই কিনুন', link: 'collection', size: 'large' }, s.hero || {});
    var setH = function (k, v) { var n = Object.assign({}, hero); n[k] = v; change({ hero: n }); };
    vals.secs = secs.map(function (x, i) {
      var name = SEC_TYPES.filter(function (t) { return t[0] === x[1]; })[0][1], on = s.sec === x[0];
      var move = function (d) { var n = secs.slice(); var j = i + d; var t = n[i]; n[i] = n[j]; n[j] = t; change({ secs: n }); };
      return { name: name, open: on ? 'true' : 'false', isOpen: on, isHero: on && x[1] === 'hero', notHero: on && x[1] !== 'hero', toggle: function () { up({ sec: on ? null : x[0] }); },
        up: function () { if (i > 0) move(-1); }, down: function () { if (i < secs.length - 1) move(1); }, upDis: i === 0, downDis: i === secs.length - 1,
        upAria: 'Move ' + name + ' up', downAria: 'Move ' + name + ' down', removeAria: 'Remove ' + name, remove: function () { change({ secs: secs.filter(function (y) { return y !== x; }), sec: null }); } };
    });
    vals.hero = { heading: hero.heading, onHeading: function (e) { setH('heading', e.target.value); }, sub: hero.sub, onSub: function (e) { setH('sub', e.target.value); }, button: hero.button, onButton: function (e) { setH('button', e.target.value); },
      links: [['none', 'No button'], ['category', 'A category'], ['collection', 'A collection'], ['product', 'A product'], ['page', 'A page']].map(function (x) { var on = hero.link === x[0]; return { label: x[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { setH('link', x[0]); } }; }),
      sizes: [['large', 'Large'], ['compact', 'Compact']].map(function (x) { var on = hero.size === x[0]; return { label: x[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { setH('size', x[0]); } }; }) };
    vals.addOpen = Boolean(s.add); vals.addAria = s.add ? 'true' : 'false'; vals.toggleAdd = function () { up({ add: !s.add }); };
    vals.addTypes = SEC_TYPES.map(function (t) { return { label: t[1], pick: function () { change({ add: false, secs: secs.concat([[t[0] + secs.length, t[0]]]) }); } }; });
    vals.atLimit = secs.length >= 12;
    // The preview.
    var F = FONTS_T.filter(function (x) { return x[0] === font; })[0][2], R = RADII.filter(function (x) { return x[0] === radius; })[0][2];
    vals.th = { primary: colors.primary, onPrimary: colors.onPrimary, bg: colors.background, surface: colors.surface, text: colors.text, accent: colors.accent, sale: colors.sale, font: F, radius: R,
      muted: 'color-mix(in oklch, ' + colors.text + ' 60%, ' + colors.background + ')', border: 'color-mix(in oklch, ' + colors.text + ' 12%, ' + colors.background + ')' };
    var phone = (s.size || 'desktop') === 'phone';
    vals.pv = { width: phone ? '375px' : '100%', cols: phone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', heroH: hero.size === 'large' ? (phone ? '220px' : '300px') : '160px', heroSize: phone ? '22px' : '34px', nav: !phone, imgH: shape === 'square' ? (phone ? '140px' : '180px') : (phone ? '180px' : '240px') };
    vals.sizes = [['desktop', 'Desktop', 'monitor'], ['phone', 'Phone', 'smartphone']].map(function (x) { var on = (s.size || 'desktop') === x[0]; return { label: x[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ size: x[0] }); }, isMonitor: x[2] === 'monitor', isPhone: x[2] === 'smartphone' }; });
    vals.blocks = secs.map(function (x) { return { hero: x[1] === 'hero', cats: x[1] === 'category_grid', prods: x[1] === 'product_grid' || x[1] === 'collection_carousel', trust: x[1] === 'trust_badges', text: x[1] === 'rich_text' || x[1] === 'image_with_text', title: x[1] === 'collection_carousel' ? 'কালেকশন' : 'নতুন এসেছে' }; });
    vals.heroH = { heading: hero.heading, sub: hero.sub, button: hero.button, hasButton: hero.link !== 'none' };
    vals.cats = ['পাঞ্জাবি', 'কুর্তি', 'শাড়ি', 'থ্রি-পিস'].map(function (c, i) { return { label: c, bg: ['#e7dccb', '#d9b8b0', '#b9cdb6', '#c9c2dc'][i] }; });
    vals.products = SHOP.map(function (p) { return { name: p[0], price: money(p[1]), was: money(p[2]), sale: p[2] > 0 && vals.compare.on, bg: p[3], brand: vals.brand.on }; });
    vals.trust = [['ক্যাশ অন ডেলিভারি', 'সারা দেশে'], ['৭ দিনে রিটার্ন', 'সহজ প্রক্রিয়া'], ['নিরাপদ পেমেন্ট', 'বিকাশ, নগদ, কার্ড']].map(function (t) { return { title: t[0], text: t[1] }; });
    vals.previewOpen = Boolean(s.pview); vals.openPreview = function () { up({ pview: true }); }; vals.closePreview = function () { up({ pview: false }); };
    // Dialogs.
    var pk = PRESETS[s.dlg];
    vals.pd = { open: Boolean(pk), title: pk ? 'Start from “' + pk.label + '”?' : '', confirm: function () { up({ dlg: null, colors: pk.colors, font: pk.font, radius: pk.radius, published: false, toast: toast('Started from ' + pk.label + '. Publish when it looks right.') }); } };
    vals.pub = { open: s.dlg === 'publish', confirm: function () { up({ dlg: null, published: true, toast: toast('Published. Changes can take a minute to appear on your store.') }); } };
    vals.askPublish = function () { up({ dlg: 'publish' }); };
    vals.closeAll = function () { up({ dlg: null, add: false, pview: false }); };
    vals.closePop = function () { up({ add: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ dlg: null, add: false, pview: false }); } };
    return vals;
  }
}
