var START = { 'Store settings': {}, 'Holiday mode': { f: { holiday: true } }, 'Wrong dates': { f: { holiday: true, hEnd: '2027-03-28T23:59' }, tried: true }, 'Hidden from search': { saved: { indexing: false } } };
var BASE = { indexing: true, numerals: 'auto', pixel: '1029384756473829', ga4: 'G-7KX2M9QP1L', consent: '', whatsapp: '01712-345678', messenger: 'nakshifashionbd', greeting: 'Assalamu alaikum, I have a question about', chatShow: 'all',
  holiday: false, hStart: '2027-03-29T00:00', hEnd: '2027-04-03T23:59', hNote: 'ঈদের ছুটি: ৩ এপ্রিলের পর অর্ডার পাঠানো হবে।' };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Store settings');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var f = form(s, up, toast, BASE, 'Saved. Changes can take a minute to appear on your store.'); vals.f = f; vals.bar = f.bar; vals.discard = f.discard;
    vals.save = function () { f.save(function (c) { return !c.holiday || c.hEnd > c.hStart; }); };
    vals.numerals = choice(f, 'numerals', [['auto', 'Bangla digits in Bangla, Western digits in English'], ['bengali', 'Always Bangla digits (১২৩)'], ['latin', 'Always Western digits (123)']]);
    vals.shows = choice(f, 'chatShow', [['all', 'On every page'], ['product', 'On product pages only'], ['none', 'Nowhere']]);
    vals.holidayOn = f.cur.holiday;
    vals.dateBad = Boolean(s.tried) && f.cur.holiday && f.cur.hEnd <= f.cur.hStart;
    vals.notIndexed = !f.cur.indexing;
    return vals;
  }
}
