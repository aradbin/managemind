var START = { 'Message wording': {}, 'Your own wording': { msg: 'order_shipped', ch: 'sms' }, 'Email in English': { ch: 'email', lang: 'en' }, 'Unknown placeholder': { f: { sms_bn_order_confirmed: 'আপনার অর্ডার {order_number} কনফার্ম হয়েছে। ধন্যবাদ, {store}। {courier_name}' } } };
var MSGS = [['order_placed', 'Order placed'], ['order_confirmed', 'Order confirmed'], ['order_shipped', 'Order shipped'], ['order_delivered', 'Order delivered'], ['order_cancelled', 'Order cancelled'], ['payment_received', 'Payment received'], ['return_approved', 'Return approved'], ['refund_issued', 'Refund sent']];
var VARS = { order_placed: ['{order_number}', '{total}', '{store}', '{track_url}'], order_confirmed: ['{order_number}', '{total}', '{store}'], order_shipped: ['{order_number}', '{courier}', '{tracking}', '{track_url}', '{store}'], order_delivered: ['{order_number}', '{store}'], order_cancelled: ['{order_number}', '{store}'], payment_received: ['{order_number}', '{amount}', '{store}'], return_approved: ['{return_number}', '{store}'], refund_issued: ['{amount}', '{method}', '{store}'] };
var DEFAULTS = {
  sms_bn_order_confirmed: 'আপনার অর্ডার {order_number} কনফার্ম হয়েছে। মোট {total}। ধন্যবাদ, {store}।', sms_en_order_confirmed: 'Your order {order_number} is confirmed. Total {total}. Thank you, {store}.',
  sms_bn_order_shipped: 'অর্ডার {order_number} {courier}-এ পাঠানো হয়েছে। ট্র্যাক করুন: {track_url}', sms_en_order_shipped: 'Order {order_number} is on its way with {courier}. Track it: {track_url}',
  email_en_order_confirmed_subject: 'Your order {order_number} is confirmed', email_en_order_confirmed: 'Thank you for shopping with {store}. We have confirmed your order {order_number} for {total} and will let you know when it ships.',
  email_bn_order_confirmed_subject: 'আপনার অর্ডার {order_number} কনফার্ম হয়েছে', email_bn_order_confirmed: '{store}-এ কেনাকাটার জন্য ধন্যবাদ। আপনার অর্ডার {order_number} ({total}) কনফার্ম হয়েছে।'
};
var CUSTOM = { sms_bn_order_shipped: 'প্রিয় গ্রাহক, আপনার অর্ডার {order_number} {courier}-এ রওনা হয়েছে। ট্র্যাকিং: {tracking}। — {store}' };
function text(k) { return CUSTOM[k] || DEFAULTS[k] || DEFAULTS[k.replace(/_(bn|en)_/, '_en_')] || ''; }
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Message wording');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var msg = s.msg || 'order_confirmed', ch = s.ch || 'sms', lang = s.lang || 'bn';
    var key = ch + '_' + lang + '_' + msg;
    var base = {}; base[key] = text(key); base[key + '_subject'] = DEFAULTS[key + '_subject'] || DEFAULTS[key.replace(/_(bn|en)_/, '_en_') + '_subject'] || '';
    var f = form(s, up, toast, base); vals.f = f; vals.bar = f.bar; vals.discard = f.discard; vals.save = function () { f.save(); };
    vals.body = { value: f.cur[key], on: function (e) { f.set(key, e.target.value); } };
    vals.subject = { value: f.cur[key + '_subject'], on: function (e) { f.set(key + '_subject', e.target.value); } };
    vals.isEmail = ch === 'email';
    vals.msgs = MSGS.map(function (m) { var on = m[0] === msg; return { label: m[1], cur: on ? 'page' : 'false', on: on, pick: function () { up({ msg: m[0], f: null }); } }; });
    vals.channels = [['sms', 'SMS'], ['email', 'Email']].map(function (c) { var on = c[0] === ch; return { label: c[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ ch: c[0], f: null }); } }; });
    vals.langs = [['bn', 'বাংলা'], ['en', 'English']].map(function (c) { var on = c[0] === lang; return { label: c[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ lang: c[0], f: null }); } }; });
    var custom = Boolean(CUSTOM[key]) || f.cur[key] !== (DEFAULTS[key] || text(key));
    vals.state = custom ? 'Your own wording.' : 'The default wording.'; vals.custom = custom;
    vals.reset = function () { f.set(key, DEFAULTS[key] || ''); };
    var vars = VARS[msg];
    vals.vars = vars.map(function (v) { return { label: v, insert: function () { f.set(key, f.cur[key] + ' ' + v); } }; });
    var unknown = (f.cur[key].match(/\{[a-z_]+\}/g) || []).filter(function (v) { return vars.indexOf(v) === -1; });
    vals.bad = unknown.length > 0; vals.badText = 'Not a value this message can use: ' + unknown.join(', ');
    var fill = { '{order_number}': '#1053', '{total}': '৳2,830', '{store}': 'Nakshi Fashion', '{track_url}': 'nakshi.shop/t/8K2M', '{courier}': 'Steadfast', '{tracking}': 'SF-88213457', '{amount}': '৳1,450', '{method}': 'bKash', '{return_number}': 'R-0014' };
    var pv = function (t) { return t.replace(/\{[a-z_]+\}/g, function (m) { return fill[m] || m; }); };
    vals.preview = pv(f.cur[key]); vals.previewSubject = pv(f.cur[key + '_subject'] || '');
    vals.smsCount = ch === 'sms' ? (lang === 'bn' ? Math.ceil(vals.preview.length / 70) : Math.ceil(vals.preview.length / 160)) + ' SMS · ' + vals.preview.length + ' characters' : '';
    vals.msgTitle = MSGS.filter(function (m) { return m[0] === msg; })[0][1];
    return vals;
  }
}
