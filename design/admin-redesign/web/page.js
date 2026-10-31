var START = { 'About us': {}, 'In English': { lang: 'en' }, 'Returns (from your settings)': { kind: 'returns' }, Edited: { f: { titleBn: 'আমাদের গল্প' } }, 'Delete page': { dlg: true } };
var BASE = { titleBn: 'আমাদের কথা', titleEn: 'About us', slug: 'about-us', published: true,
  bodyBn: '## নকশী ফ্যাশন\n\n২০১৯ সালে মিরপুরের একটি ছোট দোকান থেকে আমাদের শুরু। আমরা দেশের তাঁতি আর কারিগরদের হাতে বোনা পাঞ্জাবি, কুর্তি আর শাড়ি আপনার কাছে পৌঁছে দিই।\n\n- সারা দেশে ক্যাশ অন ডেলিভারি\n- ৭ দিনের মধ্যে সহজ রিটার্ন',
  bodyEn: '## Nakshi Fashion\n\nWe started in 2019 as a small shop in Mirpur. We bring you panjabi, kurti and saree woven by hand by weavers and artisans across the country.\n\n- Cash on delivery across Bangladesh\n- Easy returns within 7 days' };
var RET = { titleBn: 'রিটার্ন নীতি', titleEn: 'Returns', slug: 'returns', published: true, bodyBn: '', bodyEn: '' };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'About us');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var tpl = s.kind === 'returns';
    var f = form(s, up, toast, tpl ? RET : BASE); vals.f = f; vals.bar = f.bar; vals.discard = f.discard; vals.save = function () { f.save(); };
    var lang = s.lang || 'bn';
    vals.langs = [['bn', 'বাংলা'], ['en', 'English']].map(function (l) { var on = lang === l[0]; return { label: l[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ lang: l[0] }); } }; });
    vals.isBn = lang === 'bn'; vals.isEn = lang === 'en';
    vals.title = f.cur.titleEn || 'Page';
    vals.url = 'nakshifashion.com.bd/pages/' + (f.cur.slug || 'about-us');
    vals.isTemplate = tpl; vals.notTemplate = !tpl;
    vals.tplPreview = lang === 'bn' ? ['ডেলিভারির ৭ দিনের মধ্যে রিটার্ন চাইতে পারবেন।', 'সাইজ ভুল বা মত বদলালে রিটার্নের ডেলিভারি চার্জ আপনার।', 'টাকা ফেরত: বিকাশ, নগদ, ব্যাংক বা স্টোর ক্রেডিট।'] : ['You can ask for a return within 7 days of delivery.', 'For a wrong size or a change of mind, you pay the return delivery.', 'Refunds go by bKash, Nagad, bank transfer or store credit.'];
    vals.tplLines = vals.tplPreview.map(function (x) { return { text: x }; });
    vals.editTpl = function () { up({ kind: null, toast: toast('The text is yours now. It no longer follows your settings.') }); };
    vals.format = function () { up({ toast: toast('Formatting added at the cursor.') }); };
    vals.askDelete = function () { up({ dlg: true }); };
    vals.dl = { open: Boolean(s.dlg), title: 'Delete “' + vals.title + '”?', confirm: function () { up({ dlg: false, toast: toast('Page deleted.') }); } };
    vals.closeAll = function () { up({ dlg: false }); };
    return vals;
  }
}
