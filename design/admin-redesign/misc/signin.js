var START = { 'Sign in': {}, 'Code sent': { step: 'code', email: 'rafiq@nakshifashion.com.bd' }, 'Wrong code': { step: 'code', email: 'rafiq@nakshifashion.com.bd', code: '418230', err: 'invalid' }, 'Too many tries': { step: 'code', email: 'rafiq@nakshifashion.com.bd', err: 'tries' }, 'Bot check': { err: 'check', email: 'rafiq@nakshifashion.com.bd' } };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Sign in');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var step = s.step || 'email', email = s.email === undefined ? '' : s.email;
    vals.isEmail = step === 'email'; vals.isCode = step === 'code';
    vals.email = email; vals.onEmail = function (e) { up({ email: e.target.value, err: null }); };
    vals.emailBad = Boolean(s.tried) && !/^\S+@\S+\.\S+$/.test(email); vals.emailAria = vals.emailBad ? 'true' : 'false';
    vals.send = function () { if (!/^\S+@\S+\.\S+$/.test(email)) { up({ tried: true }); return; } up({ step: 'code', err: null, code: '' }); };
    vals.sentText = 'If ' + (email || 'that address') + ' has an account, a code is on its way. It works for 10 minutes.';
    vals.code = s.code || ''; vals.onCode = function (e) { up({ code: e.target.value.replace(/\D/g, '').slice(0, 6), err: null }); };
    vals.submit = function () { if ((s.code || '').length !== 6) { up({ err: 'invalid' }); return; } up({ toast: toast('Signed in. Opening your store…') }); };
    var msg = { invalid: 'That code is wrong or has expired. Check the latest email, or send a new code.', tries: 'Too many tries with this code. Send a new code.', check: 'Complete the check below, then try again.' }[s.err];
    vals.hasErr = Boolean(msg); vals.errText = msg || ''; vals.codeAria = s.err === 'invalid' ? 'true' : 'false';
    vals.isCheck = s.err === 'check';
    vals.resendText = 'You can send a new code in 42 seconds.'; vals.canResend = s.err === 'tries'; vals.waitResend = s.err !== 'tries';
    vals.resend = function () { up({ err: null, code: '', toast: toast('A new code is on its way.') }); };
    vals.changeEmail = function () { up({ step: 'email', err: null, code: '' }); };
    return vals;
  }
}
