var START = { Joining: {}, 'Not valid': { st: 'invalid' }, 'Link incomplete': { st: 'missing' } };
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Joining');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var st = s.st || 'joining';
    vals.joining = st === 'joining'; vals.invalid = st === 'invalid'; vals.missing = st === 'missing';
    vals.signOut = function () { up({ toast: toast('Signed out.') }); };
    return vals;
  }
}
