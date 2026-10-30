var TODAY = '2026-10-29';
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var METHODS = [['cash', 'Cash'], ['bank', 'Bank'], ['bkash', 'bKash'], ['nagad', 'Nagad'], ['card', 'Card'], ['other', 'Other']];
var VARIANTS = [
  { id: 'v1', t: 'Cotton Panjabi', o: 'Ivory / M', sku: 'PNJ-IV-M', bc: '8941100100011', oh: 18, rs: 3, low: 5, track: true, cost: 655, sup: 's3', cat: 'Panjabi', tags: ['eid'] },
  { id: 'v2', t: 'Cotton Panjabi', o: 'Ivory / L', sku: 'PNJ-IV-L', bc: '8941100100028', oh: 4, rs: 2, low: 5, track: true, cost: 655, sup: 's3', cat: 'Panjabi', tags: ['eid'] },
  { id: 'v3', t: 'Cotton Panjabi', o: 'Ivory / XL', sku: 'PNJ-IV-XL', bc: '8941100100035', oh: 0, rs: 0, low: 3, track: true, cost: 655, sup: 's3', cat: 'Panjabi', tags: ['eid'] },
  { id: 'v4', t: 'Silk Panjabi', o: 'Navy / L', sku: 'PNJ-SK-NV-L', bc: '8941100100042', oh: 9, rs: 1, low: 2, track: true, cost: 1450, sup: 's2', cat: 'Panjabi', tags: ['eid', 'premium'] },
  { id: 'v5', t: 'Kids Panjabi', o: 'Mint / 4 years', sku: 'PNJ-KD-MN-4', bc: '8941100100059', oh: 14, rs: 0, low: 4, track: true, cost: 380, sup: 's3', cat: 'Panjabi', tags: ['kids'] },
  { id: 'v6', t: 'Embroidered Kurti', o: 'Maroon / S', sku: 'KRT-EM-MR-S', bc: '8941100100066', oh: 11, rs: 2, low: 3, track: true, cost: 890, sup: 's2', cat: 'Kurti', tags: ['eid'] },
  { id: 'v7', t: 'Embroidered Kurti', o: 'Maroon / M', sku: 'KRT-EM-MR-M', bc: '8941100100073', oh: 3, rs: 1, low: 3, track: true, cost: 890, sup: 's2', cat: 'Kurti', tags: ['eid'] },
  { id: 'v8', t: 'Jamdani Saree', o: 'Red', sku: 'SAR-JM-RD', bc: '8941100100080', oh: 6, rs: 0, low: 2, track: true, cost: 4200, sup: 's1', cat: 'Saree', tags: ['premium'] },
  { id: 'v9', t: 'Tangail Cotton Saree', o: 'Green', sku: 'SAR-TG-GR', bc: '8941100100097', oh: 15, rs: 2, low: 4, track: true, cost: 1350, sup: 's1', cat: 'Saree', tags: [] },
  { id: 'v10', t: 'Cotton Three-piece', o: 'Green / M', sku: '3PC-GR-M', bc: '8941100100103', oh: 22, rs: 4, low: 5, track: true, cost: 1100, sup: 's3', cat: 'Three-piece', tags: ['eid'] },
  { id: 'v11', t: 'Batik Fatua', o: 'Indigo / L', sku: 'FTU-BT-IN-L', bc: '8941100100110', oh: 7, rs: 0, low: 2, track: true, cost: 520, sup: 's2', cat: 'Fatua', tags: [] },
  { id: 'v16', t: 'Batik Fatua', o: 'Indigo / XL', sku: 'FTU-BT-IN-XL', bc: '8941100100127', oh: 3, rs: 0, low: 1, track: true, cost: null, sup: '', cat: 'Fatua', tags: [] },
  { id: 'v12', t: 'Leather Sandal', o: 'Brown / 41', sku: 'SND-BR-41', bc: '8941100100134', oh: 2, rs: 0, low: 3, track: true, cost: 950, sup: 's4', cat: 'Footwear', tags: [] },
  { id: 'v13', t: 'Leather Sandal', o: 'Brown / 42', sku: 'SND-BR-42', bc: '8941100100141', oh: 5, rs: 1, low: 3, track: true, cost: 950, sup: 's4', cat: 'Footwear', tags: [] },
  { id: 'v14', t: 'Prayer Cap', o: 'White', sku: 'CAP-WH', bc: '8941100100158', oh: 40, rs: 0, low: 10, track: true, cost: 60, sup: 's3', cat: 'Accessories', tags: ['eid'] },
  { id: 'v15', t: 'Gift wrap', o: '', sku: 'GFT-WRAP', bc: '', oh: 0, rs: 0, low: 0, track: false, cost: 20, sup: '', cat: 'Accessories', tags: [] }
];
var SUPPLIERS = [
  { id: 's1', name: 'Tangail Tant Ghar', contact: 'Rafiq Mia', phones: ['01711-234567'], email: 'tantghar@gmail.com', address: 'Pathrail, Delduar, Tangail', note: 'Sends by Sundarban Courier. Ask for a photo of the receipt.', opening: 20000, balance: 48500, archived: false, since: '2025-03-10' },
  { id: 's2', name: 'Rupkotha Embroidery', contact: 'Shahana Begum', phones: ['01819-445566', '01556-778899'], email: '', address: 'Mirpur 10, Dhaka', note: '', opening: 0, balance: -5000, archived: false, since: '2025-06-02' },
  { id: 's3', name: 'Islampur Fabrics', contact: 'Abdul Karim', phones: ['01912-334455'], email: '', address: 'Islampur Road, Old Dhaka', note: 'Closed on Fridays.', opening: 0, balance: 26000, archived: false, since: '2025-01-15' },
  { id: 's4', name: 'Chittagong Leather Works', contact: 'Mohammad Hasan', phones: ['01811-998877'], email: 'clw.hasan@yahoo.com', address: 'Hazari Lane, Chattogram', note: '', opening: 0, balance: 12800, archived: false, since: '2025-09-20' },
  { id: 's5', name: 'Narayanganj Knit', contact: '', phones: ['01611-223344'], email: '', address: '', note: '', opening: 0, balance: 0, archived: true, since: '2025-02-01' }
];
var POS = [
  { id: 'po18', ref: 'PO-0018', sup: 's2', status: 'draft', created: '2026-10-28', expected: '', supRef: '', note: '', lines: [['v6', 10, 890, 0], ['v7', 12, 890, 0], ['v4', 6, 1450, 0]], costs: [], receipts: [] },
  { id: 'po17', ref: 'PO-0017', sup: 's1', status: 'ordered', created: '2026-10-24', expected: '2026-11-03', supRef: 'TTG-2210', note: '', lines: [['v8', 4, 4200, 0], ['v9', 10, 1350, 0]], costs: [['Courier', 1200]], receipts: [] },
  { id: 'po16', ref: 'PO-0016', sup: 's3', status: 'partially_received', created: '2026-10-12', expected: '2026-10-25', supRef: 'IF-7781', note: 'XL comes with the next bale.', lines: [['v1', 20, 655, 20], ['v2', 20, 655, 12], ['v3', 10, 655, 0], ['v10', 10, 1100, 8]], costs: [['Transport from Islampur', 1500]], receipts: [['GRN-0029', '2026-10-18', 30, 21410], ['GRN-0031', '2026-10-22', 10, 7350]] },
  { id: 'po15', ref: 'PO-0015', sup: 's4', status: 'received', created: '2026-10-02', expected: '2026-10-09', supRef: '', note: '', lines: [['v12', 12, 950, 12], ['v13', 12, 950, 12]], costs: [], receipts: [['GRN-0027', '2026-10-09', 24, 22800]] },
  { id: 'po14', ref: 'PO-0014', sup: 's3', status: 'closed', created: '2026-09-20', expected: '2026-09-28', supRef: '', note: '', lines: [['v5', 30, 380, 25], ['v14', 100, 60, 100]], costs: [], receipts: [['GRN-0024', '2026-09-28', 125, 15500]] },
  { id: 'po13', ref: 'PO-0013', sup: 's2', status: 'cancelled', created: '2026-09-15', expected: '', supRef: '', note: '', lines: [['v11', 15, 520, 0]], costs: [], receipts: [] }
];
var PO_STATUS = {
  draft: { label: 'Draft', bg: 'var(--muted)', fg: 'var(--muted-foreground)' },
  ordered: { label: 'Ordered', bg: 'color-mix(in oklch, var(--info) 12%, transparent)', fg: 'var(--info)' },
  partially_received: { label: 'Partly received', bg: 'color-mix(in oklch, var(--warn) 16%, transparent)', fg: 'var(--warn)' },
  received: { label: 'Received', bg: 'color-mix(in oklch, var(--success) 14%, transparent)', fg: 'var(--success)' },
  closed: { label: 'Closed', bg: 'var(--muted)', fg: 'var(--muted-foreground)' },
  cancelled: { label: 'Cancelled', bg: 'transparent', fg: 'var(--muted-foreground)', edge: 'var(--border)' }
};
var COUNT_STATUS = {
  counting: { label: 'Counting', bg: 'color-mix(in oklch, var(--info) 12%, transparent)', fg: 'var(--info)' },
  review: { label: 'In review', bg: 'color-mix(in oklch, var(--warn) 16%, transparent)', fg: 'var(--warn)' },
  applied: { label: 'Applied', bg: 'color-mix(in oklch, var(--success) 14%, transparent)', fg: 'var(--success)' },
  cancelled: { label: 'Cancelled', bg: 'transparent', fg: 'var(--muted-foreground)', edge: 'var(--border)' }
};
var REASONS = [
  ['received', 'Received'], ['count', 'Count'], ['damaged', 'Damaged'], ['lost', 'Lost'], ['expired', 'Expired'], ['sample', 'Sample'],
  ['returned', 'Returned'], ['correction', 'Correction'], ['import', 'Import'], ['other', 'Other']
];
var FONTS = {
  Inter: "'Inter', 'Noto Sans Bengali', system-ui, sans-serif",
  Geist: "'Geist', 'Noto Sans Bengali', system-ui, sans-serif"
};
function copy(x) { return JSON.parse(JSON.stringify(x)); }
function money(v) { return v < 0 ? '−৳' + Math.round(-v).toLocaleString('en-US') : '৳' + Math.round(Number(v) || 0).toLocaleString('en-US'); }
function signedMoney(v) { return v > 0 ? '+' + money(v) : money(v); }
function signed(n) { return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0'; }
function plural(x, one, many) { return Number(x).toLocaleString('en-US') + ' ' + (x === 1 ? one : many); }
function num(x) { var v = parseFloat(String(x).replace(/,/g, '').replace(/[০-৯]/g, function (d) { return '০১২৩৪৫৬৭৮৯'.indexOf(d); })); return isNaN(v) ? null : v; }
function short(s) { return s ? MONTHS[Number(s.slice(5, 7)) - 1].slice(0, 3) + ' ' + Number(s.slice(8, 10)) : '—'; }
function longDate(s) { return MONTHS[Number(s.slice(5, 7)) - 1].slice(0, 3) + ' ' + Number(s.slice(8, 10)) + ', ' + s.slice(0, 4); }
function clock(hm) { var h = Number(hm.slice(0, 2)), m = hm.slice(3, 5); return (h % 12 || 12) + ':' + m + (h < 12 ? ' AM' : ' PM'); }
function vById(id) { return VARIANTS.filter(function (v) { return v.id === id; })[0]; }
function sById(id) { return SUPPLIERS.filter(function (s) { return s.id === id; })[0]; }
function label(v) { return v.o ? v.t + ' — ' + v.o : v.t; }
function available(v) { return v.oh - v.rs; }
function isLow(v) { return v.track && available(v) <= v.low; }
function methodLabel(m) { return (METHODS.filter(function (x) { return x[0] === m; })[0] || METHODS[5])[1]; }
function balanceOf(b) {
  if (b > 0) return { text: 'You owe ' + money(b), owed: true, fg: 'var(--foreground)', weight: '600' };
  if (b < 0) return { text: 'Advance ' + money(-b), owed: false, fg: 'var(--muted-foreground)', weight: '400' };
  return { text: 'Settled', owed: false, fg: 'var(--muted-foreground)', weight: '400' };
}
function poTotals(lines, costs) {
  var goods = lines.reduce(function (a, l) { return a + (num(l[1]) || 0) * (num(l[2]) || 0); }, 0);
  var other = costs.reduce(function (a, c) { return a + (num(c[1]) || 0); }, 0);
  return { goods: goods, other: other, total: goods + other };
}
function poProgress(po) {
  var o = po.lines.reduce(function (a, l) { return a + Number(l[1]); }, 0), r = po.lines.reduce(function (a, l) { return a + Number(l[3]); }, 0);
  return { ordered: o, received: r, text: r + ' of ' + o + ' received', pct: o ? Math.round(r / o * 100) + '%' : '0%' };
}
function badgeOf(map, key) { var b = map[key]; return { label: b.label, bg: b.bg, fg: b.fg, edge: b.edge || 'transparent' }; }
function boot(self, start, fallback) {
  var startKey = self.props.startOn ?? fallback;
  var s = self.state || {};
  if (s.started !== startKey) s = Object.assign({ started: startKey, dark: s.dark }, copy(start[startKey] || {}));
  var up = function (patch) { self.setState(Object.assign({}, s, patch, { started: startKey })); };
  var toast = function (text) {
    clearTimeout(self.toastTimer);
    self.toastTimer = setTimeout(function () { self.setState({ toast: null }); }, 4000);
    return text;
  };
  var dark = typeof s.dark === 'boolean' ? s.dark : (self.props.dark ?? false);
  var vals = {
    themeClass: ROOT + (dark ? ' dark' : ''), fontStack: FONTS[self.props.font ?? 'Inter'] || FONTS.Inter,
    isDark: dark, isLight: !dark, themeLabel: dark ? 'Switch to light theme' : 'Switch to dark theme',
    toggleTheme: function () { up({ dark: !dark }); },
    hasToast: Boolean(s.toast), toastText: s.toast || ''
  };
  return { s: s, up: up, toast: toast, vals: vals };
}
