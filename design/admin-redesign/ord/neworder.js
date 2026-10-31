var FILLED = { phone: '01712-345678', name: 'Rahim Ahmed', source: 'phone', lines: [['v1', 2, 1450], ['v14', 1, 150]], code: 'EID10', codeOn: true };
var START = {
  'New order': {}, 'Filled in': FILLED, 'Find a customer': { fc: true },
  'Add a product': Object.assign({}, FILLED, { ap: true }),
  'Risky phone': { phone: '01987-121212', name: 'Kamal Uddin', source: 'facebook', lines: [['v10', 1, 2400]] },
  'Possible duplicate': { phone: '01819-224466', name: 'Nusrat Jahan', lines: [['v7', 1, 1850]] },
  'Paid already': Object.assign({}, FILLED, { pay: 'paid', method: 'bkash', ref: 'TrxID 9K4M2Q7P' }),
  'Walk-in sale': { source: 'walk_in', noDel: true, lines: [['v14', 2, 150], ['v5', 1, 850]], pay: 'paid', method: 'cash' },
  'Missing details': { tried: true, phone: '0171', lines: [] }
};
var OFFERS = { EID10: ['Eid offer: 10% off Panjabi', function (v) { return v.cat === 'Panjabi' ? 0.1 : 0; }], SAREE270: ['Saree week: ৳270 off', null] };
var SRC = ['website', 'facebook', 'phone', 'walk_in', 'other'];
var CUSTOMERS = (function () { var seen = {}, out = []; ORDERS.forEach(function (o) { if (!seen[o.phone]) { seen[o.phone] = 1; out.push({ phone: o.phone, name: o.name, line: o.line, area: o.area, district: o.district }); } }); return out; })();
function digits(p) { return String(p || '').replace(/\D/g, ''); }
function zoneFor(district) { return district === 'Dhaka' ? 'dhaka' : district === 'Chattogram' ? 'ctg' : 'outside'; }
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'New order');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var set = function (k, v) { var p = {}; p[k] = v; up(p); };
    var on = function (k) { return function (e) { set(k, e.target.value); }; };
    var phone = s.phone || '', pd = digits(phone);
    var known = CUSTOMERS.filter(function (c) { return c.phone === pd; })[0];
    var walkIn = (s.source || 'website') === 'walk_in';
    var noDel = walkIn || Boolean(s.noDel);
    var lines = s.lines || [];
    var tried = Boolean(s.tried);

    // Customer.
    var fq = (s.fq || '').trim().toLowerCase();
    var fitems = CUSTOMERS.filter(function (c) { return !fq || c.name.toLowerCase().indexOf(fq) !== -1 || c.phone.indexOf(digits(fq)) !== -1 && digits(fq); }).map(function (c) {
      var mine = pd === c.phone;
      return { label: c.name, sub: fmtPhone(c.phone) + ' · ' + c.area, hasSub: true, check: mine ? '1' : '0', aria: mine ? 'true' : 'false', pick: function () { up({ fc: false, fq: '', phone: fmtPhone(c.phone), name: c.name, addr: 'saved' }); } };
    });
    vals.fc = { open: Boolean(s.fc), title: 'Find a customer', ph: 'Name or phone', query: s.fq || '', onQuery: function (e) { up({ fq: e.target.value }); }, items: fitems, none: fitems.length === 0,
      aria: s.fc ? 'true' : 'false', toggle: function () { up({ fc: !s.fc, fq: '' }); }, display: known ? known.name + ' · ' + fmtPhone(known.phone) : 'Search by name or phone', color: known ? 'var(--foreground)' : 'var(--muted-foreground)', disabled: false };
    var phoneBad = tried && !/^01\d{9}$/.test(pd), nameBad = tried && !(s.name || '').trim();
    vals.cu = {
      phone: phone, onPhone: on('phone'), phoneBad: phoneBad, phoneAria: phoneBad ? 'true' : 'false',
      name: s.name || '', onName: on('name'), nameBad: nameBad, nameAria: nameBad ? 'true' : 'false',
      email: s.email || '', onEmail: on('email'),
      sources: SRC.map(function (k) { var x = (s.source || 'website') === k; return { label: SOURCE[k], on: x ? 'true' : 'false', pick: function () { up({ source: k, noDel: k === 'walk_in' ? true : s.noDel, pay: k === 'walk_in' ? 'paid' : s.pay, method: k === 'walk_in' ? 'cash' : s.method }); } }; })
    };
    var rec = RECORD[pd];
    var blocked = pd === '01987121212';
    vals.isBlocked = blocked;
    vals.blockText = 'This phone is on your block list: 2 parcels were refused at the door. You can still save the order. It’s flagged risky.';
    vals.hasRecord = Boolean(rec) && !blocked && !walkIn;
    vals.record = riskChip(rec ? Math.round(rec[1] / rec[0] * 100) : null, rec && rec[1] / rec[0] < 0.5);
    vals.recordText = rec ? plural(rec[0], 'parcel', 'parcels') + ' with all couriers · ' + rec[1] + ' delivered' : '';
    var dups = ORDERS.filter(function (o) { return o.phone === pd && o.status === 'pending' && o.placed.slice(0, 10) === TODAY; });
    vals.isDup = dups.length > 0;
    vals.dupText = dups.length ? (s.name || known.name).split(' ')[0] + ' already has ' + (dups.length === 1 ? 'a pending order' : dups.length + ' pending orders') + ' from today (' + dups.map(function (o) { return '#' + o.n; }).join(', ') + '). Make sure this isn’t the same one.' : '';
    vals.knownText = known ? 'Returning customer · ' + plural(ORDERS.filter(function (o) { return o.phone === pd; }).length, 'order', 'orders') : '';
    vals.isKnown = Boolean(known);

    // Items.
    var apq = (s.apq || '').trim().toLowerCase();
    var apItems = VARIANTS.filter(function (v) { return !apq || label(v).toLowerCase().indexOf(apq) !== -1 || v.sku.toLowerCase().indexOf(apq) !== -1; }).map(function (v) {
      var inIt = lines.some(function (l) { return l[0] === v.id; }), av = available(v);
      return { label: label(v), sub: money(PRICE[v.id]) + ' · ' + (!v.track ? 'Not tracked' : av > 0 ? av + ' available' : 'Out of stock'), hasSub: true, check: inIt ? '1' : '0', aria: inIt ? 'true' : 'false',
        pick: function () { up({ ap: false, apq: '', lines: inIt ? lines.map(function (l) { return l[0] === v.id ? [l[0], l[1] + 1, l[2]] : l; }) : lines.concat([[v.id, 1, PRICE[v.id]]]) }); } };
    });
    vals.ap = { open: Boolean(s.ap), title: 'Add a product', ph: 'Search products or scan', query: s.apq || '', onQuery: function (e) { up({ apq: e.target.value }); }, items: apItems, none: apItems.length === 0 };
    vals.comboOpen = Boolean(s.ap || s.fc); vals.cbd = s.fc ? vals.fc : vals.ap;
    vals.closeCombo = function () { up({ ap: false, fc: false, apq: '', fq: '' }); };
    vals.comboEsc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); up({ ap: false, fc: false }); } };
    vals.addProduct = function () { up({ ap: !s.ap, apq: '', fc: false }); };
    vals.apAria = s.ap ? 'true' : 'false';
    vals.lines = lines.map(function (l, i) {
      var v = vById(l[0]), av = available(v), short_ = v.track && l[1] > av;
      var setQ = function (q) { up({ lines: lines.map(function (x, j) { return j === i ? [x[0], q, x[2]] : x; }) }); };
      return { title: v.t, opts: v.o || v.sku, price: money(l[2]) + ' each', total: money(l[1] * l[2]), qty: String(l[1]), qtyAria: 'Quantity of ' + label(v),
        avail: !v.track ? 'Not tracked' : short_ ? 'Only ' + av + ' available' : av + ' available', availColor: short_ ? 'var(--destructive)' : 'var(--muted-foreground)',
        dec: function () { if (l[1] > 1) setQ(l[1] - 1); }, inc: function () { setQ(l[1] + 1); }, decDis: l[1] <= 1, onQty: function (e) { var n = parseInt(e.target.value, 10); if (n > 0) setQ(n); },
        removeAria: 'Remove ' + label(v), remove: function () { up({ lines: lines.filter(function (x, j) { return j !== i; }) }); } };
    });
    vals.hasLines = lines.length > 0; vals.noLines = lines.length === 0;
    vals.linesBad = tried && lines.length === 0;
    var sub = lines.reduce(function (a, l) { return a + l[1] * l[2]; }, 0);

    // Delivery.
    vals.showDel = !walkIn;
    vals.noDel = checkOf(noDel, function () { up({ noDel: !noDel }); });
    vals.delOn = !noDel;
    var addrMode = known && s.addr !== 'new' ? 'saved' : 'new';
    vals.hasSaved = Boolean(known);
    vals.addrs = known ? [{ label: [known.line, known.area, known.district].join(', '), hasSub: true, sub: 'Used on the last order', on: addrMode === 'saved', aria: addrMode === 'saved' ? 'true' : 'false', pick: function () { up({ addr: 'saved' }); } },
      { label: 'A new address', hasSub: false, sub: '', on: addrMode === 'new', aria: addrMode === 'new' ? 'true' : 'false', pick: function () { up({ addr: 'new' }); } }] : [];
    vals.newAddr = addrMode === 'new';
    var district = addrMode === 'saved' ? known.district : (s.district || 'Dhaka');
    var areaBad = tried && !noDel && addrMode === 'new' && !(s.area || '').trim();
    vals.ad = { district: s.district || 'Dhaka', onDistrict: on('district'), area: s.area || '', onArea: on('area'), areaBad: areaBad, areaAria: areaBad ? 'true' : 'false', street: s.street || '', onStreet: on('street') };
    var autoZone = zoneFor(district), zone = s.zone || autoZone;
    var zrow = ZONES.filter(function (z) { return z[0] === zone; })[0];
    var fee = noDel || !lines.length ? 0 : zrow[2];
    vals.zones = ZONES.map(function (z) { var x = z[0] === zone; return { label: z[1] + ' · ' + money(z[2]), on: x ? 'true' : 'false', pick: function () { up({ zone: z[0] === autoZone ? null : z[0] }); } }; });
    vals.zoneHint = s.zone ? 'You picked this. The area says ' + ZONES.filter(function (z) { return z[0] === autoZone; })[0][1] + '.' : 'By the area: ' + district + '.';

    // Discounts.
    var offer = s.codeOn ? OFFERS[(s.code || '').toUpperCase()] : null;
    var offerOff = offer ? (offer[1] ? Math.round(lines.reduce(function (a, l) { return a + l[1] * l[2] * offer[1](vById(l[0])); }, 0)) : 270) : 0;
    vals.code = s.code || ''; vals.onCode = function (e) { up({ code: e.target.value, codeOn: false, codeBad: false }); };
    vals.applyCode = function () { if (OFFERS[(s.code || '').trim().toUpperCase()]) up({ codeOn: true, codeBad: false, code: (s.code || '').trim().toUpperCase() }); else up({ codeBad: true }); };
    vals.codeBad = Boolean(s.codeBad); vals.codeAria = s.codeBad ? 'true' : 'false';
    vals.hasOffer = Boolean(offer); vals.noOffer = !offer;
    vals.offerText = offer ? offer[0] : ''; vals.offerOff = '−' + money(offerOff);
    vals.removeCode = function () { up({ codeOn: false, code: '' }); };
    var mk = s.mk || 'none', mv = num(s.mv) || 0;
    vals.mkinds = [['none', 'None'], ['amount', 'Amount'], ['pct', 'Percentage']].map(function (k) { return { label: k[1], on: mk === k[0] ? 'true' : 'false', pick: function () { up({ mk: k[0] }); } }; });
    vals.hasManual = mk !== 'none';
    vals.mv = s.mv || ''; vals.onMv = on('mv'); vals.mvAffix = mk === 'pct' ? '%' : '৳'; vals.mvIsPct = mk === 'pct'; vals.mvIsAmt = mk === 'amount';
    vals.mr = s.mr || ''; vals.onMr = on('mr');
    var manualOff = mk === 'amount' ? mv : mk === 'pct' ? Math.round((sub - offerOff) * Math.min(mv, 100) / 100) : 0;
    var mrBad = tried && manualOff > 0 && !(s.mr || '').trim();
    vals.mrBad = mrBad; vals.mrAria = mrBad ? 'true' : 'false';

    // Payment.
    var total = Math.max(0, sub - offerOff - manualOff) + fee;
    var pay = walkIn ? 'paid' : s.pay || 'cod';
    vals.showPayMode = !walkIn;
    vals.paymodes = [['cod', 'Cash on delivery', 'The courier collects it'], ['paid', 'Paid already', 'bKash, bank or cash before it ships']].map(function (m) { var x = pay === m[0]; return { label: m[1], hasSub: true, sub: m[2], on: x, aria: x ? 'true' : 'false', pick: function () { up({ pay: m[0] }); } }; });
    vals.isPaid = pay === 'paid';
    var method = s.method || 'bkash';
    vals.methods = ['cash', 'bkash', 'nagad', 'bank', 'other'].map(function (m) { return { label: METHOD[m], on: method === m ? 'true' : 'false', pick: function () { up({ method: m }); } }; });
    var paidAmt = pay === 'paid' ? (s.amount === undefined || s.amount === '' ? total : num(s.amount) || 0) : 0;
    vals.amount = s.amount === undefined ? '' : s.amount; vals.amountPh = String(total); vals.onAmount = on('amount');
    vals.amountHint = paidAmt < total ? money(total - paidAmt) + ' is collected on delivery.' : 'Paid in full.';
    vals.ref = s.ref || ''; vals.onRef = on('ref');
    vals.note = s.note || ''; vals.onNote = on('note');

    // Summary.
    var rows = [['Subtotal', money(sub)]];
    if (offerOff) rows.push([offer[0], '−' + money(offerOff)]);
    if (manualOff) rows.push(['Discount' + ((s.mr || '').trim() ? ': ' + s.mr.trim() : ''), '−' + money(manualOff)]);
    if (!walkIn) rows.push([noDel ? 'No delivery' : 'Delivery (' + zrow[1] + ')', money(fee)]);
    vals.sum = rows.map(function (r) { return { label: r[0], value: r[1] }; });
    vals.total = money(total);
    vals.hasPaidRow = pay === 'paid' && !walkIn;
    vals.paidRow = '−' + money(paidAmt);
    vals.collect = walkIn ? money(paidAmt) : money(Math.max(0, total - paidAmt));
    vals.collectLabel = walkIn ? 'Paid in the shop' : 'To collect on delivery';
    vals.itemsText = lines.length ? plural(lines.reduce(function (a, l) { return a + l[1]; }, 0), 'item', 'items') : 'No items yet';
    vals.walkIn = walkIn; vals.notWalkIn = !walkIn;

    // Save.
    var problems = [];
    if (!/^01\d{9}$/.test(pd) && !walkIn) problems.push('a phone number');
    if (!(s.name || '').trim() && !walkIn) problems.push('a name');
    if (!lines.length) problems.push('at least one item');
    if (!noDel && addrMode === 'new' && !(s.area || '').trim()) problems.push('the area');
    if (manualOff > 0 && !(s.mr || '').trim()) problems.push('a reason for the discount');
    vals.showProblems = tried && problems.length > 0;
    vals.problemsText = 'Add ' + problems.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' to save.';
    var finish = function (confirm) {
      if (problems.length) { up({ tried: true }); return; }
      up(Object.assign({}, { phone: '', name: '', email: '', lines: [], code: '', codeOn: false, mk: 'none', mv: '', mr: '', note: '', amount: undefined, ref: '', tried: false, area: '', street: '', zone: null, addr: null },
        { toast: toast(walkIn ? 'Sale complete. Order #1059 is paid.' : 'Order #1059 is saved' + (confirm ? ' and confirmed.' : '. It’s waiting to be confirmed.')) }));
    };
    vals.saveConfirm = function () { finish(true); };
    vals.savePending = function () { finish(false); };
    vals.closePop = function () { up({ ap: false, fc: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ ap: false, fc: false }); } };
    return vals;
  }
}
