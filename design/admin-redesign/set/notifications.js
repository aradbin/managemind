var START = { Notifications: {}, 'Connect an email sender': { panel: 'email' }, 'SMS not connected': { sms: false }, 'Connect SMS': { sms: false, panel: 'sms' } };
var EVENTS = [['order_placed', 'Order placed', true, true], ['order_confirmed', 'Order confirmed', true, false], ['order_shipped', 'Order shipped', true, true], ['order_delivered', 'Order delivered', true, false], ['order_cancelled', 'Order cancelled', true, true],
  ['payment_received', 'Payment received', true, false], ['payment_expired', 'Online payment not completed', true, false], ['return_approved', 'Return approved', true, true], ['return_rejected', 'Return declined', true, false], ['refund_issued', 'Refund sent', true, true]];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Notifications');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var base = {}; EVENTS.forEach(function (e) { base['e_' + e[0]] = e[2]; base['s_' + e[0]] = e[3]; });
    var f = form(s, up, toast, base); vals.f = f; vals.bar = f.bar; vals.discard = f.discard; vals.save = function () { f.save(); };
    var smsOn = s.sms !== false;
    vals.events = EVENTS.map(function (e) { return { label: e[1], email: f['e_' + e[0]], sms: f['s_' + e[0]], emailAria: e[1] + ' by email', smsAria: e[1] + ' by SMS', smsDis: !smsOn }; });
    vals.smsOn = smsOn; vals.smsOff = !smsOn;
    vals.emailConn = s.email !== false;
    vals.emailText = 'Sending from orders@nakshifashion.com.bd with Resend'; vals.emailMeta = 'checked ' + when('2026-10-29 07:30');
    vals.smsText = 'Connected: sms.net.bd'; vals.smsMeta = 'Balance: ৳1,240 · Sender ID: NAKSHI';
    var pv = s.pv || 'sms_net_bd';
    vals.sp = { open: s.panel === 'sms', providers: [['sms_net_bd', 'sms.net.bd'], ['bulksmsbd', 'BulkSMSBD'], ['sms_http', 'Another gateway (HTTPS)']].map(function (p) { var on = pv === p[0]; return { label: p[1], hasSub: false, sub: '', on: on, aria: on ? 'true' : 'false', pick: function () { up({ pv: p[0] }); } }; }),
      isHttp: pv === 'sms_http', notHttp: pv !== 'sms_http', isBulk: pv === 'bulksmsbd',
      save: function () { up({ panel: null, sms: true, toast: toast('Saved. Customer updates now go by SMS too.') }); } };
    var ep = s.ep || 'resend';
    vals.ep = { open: s.panel === 'email', providers: [['resend', 'Resend'], ['brevo', 'Brevo']].map(function (p) { var on = ep === p[0]; return { label: p[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ ep: p[0] }); } }; }),
      save: function () { up({ panel: null, email: true, toast: toast('Saved. Email now goes from your address.') }); } };
    vals.openEmail = function () { up({ panel: 'email' }); }; vals.openSms = function () { up({ panel: 'sms' }); };
    vals.removeEmail = function () { up({ email: false, toast: toast('Email goes from the platform’s address again.') }); };
    vals.removeSms = function () { up({ sms: false, toast: toast('The SMS gateway is disconnected.') }); };
    vals.emailOff = s.email === false;
    return vals;
  }
}
