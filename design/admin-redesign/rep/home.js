var START = { Home: {}, 'All setup steps': { steps: true }, 'Setup done': { setupDone: true }, 'Last 7 days as a table': { asTable: true, setupDone: true }, 'New store': { fresh: true } };
var SETUP = [['terms', true, 'Settings'], ['profile', true, 'Settings'], ['logo', true, 'Settings'], ['products', true, 'Main'], ['delivery', true, 'Settings'], ['payments', true, 'Settings'], ['legal', true, 'OnlineStore'], ['email', false, 'Settings'], ['sms', false, 'Settings', true], ['domain', false, 'Settings', true]];
var SETUP_LABEL = { profile: 'Business name, address and phone', logo: 'Logo', products: 'A product on sale with stock', delivery: 'Delivery charges checked', payments: 'A way to pay: cash on delivery or SSLCommerz', legal: 'Terms, privacy, returns and delivery pages published', email: 'Email to customers working', sms: 'SMS gateway', domain: 'Web address chosen', terms: 'Platform terms accepted' };
var WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Home');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var fresh = Boolean(s.fresh);
    var page = function (n) { return n + (ROOT === 'mm' ? 'Phone' : '') + '.dc.html'; };
    vals.dateLine = WEEKDAY[new Date(TODAY + 'T12:00:00Z').getUTCDay()] + ', ' + Number(TODAY.slice(8)) + ' ' + MONTHS[Number(TODAY.slice(5, 7)) - 1];
    vals.greeting = 'Good afternoon';

    // Setup checklist and plan limits.
    var steps = SETUP.map(function (x, i) { return { item: x[0], done: fresh ? i < 2 : x[1], to: x[2], optional: Boolean(x[3]) }; });
    var done = steps.filter(function (x) { return x.done; }).length, next = steps.filter(function (x) { return !x.done; })[0];
    vals.showSetup = !s.setupDone && done < steps.length;
    vals.setup = {
      intro: done + ' of ' + steps.length + ' done. Your store can take orders once these are done.', ring: 'conic-gradient(var(--primary) ' + Math.round(done / steps.length * 100) + '%, var(--muted) 0)',
      next: next ? 'Next: ' + SETUP_LABEL[next.item] : '', nextHref: next ? page(next.to) : '#', open: Boolean(s.steps), aria: s.steps ? 'true' : 'false',
      toggle: function () { up({ steps: !s.steps }); }, pct: Math.round(done / steps.length * 100) + '%',
      items: steps.map(function (x) { return { label: SETUP_LABEL[x.item], done: x.done, todo: !x.done, optional: x.optional, href: page(x.to), state: x.done ? 'Done' : 'To do' }; }),
      keep: 'Keep nakshi.managemind.app as my address', keepIt: function () { up({ setupDone: true, toast: toast('Kept nakshi.managemind.app as your address.') }); }
    };
    vals.showUsage = !fresh && !s.setupDone;
    vals.usage = 'Orders this month: 482 of 500, near your plan’s limit.';

    // Figures.
    var today = fresh ? null : DAYS[DAYS.length - 1], yday = DAYS[DAYS.length - 2];
    var month = fresh ? { orders: 0, net: 0 } : sumDays('2026-10-01', TODAY);
    var vs = today ? Math.round((today.net - yday.net) / yday.net * 100) : 0;
    vals.figures = [
      { label: 'Today’s sales', value: money(today ? today.net : 0), note: today ? (vs >= 0 ? '+' : '−') + Math.abs(vs) + '% vs. yesterday' : 'No sales yet today', noteColor: today ? (vs >= 0 ? 'var(--success)' : 'var(--destructive)') : 'var(--muted-foreground)' },
      { label: 'Orders today', value: count(today ? today.orders : 0), note: today ? '5 still to confirm' : '', noteColor: 'var(--muted-foreground)' },
      { label: 'This month', value: money(month.net), note: 'Orders: ' + count(month.orders), noteColor: 'var(--muted-foreground)' },
      { label: 'Average order', value: month.orders ? money(Math.round(month.net / month.orders)) : '—', note: 'This month', noteColor: 'var(--muted-foreground)' }
    ];
    vals.figures.forEach(function (f) { f.hasNote = Boolean(f.note); });
    // Profit this month.
    var gp = Math.round(month.net * 0.445), ex = fresh ? 0 : 146730;
    vals.showProfit = !fresh;
    vals.profit = [{ label: 'Gross profit', value: money(gp), note: '8 units sold without a cost', hasNote: true }, { label: 'Expenses', value: money(ex), note: '', hasNote: false }, { label: 'Net profit', value: money(gp - ex), note: '', hasNote: false }];
    // The last 7 days.
    var week = fresh ? [] : DAYS.slice(-7);
    var max = Math.max.apply(null, week.map(function (d) { return d.net; }).concat([1]));
    var top = Math.ceil(max / 20000) * 20000;
    vals.week = {
      total: count(week.reduce(function (a, d) { return a + d.orders; }, 0)) + ' orders in the last 7 days', has: week.length > 0, none: week.length === 0,
      ticks: [0, 0.5, 1].map(function (f) { return { pos: f * 100 + '%', label: f ? '৳' + Math.round(top * f / 1000) + 'K' : '৳0' }; }),
      bars: week.map(function (d) { var dn = WEEKDAY[new Date(d.d + 'T12:00:00Z').getUTCDay()]; return { h: (d.net / top * 100).toFixed(1) + '%', tip: dn.slice(0, 3) + ' ' + short(d.d) + ': ' + money(d.net) + ' · ' + plural(d.orders, 'order', 'orders'), xl: d.d === TODAY ? 'Today' : dn.slice(0, 3) }; }),
      rows: week.slice().reverse().map(function (d) { return { day: d.d === TODAY ? 'Today' : WEEKDAY[new Date(d.d + 'T12:00:00Z').getUTCDay()] + ', ' + short(d.d), orders: count(d.orders), sales: money(d.net) }; }),
      asTable: Boolean(s.asTable), asChart: !s.asTable, toggleText: s.asTable ? 'Show as a chart' : 'Show as a table', toggle: function () { up({ asTable: !s.asTable }); }
    };
    // Waiting for you.
    var pend = ORDERS.filter(function (o) { return o.status === 'pending'; }).length;
    var ship = ORDERS.filter(function (o) { return (o.status === 'confirmed' || o.status === 'processing') && !o.shipments.length && o.source !== 'walk_in'; }).length;
    var low = VARIANTS.filter(isLow).length;
    var W = [['To call', 3, 'phone', 'warn', 'Confirm'], ['To confirm', pend, 'clock', 'warn', 'Orders'], ['To ship', ship, 'truck', 'info', 'Orders'], ['Incomplete checkouts', 3, 'cart', 'muted', 'Incomplete'],
      ['Possible duplicate', 1, 'copy', 'warn', 'Orders'], ['Parcels with the courier', 2, 'truck', 'move', 'Orders'], ['Parcels coming back', 3, 'undo', 'bad', 'CourierReturns'], ['Low stock', low, 'package', 'bad', 'Inventory'], ['Cancelled by customers (7 days)', 1, 'ban', 'muted', 'Orders']];
    var tone = { warn: ['color-mix(in oklch, var(--warn) 16%, transparent)', 'var(--warn)'], info: ['color-mix(in oklch, var(--info) 12%, transparent)', 'var(--info)'], move: ['color-mix(in oklch, var(--violet) 12%, transparent)', 'var(--violet)'], bad: ['color-mix(in oklch, var(--destructive) 10%, transparent)', 'var(--destructive)'], muted: ['var(--muted)', 'var(--foreground)'] };
    vals.waiting = fresh ? [] : W.filter(function (w) { return w[1] > 0; }).map(function (w) { return { label: w[0], count: count(w[1]), href: page(w[4]), bg: tone[w[3]][0], fg: tone[w[3]][1], icon: w[2], aria: w[0] + ': ' + w[1] }; });
    ['phone', 'clock', 'truck', 'cart', 'copy', 'undo', 'package', 'ban'].forEach(function (k) { vals.waiting.forEach(function (w) { w['is_' + k] = w.icon === k; }); });
    vals.hasWaiting = vals.waiting.length > 0; vals.allClear = !vals.hasWaiting;
    vals.waitNotes = fresh ? [] : [{ text: 'Incomplete checkouts today: 2, 1 became an order.' }, { text: 'Confirmed in the last 7 days: 86% (96 of 112).' }];
    // Recent orders.
    vals.recent = fresh ? [] : ORDERS.slice(0, 6).map(function (o) { return { n: '#' + o.n, name: o.name, sub: o.area || fmtPhone(o.phone), when: when(o.placed), total: money(totalsOf(o).total), chip: chip('order', o.status), href: page('Order'), aria: 'Open order #' + o.n }; });
    vals.hasRecent = vals.recent.length > 0; vals.noRecent = !vals.hasRecent;
    vals.closeAll = function () { up({ steps: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ steps: false }); } };
    return vals;
  }
}
