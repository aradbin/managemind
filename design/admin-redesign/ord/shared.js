// Orders: sell prices, orders, returns, and their status words and tones.
var PRICE = { v1: 1450, v2: 1450, v3: 1450, v4: 3200, v5: 850, v6: 1850, v7: 1850, v8: 12500, v9: 2950, v10: 2400, v11: 990, v16: 990, v12: 1650, v13: 1650, v14: 150, v15: 50 };
var ZONES = [['dhaka', 'Inside Dhaka', 70], ['ctg', 'Chattogram city', 110], ['outside', 'Outside Dhaka', 130]];
function O(id, n, placed, cust, o) {
  return Object.assign({ id: id, n: n, placed: placed, name: cust[0], phone: cust[1], area: cust[2], district: cust[3] || 'Dhaka', zone: 'dhaka', source: 'website', status: 'pending', pay: 'unpaid', del: 'not_shipped', lines: [], adj: [], fee: 70, paid: 0, flags: [], score: 90, risky: false, tags: [], note: '', shipments: [], payments: [], refunds: [], returns: [], conf: null, cancel: null, line: '' }, o);
}
var C = {
  arif: ['Arif Chowdhury', '01313662200', 'Mirpur'], kamal: ['Kamal Uddin', '01987121212', 'Badda'], nusrat: ['Nusrat Jahan', '01819224466', 'Mohammadpur'],
  imran: ['Imran Hossain', '01722889900', 'Uttara'], rahim: ['Rahim Ahmed', '01712345678', 'Dhanmondi'], farzana: ['Farzana Akter', '01611305522', 'Gulshan'],
  sharmin: ['Sharmin Sultana', '01790445566', 'Tejgaon'], mitu: ['Mitu Das', '01716993311', 'Panchlaish', 'Chattogram'], joya: ['Joya Roy', '01688454545', 'Kotwali', 'Chattogram'],
  tanvir: ['Tanvir Hasan', '01911778899', 'Halishahar', 'Chattogram'], sabbir: ['Sabbir Rahman', '01552114477', 'Mirpur'], rupa: ['Rupa Khatun', '01855667788', 'Mirpur']
};
var ORDERS = [
  O('o58', 1058, '2026-10-29 11:05', C.arif, { lines: [['v6', 1, 1850, 0]], score: null, note: 'Please call before coming.', line: 'House 9, Road 3, Section 10', conf: { inQueue: true, attempts: 0, linkSent: '2026-10-29 11:06' } }),
  O('o57', 1057, '2026-10-29 10:20', C.kamal, { source: 'facebook', lines: [['v10', 1, 2400, 0], ['v14', 2, 150, 0]], flags: ['flagged_phone'], score: 33, risky: true, line: 'Merul Badda, Lane 4', conf: { inQueue: true, attempts: 1 } }),
  O('o56', 1056, '2026-10-29 09:15', C.nusrat, { lines: [['v7', 1, 1850, 0]], flags: ['possible_duplicate'], dupOf: 'o55', score: 100, line: 'Block C, Iqbal Road', conf: { inQueue: true, attempts: 0 } }),
  O('o55', 1055, '2026-10-29 09:12', C.nusrat, { lines: [['v7', 1, 1850, 0]], score: 100, line: 'Block C, Iqbal Road', conf: { inQueue: true, attempts: 1, dueAt: '2026-10-29 20:00', lastNote: 'At work, call this evening' } }),
  O('o54', 1054, '2026-10-28 20:40', C.imran, { lines: [['v9', 1, 2950, 0]], flags: ['unreachable'], score: 83, line: 'Sector 7, Road 18, House 41', conf: { inQueue: true, attempts: 3 } }),
  O('o53', 1053, '2026-10-28 16:05', C.rahim, { source: 'phone', status: 'confirmed', pay: 'partially_paid', lines: [['v1', 2, 1450, 0], ['v14', 1, 150, 0]], adj: [['Eid offer: 10% off Panjabi', 290]], paid: 500, tags: ['vip'], line: 'House 12, Road 5, near Abahani field', payments: [['bkash', 500, 'TrxID 8K2M4Q1Z', '2026-10-28 16:20', 'paid']], conf: { via: 'call' } }),
  O('o52', 1052, '2026-10-28 12:30', C.farzana, { source: 'facebook', status: 'confirmed', pay: 'paid', lines: [['v8', 1, 12500, 0], ['v6', 3, 1850, 0], ['v9', 2, 2950, 0]], adj: [['Wholesale buyer', 1000, 'manual']], paid: 23020, score: 100, tags: ['wholesale'], line: 'Level 4, 32 Gulshan Avenue', payments: [['bank', 23020, 'City Bank 004513', '2026-10-28 13:10', 'paid']], conf: { via: 'staff' } }),
  O('o51', 1051, '2026-10-27 18:10', C.sharmin, { status: 'processing', del: 'shipped', lines: [['v4', 1, 3200, 0]], line: 'Tejgaon I/A, Road 2', score: 100, shipments: [{ courier: 'Steadfast', cons: 'SF-88213457', status: 'in_transit', lines: [['v4', 1]], updates: [['Booked', '2026-10-27 19:02'], ['Picked up', '2026-10-28 11:40'], ['In transit', '2026-10-28 18:15']] }], conf: { via: 'link' } }),
  O('o50', 1050, '2026-10-27 14:25', C.mitu, { zone: 'ctg', fee: 110, status: 'processing', pay: 'paid', del: 'shipped', lines: [['v9', 1, 2950, 0], ['v14', 1, 150, 0]], paid: 3210, line: 'GEC Circle, Panchlaish R/A', payments: [['online', 3210, 'bKash via SSLCommerz', '2026-10-27 14:26', 'paid']], shipments: [{ courier: 'Pathao', cons: 'PT-27A9QK', status: 'shipped', lines: [['v9', 1], ['v14', 1]], updates: [['Booked', '2026-10-27 16:00'], ['Picked up', '2026-10-28 10:05']] }] }),
  O('o49', 1049, '2026-10-26 13:00', C.joya, { zone: 'ctg', fee: 110, status: 'completed', pay: 'paid', del: 'delivered', lines: [['v6', 1, 1850, 0], ['v11', 1, 990, 0]], paid: 2950, line: 'Jamal Khan Road, H 4', returns: [['R-0014', 'requested']], shipments: [{ courier: 'Steadfast', cons: 'SF-88170112', status: 'delivered', lines: [['v6', 1], ['v11', 1]], updates: [['Booked', '2026-10-26 15:00'], ['Delivered', '2026-10-28 13:20']] }] }),
  O('o48', 1048, '2026-10-26 11:20', C.rahim, { source: 'phone', status: 'confirmed', lines: [['v9', 1, 2950, 0]], adj: [['Saree week: ৳270 off', 270]], tags: ['vip'], line: 'House 12, Road 5, near Abahani field', conf: { via: 'staff' } }),
  O('o47', 1047, '2026-10-25 15:40', C.tanvir, { zone: 'ctg', fee: 110, status: 'processing', del: 'failed', lines: [['v12', 1, 1650, 0]], score: 33, risky: true, flags: ['flagged_phone'], line: 'Block K, Lane 3, H 22', shipments: [{ courier: 'Steadfast', cons: 'SF-88190021', status: 'failed', failed: 'Customer refused at the door', returnedByCourier: '2026-10-28 18:10', lines: [['v12', 1]], updates: [['Booked', '2026-10-25 17:00'], ['In transit', '2026-10-26 09:30'], ['Coming back', '2026-10-27 14:00'], ['Returned to you', '2026-10-28 18:10']] }] }),
  O('o46', 1046, '2026-10-24 19:00', C.nusrat, { status: 'completed', pay: 'paid', del: 'delivered', lines: [['v1', 1, 1450, 0], ['v14', 1, 150, 0]], paid: 1670, score: 100, line: 'Block C, Iqbal Road', returns: [['R-0013', 'in_transit']] }),
  O('o45', 1045, '2026-10-24 10:30', C.sabbir, { status: 'cancelled', lines: [['v2', 1, 1450, 0]], score: null, cancel: ['shopper', 'Ordered the wrong size'], line: 'Section 2, Road 7' }),
  O('o44', 1044, '2026-10-23 17:20', C.rupa, { source: 'walk_in', zone: '', fee: 0, status: 'completed', pay: 'paid', del: 'delivered', lines: [['v14', 3, 150, 0], ['v5', 1, 850, 0]], paid: 1300, score: 100, payments: [['cash', 1300, '', '2026-10-23 17:20', 'paid']] }),
  O('o43', 1043, '2026-10-22 12:10', C.farzana, { source: 'facebook', status: 'completed', pay: 'paid', del: 'delivered', lines: [['v7', 2, 1850, 0], ['v4', 1, 3200, 0]], paid: 6970, score: 100, tags: ['wholesale'], line: 'Level 4, 32 Gulshan Avenue', returns: [['R-0012', 'inspected']] })
];
// What the couriers know about each phone: parcels sent, parcels delivered.
var RECORD = { '01987121212': [3, 1], '01911778899': [3, 1], '01712345678': [6, 6], '01819224466': [4, 4], '01722889900': [5, 4], '01611305522': [9, 9], '01790445566': [2, 2], '01716993311': [1, 1], '01688454545': [2, 2], '01855667788': [1, 1] };
ORDERS.forEach(function (o) { var r = RECORD[o.phone]; if (r && o.score !== null) o.score = Math.round(r[1] / r[0] * 100); });
var ST = {
  order: { pending: ['Pending', 'warn'], confirmed: ['Confirmed', 'info'], processing: ['Processing', 'info'], completed: ['Completed', 'good'], cancelled: ['Cancelled', 'ended'] },
  pay: { unpaid: ['Unpaid', 'ended'], partially_paid: ['Partly paid', 'warn'], paid: ['Paid', 'good'], partially_refunded: ['Partly refunded', 'ended'], refunded: ['Refunded', 'ended'] },
  del: { not_shipped: ['Not shipped', 'ended'], partially_shipped: ['Partly shipped', 'move'], shipped: ['Shipped', 'move'], delivered: ['Delivered', 'good'], failed: ['Delivery failed', 'bad'] },
  ship: { pending: ['Packing', 'warn'], booked: ['Booked', 'info'], shipped: ['On its way', 'move'], in_transit: ['In transit', 'move'], delivered: ['Delivered', 'good'], failed: ['Not delivered', 'bad'], returned: ['Returned', 'bad'] },
  ret: { requested: ['Requested', 'warn'], approved: ['Approved', 'info'], in_transit: ['On its way back', 'move'], received: ['Received', 'info'], inspected: ['Inspected', 'info'], resolved: ['Resolved', 'good'], rejected: ['Rejected', 'bad'] }
};
var TONE = {
  warn: ['color-mix(in oklch, var(--warn) 16%, transparent)', 'var(--warn)'], info: ['color-mix(in oklch, var(--info) 12%, transparent)', 'var(--info)'],
  move: ['color-mix(in oklch, var(--violet) 12%, transparent)', 'var(--violet)'], good: ['color-mix(in oklch, var(--success) 14%, transparent)', 'var(--success)'],
  bad: ['color-mix(in oklch, var(--destructive) 12%, transparent)', 'var(--destructive)'], ended: ['var(--muted)', 'var(--muted-foreground)']
};
var SOURCE = { website: 'Website', facebook: 'Facebook', phone: 'Phone', walk_in: 'Walk-in', other: 'Other', exchange: 'Exchange' };
var METHOD = { cod: 'Cash on delivery', online: 'Online (SSLCommerz)', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', bank: 'Bank transfer', cash: 'Cash', other: 'Other' };
function chip(kind, key) { var s = ST[kind][key]; var t = TONE[s[1]]; return { label: s[0], bg: t[0], fg: t[1], edge: 'transparent' }; }
function riskChip(score, risky) {
  if (score === null || score === undefined) return { label: 'New', bg: 'var(--muted)', fg: 'var(--muted-foreground)', edge: 'transparent' };
  if (risky) return { label: 'Risky · ' + score + '%', bg: TONE.bad[0], fg: TONE.bad[1], edge: 'transparent' };
  return { label: score + '%', bg: score >= 80 ? TONE.good[0] : 'var(--muted)', fg: score >= 80 ? TONE.good[1] : 'var(--foreground)', edge: 'transparent' };
}
function oById(id) { return ORDERS.filter(function (o) { return o.id === id; })[0]; }
function fmtPhone(p) { return p ? p.slice(0, 5) + '-' + p.slice(5) : ''; }
function when(s) { return short(s.slice(0, 10)) + ', ' + clock(s.slice(11, 16)); }
function totalsOf(o) {
  var sub = o.lines.reduce(function (a, l) { return a + l[1] * l[2]; }, 0);
  var off = o.adj.reduce(function (a, x) { return a + x[1]; }, 0);
  var total = sub - off + o.fee;
  return { sub: sub, off: off, fee: o.fee, total: total, paid: o.paid, cod: Math.max(0, total - o.paid), due: o.status === 'cancelled' ? 0 : Math.max(0, total - o.paid) };
}
function lineLabel(vid) { var v = vById(vid); return label(v); }
var FLAGS = { flagged_phone: 'Risky phone', possible_duplicate: 'Possible duplicate', unreachable: 'Unreachable' };
var CANCEL_CODES = [['changed_mind', 'The customer changed their mind'], ['no_answer', 'No answer'], ['wrong_number', 'Wrong number'], ['fake', 'Fake order'], ['out_of_stock', 'Out of stock'], ['other', 'Other']];
var COURIERS = [['steadfast', 'Steadfast'], ['pathao', 'Pathao'], ['redx', 'RedX']];
function checkOf(on, toggle, some) {
  return { on: Boolean(on), some: Boolean(some), aria: on ? 'true' : some ? 'mixed' : 'false', box: on || some ? 'var(--primary)' : 'transparent', edge: on || some ? 'var(--primary)' : 'var(--input)', toggle: toggle };
}
function zoneName(z) { var x = ZONES.filter(function (y) { return y[0] === z; })[0]; return x ? x[1] : 'No delivery'; }
function delChip(o) {
  var sh = o.shipments[o.shipments.length - 1];
  if (o.del === 'not_shipped' && sh && sh.status === 'booked') return chip('ship', 'booked');
  if (o.source === 'walk_in') return { label: 'Collected', bg: 'var(--muted)', fg: 'var(--muted-foreground)', edge: 'transparent' };
  return chip('del', o.del);
}
function itemsText(lines) {
  var n = lines.reduce(function (a, l) { return a + Number(l[1]); }, 0);
  var first = vById(lines[0][0]);
  return lines.length === 1 ? (lines[0][1] > 1 ? lines[0][1] + ' × ' : '') + first.t : first.t + ' and ' + plural(n - Number(lines[0][1]), 'more item', 'more items');
}
// A dashed filter that picks one or more values. s[key] holds the picked keys; s.fopen names the open one.
function listFilter(s, up, key, options, countOf) {
  var picked = s[key] || [], open = s.fopen === key, q = (s.fq || '').trim().toLowerCase();
  var items = options.filter(function (x) { return !q || x[1].toLowerCase().indexOf(q) !== -1; }).map(function (x) {
    var on = picked.indexOf(x[0]) !== -1;
    var pick = function () { var n = on ? picked.filter(function (k) { return k !== x[0]; }) : picked.concat([x[0]]); var p = { sel: [] }; p[key] = n; up(p); };
    return { label: x[1], count: countOf ? String(countOf(x[0])) : '', check: on ? '1' : '0', aria: on ? 'true' : 'false', on: on ? 'true' : 'false', pick: pick };
  });
  var labelOf = function (k) { return (options.filter(function (x) { return x[0] === k; })[0] || ['', ''])[1]; };
  return {
    open: open, aria: open ? 'true' : 'false', has: picked.length > 0, label: picked.length === 1 ? labelOf(picked[0]) : picked.length + ' selected',
    toggle: function () { up({ fopen: open ? null : key, fq: '' }); }, query: s.fq || '', onQuery: function (e) { up({ fq: e.target.value }); },
    items: items, none: items.length === 0, clear: function () { var p = { fopen: null }; p[key] = []; up(p); }
  };
}
// Cancelling an order: why, and a note.
function cancelForm(s, up, o, done) {
  var cf = s.cf || { code: '', reason: '' };
  var set = function (k, v) { var n = Object.assign({}, cf); n[k] = v; up({ cf: n }); };
  var t = o ? totalsOf(o) : null;
  var bad = Boolean(s.ctried) && !cf.code;
  return {
    open: Boolean(o), title: o ? 'Cancel order #' + o.n + '?' : '', bad: bad,
    codes: CANCEL_CODES.map(function (c) { var on = cf.code === c[0]; return { label: c[1], hasSub: false, sub: '', on: on, aria: on ? 'true' : 'false', pick: function () { set('code', c[0]); } }; }),
    reason: cf.reason, onReason: function (e) { set('reason', e.target.value); },
    stockNote: o ? (function (n) { return n === 1 ? 'The item goes back in stock.' : 'The ' + n + ' items go back in stock.'; })(o.lines.reduce(function (a, l) { return a + Number(l[1]); }, 0)) : '',
    paidNote: o && o.paid > 0 ? money(o.paid) + ' was paid. Record the refund on the order after.' : '', hasPaid: Boolean(o && o.paid > 0),
    confirm: function () { if (!cf.code) { up({ ctried: true }); return; } done(cf); }
  };
}
// Checkouts the shopper started on the website and didn't finish.
var INCOMPLETE = [
  { id: 'i1', name: 'Shapla Akter', phone: '01755443322', area: 'Banani', district: 'Dhaka', line: 'Road 11, House 34', lines: [['v8', 1, 12500]], step: 'payment', at: '2026-10-29 10:42', status: 'open', contacted: false, code: '', note: '' },
  { id: 'i2', name: 'Mahmud Hasan', phone: '01633221100', area: 'Khilgaon', district: 'Dhaka', line: 'Taltola, 2nd lane', lines: [['v1', 1, 1390], ['v14', 2, 150]], step: 'delivery', at: '2026-10-29 09:05', status: 'open', contacted: true, code: 'EID10', note: 'Will order after payday on the 1st.' },
  { id: 'i3', name: '', phone: '01944556677', area: '', district: '', line: '', lines: [['v6', 1, 1850]], step: 'contact', at: '2026-10-28 22:10', status: 'open', contacted: false, code: '', note: '' },
  { id: 'i4', name: 'Rumana Islam', phone: '01520998877', area: 'Agrabad', district: 'Chattogram', line: 'CDA R/A, Road 6', lines: [['v9', 2, 2950]], step: 'payment', at: '2026-10-28 18:30', status: 'ordered', contacted: true, code: '', note: 'Wanted cash on delivery, the site only showed bKash.', madeInto: 1041 },
  { id: 'i5', name: 'Tania Sultana', phone: '01799887766', area: 'Uttara', district: 'Dhaka', line: 'Sector 4, Road 9', lines: [['v4', 1, 3200]], step: 'payment', at: '2026-10-27 15:15', status: 'finished', contacted: false, code: '', note: '', madeInto: 1042 },
  { id: 'i6', name: 'Babu Mia', phone: '01911002233', area: 'Savar', district: 'Dhaka', line: '', lines: [['v12', 1, 1650]], step: 'delivery', at: '2026-10-26 12:00', status: 'dismissed', contacted: false, code: '', note: 'Test from the developer.' }
];
var INC_ST = { open: ['To call', 'warn'], ordered: ['Made into an order', 'good'], finished: ['Finished by the shopper', 'info'], dismissed: ['Dismissed', 'ended'] };
var STEPS = [['contact', 'Contact details'], ['delivery', 'Delivery'], ['payment', 'Payment']];
function incChip(k) { var x = INC_ST[k], t = TONE[x[1]]; return { label: x[0], bg: t[0], fg: t[1], edge: 'transparent' }; }
function stepLabel(k) { return STEPS.filter(function (x) { return x[0] === k; })[0][1]; }
function incValue(i) { return i.lines.reduce(function (a, l) { return a + l[1] * PRICE[l[0]]; }, 0); }
// Returns the customer asked for. lines: [variant, qty, reason, damaged-after-inspection]
var RET_REASONS = { wrong_size: 'Wrong size', damaged: 'Damaged', wrong_item: 'Wrong item', not_as_described: 'Not as described', changed_mind: 'Changed mind', refused: 'Refused at the door', other: 'Other' };
var RETURNS = [
  { id: 'r14', ref: 'R-0014', order: 1049, name: 'Joya Roy', phone: '01688454545', status: 'requested', at: '2026-10-29 09:30', lines: [['v6', 1, 'wrong_size', null]], wants: 'exchange', wantsText: 'Exchange for Maroon / M', note: 'The S is tight on me. Can I get an M instead?', photos: 2, history: [['Asked for a return on the website', '2026-10-29 09:30']] },
  { id: 'r13', ref: 'R-0013', order: 1046, name: 'Nusrat Jahan', phone: '01819224466', status: 'in_transit', at: '2026-10-26 11:15', lines: [['v1', 1, 'damaged', null]], wants: 'refund', wantsText: 'Refund to bKash', note: 'A seam is open at the shoulder.', photos: 1, history: [['Asked for a return by phone', '2026-10-26 11:15'], ['Approved by Rafiq Ahmed', '2026-10-26 12:00'], ['Pathao picked it up', '2026-10-28 10:20']] },
  { id: 'r12', ref: 'R-0012', order: 1043, name: 'Farzana Akter', phone: '01611305522', status: 'inspected', at: '2026-10-23 15:40', lines: [['v7', 2, 'not_as_described', 1]], wants: 'refund', wantsText: 'Refund to the bank', note: 'The colour is much darker than the photos.', photos: 3, history: [['Asked for a return on Facebook', '2026-10-23 15:40'], ['Approved by Rafiq Ahmed', '2026-10-23 17:00'], ['Received in the shop', '2026-10-26 13:10'], ['Inspected: 1 good, 1 damaged', '2026-10-26 13:30']] },
  { id: 'r11', ref: 'R-0011', order: 1038, name: 'Laila Ferdous', phone: '01741556677', status: 'resolved', at: '2026-10-20 10:00', lines: [['v13', 1, 'damaged', 1]], wants: 'refund', wantsText: 'Refund to bKash', note: 'The sole came off on the first day.', photos: 2, outcome: 'Refunded ৳1,650 by bKash · TrxID 7H2K9M1Q', history: [['Asked for a return by phone', '2026-10-20 10:00'], ['Approved by Rafiq Ahmed', '2026-10-20 10:30'], ['Received in the shop', '2026-10-22 16:00'], ['Inspected: 1 damaged', '2026-10-22 16:10'], ['Refunded ৳1,650 by bKash', '2026-10-22 16:20']] },
  { id: 'r10', ref: 'R-0010', order: 1033, name: 'Sabbir Rahman', phone: '01552114477', status: 'rejected', at: '2026-10-18 19:00', lines: [['v11', 1, 'changed_mind', null]], wants: 'refund', wantsText: 'Refund to Nagad', note: 'Don’t like it any more.', photos: 0, outcome: 'Rejected: asked 15 days after delivery. Returns are open for 7 days.', history: [['Asked for a return on the website', '2026-10-18 19:00'], ['Rejected by Rafiq Ahmed', '2026-10-19 10:00']] },
  { id: 'r09', ref: 'R-0009', order: 1037, name: 'Rehana Parvin', phone: '01822334455', status: 'approved', at: '2026-10-27 12:20', lines: [['v10', 1, 'wrong_item', null]], wants: 'exchange', wantsText: 'Exchange for Green / M', note: 'I ordered green, this is blue.', photos: 1, history: [['Asked for a return by phone', '2026-10-27 12:20'], ['Approved by Rafiq Ahmed', '2026-10-27 12:45']] }
];
function retChip(k) { return chip('ret', k); }
function retValue(r) { return r.lines.reduce(function (a, l) { return a + l[1] * PRICE[l[0]]; }, 0); }
function retItems(r) { return r.lines.map(function (l) { return (l[1] > 1 ? l[1] + ' × ' : '') + vById(l[0]).t; }).join(', '); }
