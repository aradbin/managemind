// Platform: the stores on ManageMind, their plans, and the people who run the platform.
// id, name, slug, status, kind, plan, setup steps done (null: not checked yet), created, owner, members, why (suspended or closed)
var STORES = [
  ['t1', 'Nakshi Fashion', 'nakshi', 'active', 'client', 'growth', 7, '2026-07-01', ['Rafiq Ahmed', 'rafiq@nakshifashion.com.bd'], 5],
  ['t2', 'Bazar Fresh', 'bazarfresh', 'active', 'client', 'growth', 10, '2026-03-14', ['Selina Haque', 'selina@bazarfresh.com.bd'], 9],
  ['t3', 'Boi Ghor', 'boighor', 'active', 'client', 'starter', 10, '2026-04-02', ['Mahfuz Alam', 'mahfuz@boighor.com'], 2],
  ['t4', 'Kumkum Crafts', 'kumkum', 'active', 'client', 'starter', 9, '2026-05-20', ['Kumkum Das', 'kumkum.das@gmail.com'], 3],
  ['t5', 'Modhu Mela', 'modhumela', 'active', 'client', 'starter', 4, '2026-10-18', ['Habibur Rahman', 'habib@modhumela.com'], 1],
  ['t6', 'Shapla Gadgets', 'shapla', 'suspended', 'client', 'growth', 10, '2026-02-11', ['Arif Chowdhury', 'arif@shaplagadgets.com'], 6, 'overdue'],
  ['t7', 'Jamdani House', 'jamdani', 'active', 'client', 'growth', 10, '2026-01-08', ['Rokeya Begum', 'rokeya@jamdanihouse.com'], 7],
  ['t8', 'Rongdhonu Kids', 'rongdhonu', 'closed', 'client', 'starter', 10, '2025-12-03', ['Tania Sultana', 'tania@rongdhonukids.com'], 2, 'client_request'],
  ['t9', 'Tea Garden Co.', 'teagarden', 'active', 'client', 'starter', null, '2026-10-27', ['Sajid Khan', 'sajid@teagarden.com.bd'], 1],
  ['t10', 'Ghoroa Kitchen', 'ghoroa', 'active', 'client', 'pilot', 10, '2025-11-20', ['Nusrat Jahan', 'nusrat@ghoroakitchen.com'], 4],
  ['t11', 'Demo: fashion', 'demo-fashion', 'active', 'demo', 'pilot', 10, '2025-10-02', ['Tanvir Hasan', 'tanvir@managemind.app'], 2],
  ['t12', 'Demo: grocery', 'demo-grocery', 'active', 'demo', 'pilot', 10, '2025-10-02', ['Tanvir Hasan', 'tanvir@managemind.app'], 2],
  ['t13', 'QA store', 'qa-1', 'active', 'test', 'pilot', 6, '2026-08-30', ['Sumaiya Rahman', 'sumaiya@managemind.app'], 1],
  ['t14', 'Old Town Mart', 'oldtown', 'purged', 'client', 'starter', 10, '2025-11-05', ['Kamal Uddin', 'kamal@oldtownmart.com'], 0, 'overdue']
];
var PLANS = [['starter', 'Starter', 1500, 5000], ['growth', 'Growth', 4000, 10000], ['pilot', 'Pilot', 0, 0]];
var T_ST = { active: ['Active', 'good'], suspended: ['Suspended', 'warn'], closed: ['Closed', 'ended'], purged: ['Deleted', 'ended'] };
var KINDS = { client: 'Client', demo: 'Demo', test: 'Test' };
var WHY = [['overdue', 'Invoice overdue'], ['abuse', 'Abuse'], ['client_request', 'The client asked'], ['other', 'Other']];
var CHECKLIST = [['terms', 'Platform terms accepted'], ['profile', 'Business name, address and phone'], ['logo', 'Logo'], ['products', 'A product on sale with stock'], ['delivery', 'Delivery charges checked'],
  ['payments', 'A way to pay: cash on delivery or SSLCommerz'], ['legal', 'Terms, privacy, returns and delivery pages published'], ['email', 'Email to customers working'], ['sms', 'SMS gateway', true], ['domain', 'Web address chosen', true]];
