var START = { 'Choose file': {}, 'Unreadable file': { err: true }, 'Missing column': { step: 'check', missing: true }, Check: { step: 'check' },
  Importing: { step: 'job' }, Done: { step: 'job', done: true }, 'Not allowed': { denied: true } };
var ISTEPS = ['Choose a file', 'Check', 'Import'];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Choose file');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var step = s.step || 'choose', idx = { choose: 0, check: 1, job: 2 }[step];
    vals.denied = Boolean(s.denied); vals.allowed = !s.denied;
    vals.steps = ISTEPS.map(function (n, i) { return { label: n, n: String(i + 1), s: i < idx ? 'done' : i === idx ? 'now' : 'todo', cur: i === idx ? 'step' : 'false', done: i < idx || Boolean(s.done && i === 2), todo: !(i < idx || (s.done && i === 2)) }; });
    vals.isChoose = step === 'choose'; vals.isCheck = step === 'check'; vals.isJob = step === 'job';
    vals.err = Boolean(s.err);
    vals.choose = function () { up({ step: 'check', err: false }); };
    vals.sample = function () { up({ toast: toast('Downloading a sample file.') }); };
    vals.file = CONF.file; vals.rowsText = count(CONF.rows) + ' rows';
    vals.missing = Boolean(s.missing); vals.notMissing = !s.missing;
    vals.missingText = CONF.missing;
    vals.cols = (s.missing ? CONF.cols.filter(function (c) { return c !== CONF.need; }) : CONF.cols).map(function (c) { return { label: c }; });
    vals.stats = [{ label: CONF.readyLabel, value: count(CONF.valid), color: 'var(--foreground)' }, { label: 'Left out', value: count(CONF.problems.length), color: CONF.problems.length ? 'var(--destructive)' : 'var(--foreground)' }, { label: 'Warnings', value: count(CONF.warnings.length), color: CONF.warnings.length ? 'var(--warn)' : 'var(--foreground)' }];
    vals.summary = CONF.problems.length + ' rows with problems are left out; fix them in the file and import it again to add them.';
    vals.problems = CONF.problems.concat(CONF.warnings).map(function (p, i) { var w = i >= CONF.problems.length; return { row: String(p[0]), col: p[1], text: p[2], kind: w ? tone('Warning', 'warn') : tone('Left out', 'bad') }; });
    vals.download = function () { up({ toast: toast('Downloading the problems (.csv).') }); };
    vals.startText = CONF.start; vals.canStart = !s.missing;
    vals.start = function () { up({ step: 'job', done: false }); };
    vals.cancel = function () { up({ step: 'choose', missing: false }); };
    vals.running = !s.done; vals.done = Boolean(s.done);
    vals.progress = CONF.progress; vals.pct = Math.round(CONF.part / CONF.valid * 100) + '%';
    vals.doneText = CONF.doneText; vals.again = function () { up({ step: 'choose', done: false }); };
    vals.listHref = CONF.list + (ROOT === 'mm' ? 'Phone' : '') + '.dc.html'; vals.listLabel = CONF.listLabel;
    vals.finish = function () { up({ done: true, toast: toast(CONF.doneText) }); };
    vals.closeAll = function () {}; vals.escClose = function () {};
    return vals;
  }
}
