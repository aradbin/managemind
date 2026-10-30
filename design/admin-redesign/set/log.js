var START = { 'Delivery log': {}, Failed: { st: 'failed' }, 'SMS only': { ch: 'sms' } };
var LOG = [['2026-10-29 11:20', 'Order confirmed', 'sms', '01313-662200', 1058, 'sent', ''], ['2026-10-29 11:06', 'Order placed', 'sms', '01313-662200', 1058, 'sent', ''], ['2026-10-29 10:21', 'Order placed', 'email', 'kamal.u@gmail.com', 1057, 'failed', 'the mailbox doesn’t exist'],
  ['2026-10-29 09:16', 'Order placed', 'sms', '01819-224466', 1056, 'sent', ''], ['2026-10-28 18:15', 'Order shipped', 'sms', '01790-445566', 1051, 'sent', ''], ['2026-10-28 16:21', 'Payment received', 'email', 'rahim.ahmed@gmail.com', 1053, 'sent', ''],
  ['2026-10-28 16:06', 'Order placed', 'push', 'Rafiq’s phone', 1053, 'skipped', 'no device has alerts on'], ['2026-10-28 12:31', 'Order placed', 'email', '—', 1052, 'skipped', 'no address'], ['2026-10-27 14:27', 'Order placed', 'sms', '01716-993311', 1050, 'failed', 'gateway timed out'], ['2026-10-27 14:26', 'Payment received', 'email', 'mitu.das@yahoo.com', 1050, 'queued', '']];
var LST = { queued: ['Waiting', 'info'], sent: ['Sent', 'good'], failed: ['Failed', 'bad'], skipped: ['Not sent', 'ended'] };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Delivery log');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var st = s.st || 'all', ch = s.ch || 'all', log = s.log || LOG;
    vals.statuses = [['all', 'All'], ['queued', 'Waiting'], ['sent', 'Sent'], ['failed', 'Failed'], ['skipped', 'Not sent']].map(function (x) { var on = st === x[0]; return { label: x[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ st: x[0] }); } }; });
    vals.channels = [['all', 'All'], ['sms', 'SMS'], ['email', 'Email'], ['push', 'Push']].map(function (x) { var on = ch === x[0]; return { label: x[1], aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ ch: x[0] }); } }; });
    var list = log.filter(function (x) { return (st === 'all' || x[5] === st) && (ch === 'all' || x[2] === ch); });
    vals.rows = list.map(function (x, i) {
      var t = TONE[LST[x[5]][1]];
      return { when: when(x[0]), event: x[1], to: x[3], order: '#' + x[4], channel: { sms: 'SMS', email: 'Email', push: 'Push' }[x[2]], chip: { label: LST[x[5]][0], bg: t[0], fg: t[1], edge: 'transparent' }, reason: x[6], hasReason: Boolean(x[6]), failed: x[5] === 'failed',
        resend: function () { up({ log: log.map(function (y) { return y === x ? [y[0], y[1], y[2], y[3], y[4], 'queued', ''] : y; }), toast: toast('Sending again.') }); } };
    });
    vals.empty = list.length === 0;
    vals.more = function () { up({ toast: toast('No older messages in the last 90 days.') }); };
    return vals;
  }
}
