var START = { 'Courier areas': {}, 'All areas': { all: true }, 'Every area matched': { courier: 'redx' }, 'Support role': { support: true } };
// courier, area id, our name, district, match [name, how] or null, suggestions [id, name, parent]
var AREAS = [
  ['pathao', 1, 'Mirpur DOHS', 'Dhaka', null, [[501, 'Mirpur DOHS', 'Mirpur'], [502, 'Mirpur 12', 'Mirpur'], [503, 'Pallabi', 'Mirpur']]],
  ['pathao', 2, 'Uttara Sector 18', 'Dhaka', null, [[611, 'Uttara Sector 18 (Purbachal Rd)', 'Uttara'], [612, 'Uttara Sector 17', 'Uttara']]],
  ['pathao', 3, 'Bashundhara R/A', 'Dhaka', [701, 'Bashundhara', 'by hand'], [[701, 'Bashundhara', 'Vatara'], [702, 'Bashundhara Block J', 'Vatara']]],
  ['pathao', 4, 'Agrabad', 'Chattogram', null, [[801, 'Agrabad C/A', 'Double Mooring'], [802, 'Agrabad Access Road', 'Double Mooring']]],
  ['pathao', 5, 'Kotbari', 'Cumilla', null, []],
  ['pathao', 6, 'Dhanmondi 27', 'Dhaka', [901, 'Dhanmondi', 'by name'], [[901, 'Dhanmondi', 'Dhanmondi']]],
  ['pathao', 7, 'Zindabazar', 'Sylhet', null, [[1001, 'Zinda Bazar', 'Kotwali'], [1002, 'Bandar Bazar', 'Kotwali']]],
  ['redx', 8, 'Gulshan 1', 'Dhaka', [1101, 'Gulshan-1', 'by name'], [[1101, 'Gulshan-1', 'Gulshan']]]
];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Courier areas');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var courier = s.courier || 'pathao', only = !s.all, can = !s.support;
    vals.couriers = [['pathao', 'Pathao'], ['redx', 'RedX']].map(function (c) { var on = courier === c[0]; return { label: c[1], on: on ? 'true' : 'false', aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { up({ courier: c[0] }); } }; });
    vals.only = { on: only, aria: only ? 'true' : 'false', bg: only ? 'var(--primary)' : 'var(--input)', x: only ? '14px' : '0px', toggle: function () { up({ all: only }); } };
    var m = s.m || {};
    var list = AREAS.filter(function (a) { return a[0] === courier; }).map(function (a) { var mt = m[a[1]] !== undefined ? m[a[1]] : a[4]; return { a: a, match: mt }; }).filter(function (x) { return !only || !x.match || s.justSet === x.a[1]; });
    vals.areas = list.map(function (x) {
      var a = x.a, mt = x.match;
      return { name: a[2], district: a[3], matched: Boolean(mt), matchText: mt ? 'Matched: ' + mt[1] + ' (' + mt[2] + ')' : 'No match yet', matchColor: mt ? 'var(--success)' : 'var(--muted-foreground)',
        sugs: a[5].map(function (g) { var on = Boolean(mt) && mt[0] === g[0]; return { label: g[1] + (g[2] ? ' · ' + g[2] : ''), on: on ? 'true' : 'false', pick: function () { var n = Object.assign({}, m); n[a[1]] = [g[0], g[1], 'by hand']; up({ m: n, justSet: a[1], toast: toast('Saved.') }); } }; }),
        hasSugs: a[5].length > 0, noSugs: a[5].length === 0, canClear: can && Boolean(mt),
        clear: function () { var n = Object.assign({}, m); n[a[1]] = null; up({ m: n, toast: toast('Saved.') }); } };
    });
    vals.hasAreas = list.length > 0; vals.noAreas = !vals.hasAreas;
    vals.canEdit = can; vals.readOnlyNote = !can;
    vals.count = plural(list.length, 'area', 'areas');
    return vals;
  }
}
