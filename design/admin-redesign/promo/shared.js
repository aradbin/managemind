var NOW = '2026-10-29T12:00';
var ACTIONS = [
  { v: 'percent_off_order', label: 'A percentage off the order', sub: 'Like 10% off everything' },
  { v: 'amount_off_order', label: 'An amount off the order', sub: 'Like ৳300 off' },
  { v: 'percent_off_items', label: 'A percentage off chosen items', sub: 'Like 20% off sarees' },
  { v: 'amount_off_items', label: 'An amount off each chosen item', sub: 'Like ৳100 off each panjabi' },
  { v: 'buy_x_get_y', label: 'Buy some, get some', sub: 'Like buy 2, get 1 free' },
  { v: 'delivery_percent_off', label: 'Free or cheaper delivery (percentage)', sub: '100% makes delivery free' },
  { v: 'delivery_amount_off', label: 'An amount off delivery', sub: 'Like ৳30 off delivery' }
];
var ITEM_GROUPS = [
  { g: 'Categories', items: [['cat:men', 'Men'], ['cat:panjabi', 'Men › Panjabi'], ['cat:women', 'Women'], ['cat:saree', 'Women › Saree'], ['cat:kurti', 'Women › Kurti'], ['cat:kids', 'Kids'], ['cat:acc', 'Accessories']] },
  { g: 'Collections', items: [['col:eid', 'Eid collection'], ['col:festive', 'Festive under ৳3,500'], ['col:new', 'New arrivals'], ['col:best', 'Best sellers'], ['col:winter', 'Winter']] },
  { g: 'Products', items: [['p:p1', 'Cotton Panjabi — Ivory'], ['p:p2', 'Handloom Tangail Saree'], ['p:p3', 'Embroidered Kurti'], ['p:p4', 'Leather Kolhapuri Sandal'], ['p:p7', 'Jute Tote Bag'], ['p:p9', 'Winter Shawl — Kashmiri']] }
];
var ZONES = [['inside', 'Inside Dhaka'], ['suburbs', 'Dhaka suburbs'], ['outside', 'Outside Dhaka']];
var TAGS = ['vip', 'eid', 'wholesale', 'repeat', 'ctg', 'dhaka'];
var PAYMENTS = [['cod', 'Cash on delivery'], ['manual', 'Paid in advance'], ['online', 'Paid online']];
var COND_TYPES = [
  { v: 'min_subtotal', label: 'Order at least', sub: 'A minimum order amount' },
  { v: 'min_quantity', label: 'At least this many items', sub: 'A minimum item count' },
  { v: 'items', label: 'The cart holds certain items', sub: 'Categories, collections or products' },
  { v: 'zones', label: 'Delivery zones', sub: 'Only for some delivery areas' },
  { v: 'first_order', label: 'First orders only', sub: 'For new customers' },
  { v: 'tags', label: 'Customers tagged', sub: 'Like vip or wholesale' },
  { v: 'phones', label: 'Only these phones', sub: 'A list of customer phones' },
  { v: 'payment', label: 'Payment method', sub: 'Like cash on delivery only' }
];
function P(o) {
  return Object.assign({
    titleBn: '', titleEn: '', kind: 'automatic', code: '', codeCount: 0, codesUsed: 0, status: 'active', startsAt: '', endsAt: '',
    action: 'percent_off_order', percent: '10', amount: '', target: [], buyQty: '2', buyItems: [], getQty: '1', getSame: true, getItems: [], maxUses: '',
    conds: [], usageLimit: '', perCustomer: '', maxDiscount: '', priority: '0', exclusive: false,
    uses: 0, orders: 0, discount: 0, sales: 0
  }, o);
}
var PROMOS = [
  P({ id: 'eid', titleBn: 'ঈদে ১০% ছাড়', titleEn: 'Eid 10% off', kind: 'code', code: 'EID10', startsAt: '2026-10-01T00:00', endsAt: '2026-10-31T23:59', percent: '10', conds: [{ type: 'min_subtotal', value: '2000' }], usageLimit: '1000', perCustomer: '1', maxDiscount: '500', uses: 312, orders: 312, discount: 98450, sales: 1184300 }),
  P({ id: 'freedel', titleBn: 'ফ্রি ডেলিভারি', titleEn: 'Free delivery over ৳1,500', action: 'delivery_percent_off', percent: '100', conds: [{ type: 'min_subtotal', value: '1500' }, { type: 'zones', ids: ['inside'] }], uses: 1284, orders: 1284, discount: 76940, sales: 2940100 }),
  P({ id: 'bxgy', titleBn: '২টি কিনলে ১টি অর্ধেক দামে', titleEn: 'Buy 2 panjabi, get 1 half price', action: 'buy_x_get_y', percent: '50', buyItems: ['cat:panjabi'], startsAt: '2026-11-01T00:00', endsAt: '2026-11-15T23:59', maxUses: '1' }),
  P({ id: 'vip', titleBn: 'ভিআইপি ৳৩০০ ছাড়', titleEn: 'VIP ৳300 off', kind: 'code', codeCount: 250, codesUsed: 41, action: 'amount_off_order', amount: '300', percent: '', conds: [{ type: 'tags', tags: ['vip'] }], uses: 41, orders: 41, discount: 12300, sales: 186400 }),
  P({ id: 'welcome', titleBn: 'প্রথম অর্ডারে ১৫%', titleEn: 'First order 15%', kind: 'code', code: 'WELCOME15', percent: '15', conds: [{ type: 'first_order' }], maxDiscount: '500', perCustomer: '1', uses: 129, orders: 129, discount: 41870, sales: 352600 }),
  P({ id: 'winter', titleBn: 'শীতের শাল ২০%', titleEn: 'Winter shawls 20% off', status: 'draft', action: 'percent_off_items', percent: '20', target: ['col:winter'], startsAt: '2026-12-01T00:00' }),
  P({ id: 'falgun', titleBn: 'পহেলা ফাল্গুন', titleEn: 'Pohela Falgun sarees', action: 'percent_off_items', percent: '12', target: ['cat:saree'], startsAt: '2026-02-13T00:00', endsAt: '2026-02-14T23:59', uses: 207, orders: 207, discount: 61240, sales: 512800 }),
  P({ id: 'flash', titleBn: 'ফ্ল্যাশ সেল', titleEn: 'Flash sale ৳200 off', kind: 'code', code: 'FLASH200', status: 'paused', action: 'amount_off_order', amount: '200', percent: '', conds: [{ type: 'min_subtotal', value: '1500' }], usageLimit: '100', uses: 88, orders: 88, discount: 17600, sales: 214900 })
];
var STATE_STYLE = {
  live: { label: 'Live', bg: 'color-mix(in oklch, var(--success) 14%, transparent)', fg: 'var(--success)' },
  scheduled: { label: 'Scheduled', bg: 'color-mix(in oklch, var(--sidebar-primary) 14%, transparent)', fg: 'var(--sidebar-primary)' },
  draft: { label: 'Draft', bg: 'var(--muted)', fg: 'var(--muted-foreground)' },
  paused: { label: 'Paused', bg: 'color-mix(in oklch, var(--warn) 16%, transparent)', fg: 'var(--warn)' },
  ended: { label: 'Ended', bg: 'transparent', fg: 'var(--muted-foreground)', edge: 'var(--border)' }
};
var FONTS = {
  Inter: "'Inter', 'Noto Sans Bengali', system-ui, sans-serif",
  Geist: "'Geist', 'Noto Sans Bengali', system-ui, sans-serif"
};
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function copy(x) { return JSON.parse(JSON.stringify(x)); }
function money(n) { return '৳' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
function plural(x, one, many) { return Number(x).toLocaleString('en-US') + ' ' + (x === 1 ? one : many); }
function num(x) { var v = parseFloat(String(x).replace(/,/g, '')); return isNaN(v) ? null : v; }
function day(dt) { if (!dt) return ''; var m = Number(dt.slice(5, 7)), d = Number(dt.slice(8, 10)), y = dt.slice(0, 4); return d + ' ' + MONTHS[m - 1] + (y !== NOW.slice(0, 4) ? ' ' + y : ''); }
function stateOf(p) {
  if (p.status !== 'active') return p.status;
  if (p.startsAt && p.startsAt > NOW) return 'scheduled';
  if (p.endsAt && p.endsAt < NOW) return 'ended';
  return 'live';
}
function title(p) { return p.titleEn || p.titleBn || 'Untitled promotion'; }
function itemName(v) {
  for (var i = 0; i < ITEM_GROUPS.length; i++) for (var k = 0; k < ITEM_GROUPS[i].items.length; k++) if (ITEM_GROUPS[i].items[k][0] === v) return ITEM_GROUPS[i].items[k][1];
  return v;
}
function itemsText(list) {
  if (!list.length) return 'the chosen items';
  var names = list.map(itemName);
  return names.length <= 2 ? names.join(' and ') : names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' more';
}
function actionText(p) {
  var pc = num(p.percent), am = money(num(p.amount) || 0);
  switch (p.action) {
    case 'percent_off_order': return (pc || '…') + '% off the order';
    case 'amount_off_order': return am + ' off the order';
    case 'percent_off_items': return (pc || '…') + '% off ' + itemsText(p.target);
    case 'amount_off_items': return am + ' off each of ' + itemsText(p.target);
    case 'buy_x_get_y': return 'Buy ' + (p.buyQty || '…') + ' of ' + itemsText(p.buyItems) + ', get ' + (p.getQty || '…') + ' ' + (p.getSame ? 'more' : itemsText(p.getItems)) + (pc === 100 ? ' free' : ' at ' + (pc || '…') + '% off');
    case 'delivery_percent_off': return pc === 100 ? 'Free delivery' : (pc || '…') + '% off delivery';
    case 'delivery_amount_off': return am + ' off delivery';
  }
  return '';
}
function summary(p) {
  var parts = [];
  p.conds.forEach(function (c) {
    if (c.type === 'min_subtotal' && num(c.value)) parts.push('on orders over ' + money(num(c.value)));
    if (c.type === 'min_quantity' && num(c.value)) parts.push('with ' + num(c.value) + ' or more items');
    if (c.type === 'items' && c.items && c.items.length) parts.push('when the cart has ' + itemsText(c.items));
    if (c.type === 'zones' && c.ids && c.ids.length) parts.push('delivery zone: ' + c.ids.map(function (z) { return ZONES.filter(function (x) { return x[0] === z; })[0][1]; }).join(', '));
    if (c.type === 'first_order') parts.push('first orders only');
    if (c.type === 'tags' && c.tags && c.tags.length) parts.push('for customers tagged ' + c.tags.join(', '));
    if (c.type === 'phones') { var n = String(c.text || '').split(/\n/).filter(function (x) { return x.trim(); }).length; if (n) parts.push('for ' + plural(n, 'chosen phone', 'chosen phones')); }
    if (c.type === 'payment' && c.methods && c.methods.length) parts.push(c.methods.length === 1 && c.methods[0] === 'cod' ? 'paying cash on delivery' : c.methods.indexOf('cod') === -1 ? 'paying in advance' : 'paying by ' + c.methods.map(function (m) { return PAYMENTS.filter(function (x) { return x[0] === m; })[0][1].toLowerCase(); }).join(' or '));
  });
  if (p.kind === 'code') parts.push(p.code ? 'with code ' + p.code.toUpperCase() : 'with one of its generated codes');
  if (p.startsAt && p.endsAt) parts.push('from ' + day(p.startsAt) + ' until ' + day(p.endsAt));
  else if (p.startsAt) parts.push('from ' + day(p.startsAt));
  else if (p.endsAt) parts.push('until ' + day(p.endsAt));
  return actionText(p) + (parts.length ? ', ' + parts.join(', ') : '') + '.';
}
