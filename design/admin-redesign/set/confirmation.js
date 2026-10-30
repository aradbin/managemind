var START = { 'Order confirmation': {}, 'Queue off': { f: { queue: false } }, 'Call script in English': { lang: 'en' }, 'Script preview': { preview: true } };
var BASE = { queue: true, includePaid: false, maxAttempts: '3', retry: '60', cancelUnreachable: false, smsLink: true, callRisky: true, auto: 'never',
  scriptBn: 'আসসালামু আলাইকুম, আমি {store} থেকে বলছি। আপনি {items} অর্ডার করেছেন, মোট {total}, {area}-এ ডেলিভারি। অর্ডারটি কি পাঠিয়ে দেব?',
  scriptEn: 'Assalamu alaikum, I’m calling from {store}. You ordered {items}, {total} in all, for delivery to {area}. Shall we send it?',
  incomplete: true, showAfter: '30', keepDays: '14', failedFlag: '2', minScore: '50', minDecided: '3', dupMinutes: '30' };
var PH = ['{store}', '{customer}', '{order_number}', '{items}', '{total}', '{area}'];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Order confirmation');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var f = form(s, up, toast, BASE); vals.f = f; vals.bar = f.bar; vals.discard = f.discard; vals.save = function () { f.save(); };
    vals.queueOn = f.cur.queue;
    vals.autos = choice(f, 'auto', [['never', 'Never: call every order'], ['trusted', 'Trusted phones: 90% or more of at least 3 orders delivered']]);
    var lang = s.lang || 'bn';
    vals.langs = [['bn', 'বাংলা'], ['en', 'English']].map(function (l) { var on = lang === l[0]; return { label: l[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ lang: l[0] }); } }; });
    vals.isBn = lang === 'bn'; vals.isEn = lang === 'en';
    vals.placeholders = PH.map(function (p) { return { label: p, insert: function () { var k = lang === 'bn' ? 'scriptBn' : 'scriptEn'; f.set(k, f.cur[k] + ' ' + p); } }; });
    var sc = lang === 'bn' ? f.cur.scriptBn : f.cur.scriptEn;
    vals.previewText = sc.replace('{store}', 'Nakshi Fashion').replace('{customer}', 'Rahim Ahmed').replace('{order_number}', '#1053').replace('{items}', lang === 'bn' ? '২টি কটন পাঞ্জাবি' : '2 Cotton Panjabi').replace('{total}', '৳2,830').replace('{area}', lang === 'bn' ? 'ধানমন্ডি' : 'Dhanmondi');
    vals.preview = Boolean(s.preview); vals.togglePreview = function () { up({ preview: !s.preview }); };
    vals.incOn = f.cur.incomplete;
    return vals;
  }
}
