var START = { 'Two-factor login': {}, 'Backup code': { backup: true }, 'Wrong code': { code: '123456', err: 'invalid' }, Expired: { err: 'expired' } };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Two-factor login');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    vals.backup = Boolean(s.backup); vals.app = !s.backup;
    vals.label = s.backup ? 'Backup code' : 'Authenticator code';
    vals.switchText = s.backup ? 'Use the authenticator app' : 'Use a backup code';
    vals.toggleMode = function () { up({ backup: !s.backup, code: '', err: null }); };
    vals.code = s.code || ''; vals.onCode = function (e) { up({ code: e.target.value, err: null }); };
    vals.trust = checkOf(s.trust !== false, function () { up({ trust: s.trust === false }); });
    vals.expired = s.err === 'expired'; vals.notExpired = s.err !== 'expired';
    vals.bad = s.err === 'invalid'; vals.aria = vals.bad ? 'true' : 'false';
    vals.submit = function () { if (!(s.code || '').trim()) { up({ err: 'invalid' }); return; } up({ toast: toast('Signed in.') }); };
    return vals;
  }
}