// Invoices: number (null for a draft), store, status, issued, due, total, paid, period
var INVOICES = [
  [null, 't5', 'draft', null, '2026-11-07', 6500, 0, '18 Oct – 17 Nov 2026'],
  [null, 't2', 'draft', null, '2026-11-08', 4000, 0, '1 Nov – 30 Nov 2026'],
  ['INV-2026-0047', 't7', 'issued', '2026-10-26', '2026-11-02', 4870, 0, '25 Oct – 24 Nov 2026'],
  ['INV-2026-0046', 't4', 'issued', '2026-10-22', '2026-10-29', 1500, 0, '20 Oct – 19 Nov 2026'],
  ['INV-2026-0045', 't3', 'paid', '2026-10-20', '2026-10-27', 1500, 1500, '2 Oct – 1 Nov 2026'],
  ['INV-2026-0042', 't1', 'issued', '2026-10-05', '2026-10-12', 1500, 0, '5 Oct – 4 Nov 2026'],
  ['INV-2026-0040', 't6', 'issued', '2026-09-11', '2026-09-18', 4000, 0, '11 Sep – 10 Oct 2026'],
  ['INV-2026-0039', 't2', 'paid', '2026-10-01', '2026-10-08', 4000, 4000, '1 Oct – 31 Oct 2026'],
  ['INV-2026-0036', 't7', 'paid', '2026-09-25', '2026-10-02', 4000, 4000, '25 Sep – 24 Oct 2026'],
  ['INV-2026-0034', 't4', 'paid', '2026-09-22', '2026-09-29', 1500, 1500, '20 Sep – 19 Oct 2026'],
  ['INV-2026-0033', 't8', 'void', '2026-09-03', '2026-09-10', 1500, 0, '3 Sep – 2 Oct 2026'],
  ['INV-2026-0031', 't1', 'paid', '2026-09-05', '2026-09-12', 1500, 1500, '5 Sep – 4 Oct 2026']
];
var STAFF = [['Rafiq Ahmed', 'rafiq@managemind.app', 'super_admin', true, true], ['Tanvir Hasan', 'tanvir@managemind.app', 'super_admin', true], ['Sumaiya Rahman', 'sumaiya@managemind.app', 'support', true],
  ['Imran Kabir', 'imran@managemind.app', 'support', false], ['Farhana Yasmin', 'farhana@managemind.app', null, true]];
var P_ROLES = [['super_admin', 'Super admin', 'Everything on the platform, including staff, stores’ plans and purges.'], ['support', 'Support', 'Sees stores and billing, and can open a store as a viewer.'], [null, 'None', 'No platform access. Their own stores are unaffected.']];
function tById(id) { return STORES.filter(function (x) { return x[0] === id; })[0]; }
function planOf(k) { return PLANS.filter(function (p) { return p[0] === k; })[0]; }
function tone(label, t) { var x = TONE[t]; return { label: label, bg: x[0], fg: x[1], edge: 'transparent' }; }
function tChip(st) { return tone(T_ST[st][0], T_ST[st][1]); }
function initials(n) { return n.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
function setupText(t) { return t[6] === null ? 'Not checked yet' : t[6] + ' of 10'; }
function whyLabel(k) { return (WHY.filter(function (w) { return w[0] === k; })[0] || ['', ''])[1]; }
function invChip(i) {
  if (i[2] === 'issued' && i[4] < TODAY) return tone('Overdue', 'bad');
  return tone({ draft: 'Draft', issued: 'Issued', paid: 'Paid', void: 'Void' }[i[2]], { draft: 'ended', issued: 'info', paid: 'good', void: 'ended' }[i[2]]);
}
// A side-panel form: its own edits, kept under s[key] until it is closed.
function pform(s, up, key, BASE) {
  var cur = Object.assign({}, BASE, s[key] || {});
  var set = function (k, v) { var n = Object.assign({}, s[key] || {}); n[k] = v; var p = {}; p[key] = n; up(p); };
  var f = { cur: cur, set: set };
  Object.keys(BASE).forEach(function (k) {
    var v = cur[k];
    if (typeof v === 'boolean') f[k] = { on: v, aria: v ? 'true' : 'false', bg: v ? 'var(--primary)' : 'var(--input)', x: v ? '14px' : '0px', toggle: function () { set(k, !v); } };
    else f[k] = { value: String(v), on: function (e) { set(k, e.target.value); }, empty: String(v).trim() === '' };
  });
  return f;
}
