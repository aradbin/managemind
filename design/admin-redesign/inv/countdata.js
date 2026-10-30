var COUNTS = [
  { id: 'sc7', ref: 'SC-0007', status: 'counting', scope: ['category', 'Panjabi'], created: '2026-10-28', note: 'Front shelf and the store room.', lines: [['v1', 18, 18], ['v2', 4, 3], ['v3', 0, 0], ['v4', 9, null], ['v5', 14, null]] },
  { id: 'sc6', ref: 'SC-0006', status: 'review', scope: ['all', ''], created: '2026-10-26', note: '', lines: [['v1', 18, 18], ['v2', 4, 3], ['v3', 0, 0], ['v4', 9, 9], ['v5', 14, 14], ['v6', 11, 11], ['v7', 3, 3], ['v8', 6, 5], ['v9', 15, 15], ['v10', 22, 23], ['v11', 7, 6], ['v16', 3, 3], ['v12', 2, 2], ['v13', 5, 5], ['v14', 40, 36]] },
  { id: 'sc5', ref: 'SC-0005', status: 'applied', scope: ['tag', 'eid'], created: '2026-10-12', note: 'Before the Eid rush.', applied: '2026-10-12', lines: [['v1', 18, 18], ['v2', 3, 3], ['v3', 2, 0], ['v6', 12, 11], ['v7', 3, 3], ['v10', 22, 22], ['v14', 40, 40]] },
  { id: 'sc4', ref: 'SC-0004', status: 'cancelled', scope: ['variants', '3'], created: '2026-09-30', note: '', lines: [['v12', 3, 3], ['v13', 5, null], ['v8', 6, null]] }
];
var THRESHOLD = 5000;
function scopeText(c) {
  var k = c.scope[0];
  return k === 'all' ? 'Everything at this location' : k === 'category' ? 'Category: ' + c.scope[1] : k === 'tag' ? 'Tag: ' + c.scope[1] : plural(c.lines.length, 'item chosen', 'items chosen');
}
function countDiff(c) {
  var lines = c.lines.filter(function (l) { return l[2] !== null && l[2] !== l[1]; });
  var units = lines.reduce(function (a, l) { return a + (l[2] - l[1]); }, 0);
  var value = lines.reduce(function (a, l) { var v = vById(l[0]); return a + (l[2] - l[1]) * (v.cost || 0); }, 0);
  return { lines: lines.length, units: units, value: value, counted: c.lines.filter(function (l) { return l[2] !== null; }).length };
}
