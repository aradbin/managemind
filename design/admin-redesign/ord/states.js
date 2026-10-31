// The loading and failed-to-load states every list and record page follows, shown on Orders and one order.
var START = { 'List loading': { v: 'list', st: 'loading' }, 'List didn’t load': { v: 'list', st: 'failed' }, 'Page loading': { v: 'rec', st: 'loading' }, 'Page didn’t load': { v: 'rec', st: 'failed' }, 'Page not found': { v: 'rec', st: 'missing' } };
// Placeholder widths, so the rows don't look stamped out.
var SKEL = [['62%', '40%', '70%'], ['48%', '52%', '58%'], ['70%', '36%', '64%'], ['54%', '46%', '72%'], ['66%', '42%', '60%'], ['44%', '50%', '68%'], ['58%', '38%', '62%'], ['50%', '44%', '56%']];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'List loading');
    var s = b.s, up = b.up, vals = b.vals;
    vals.isList = s.v === 'list'; vals.isRec = s.v === 'rec';
    vals.loading = s.st === 'loading'; vals.failed = s.st === 'failed'; vals.missing = s.st === 'missing'; vals.known = s.st !== 'missing';
    vals.tabs = ['All', 'To confirm', 'To ship', 'Shipped', 'Delivered', 'Cancelled'].map(function (l, i) { return { label: l, on: i === 0 ? 'true' : 'false' }; });
    vals.skel = SKEL.map(function (w) { return { a: w[0], b: w[1], c: w[2] }; });
    vals.cards = SKEL.slice(0, 5).map(function (w) { return { a: w[0], b: w[1], c: w[2] }; });
    vals.lines = SKEL.slice(0, 3).map(function (w) { return { a: w[0], b: w[1] }; });
    vals.retry = function () { up({ st: 'loading' }); };
    return vals;
  }
}
