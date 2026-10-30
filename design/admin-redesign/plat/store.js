var START = { Store: { id: 't4' }, 'Suspend dialog': { id: 't4', dlg: 'suspend' }, 'Close dialog': { id: 't4', dlg: 'close' }, 'Support access': { id: 't4', panel: 'support' }, 'Change plan': { id: 't4', panel: 'plan' },
  'Hold reminders': { id: 't4', panel: 'hold' }, 'Suspended store': { id: 't6' }, 'Closed store': { id: 't8' }, 'Purge counted': { id: 't8', counted: true }, 'Purge confirm': { id: 't8', counted: true, dlg: 'purge' },
  'Demo store': { id: 't11' }, 'Reset dialog': { id: 't11', dlg: 'reset' }, 'Support role': { id: 't4', support: true } };
var DOMAINS = { t4: [['www.kumkumcrafts.com', true], ['kumkum.managemind.app', false]], t6: [['shaplagadgets.com', true], ['shapla.managemind.app', false]] };
var JOBS = [['export', 'succeeded', '2026-10-21T14:05', 'The link works until Nov 4, 2026.', true], ['reports_backfill', 'succeeded', '2026-09-02T03:10', '', false], ['export', 'failed', '2026-08-14T11:40', 'Stopped at attempt 3: the file store didn’t answer.', false]];
var JOB_KIND = { export: 'Export', purge: 'Purge', reset: 'Reset', reports_backfill: 'Report history' };
var JOB_ST = { pending: ['Waiting to start', 'ended'], running: ['Running', 'info'], succeeded: ['Done', 'good'], failed: ['Failed', 'bad'] };
var PURGE = [['Store rows', 48210], ['Files', 1322], ['Edge keys', 14], ['Staff accounts in no other store', 2], ['Custom domains not released', 0], ['Exports kept until their link expires', 1]];
var PURGE_TABLES = [['stock_movements', 21904], ['order_lines', 7840], ['orders', 3120], ['customers', 2410], ['events', 9822], ['variants', 512], ['products', 186], ['other tables', 2416]];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Store');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var t0 = tById(s.id || 't4'), t = t0.slice(); if (s.status) t[3] = s.status;
    var sup = !s.support, p = planOf(s.plan || t[5]);
    vals.readOnly = false;
    vals.name = t[1]; vals.tile = initials(t[1]); vals.chip = tChip(t[3]); vals.kind = KINDS[t[4]]; vals.planName = p[1];
    vals.sub = t[2] + '.managemind.app · Created ' + longDate(t[7]);
    // Lifecycle.
    var active = t[3] === 'active', suspended = t[3] === 'suspended', closed = t[3] === 'closed';
    vals.canSuspend = sup && active; vals.canReactivate = sup && suspended; vals.canClose = sup && (active || suspended); vals.canReopen = sup && closed;
    vals.isSuper = sup; vals.isSupport = !sup; vals.canPlan = sup && !closed;
    vals.menuOpen = Boolean(s.menu); vals.menuAria = 'More actions'; vals.toggleMenu = function () { up({ menu: !s.menu }); };
    vals.reactivate = function () { up({ status: 'active', toast: toast(t[1] + ' is active again.') }); };
    vals.reopen = function () { up({ status: 'active', counted: false, toast: toast(t[1] + ' is open again.') }); };
    vals.askSuspend = function () { up({ menu: null, dlg: 'suspend' }); }; vals.askClose = function () { up({ menu: null, dlg: 'close' }); };
    vals.openSupport = function () { up({ menu: null, panel: 'support' }); };
    vals.isSuspended = suspended; vals.isClosed = closed;
    vals.statusNote = suspended ? 'Suspended on Oct 2, 2026: ' + whyLabel(t[10]) + '. Shoppers see a maintenance page.' : closed ? 'Closed on Sep 20, 2026 because the client asked. It can be purged from Oct 20, 2026.' : '';
    // Setup checklist.
    var done = t[6] === null ? 0 : t[6], checked = t[6] !== null || Boolean(s.checked);
    if (s.checked && t[6] === null) done = 2;
    var order = ['terms', 'profile', 'logo', 'products', 'delivery', 'payments', 'legal', 'email', 'domain', 'sms'];
    vals.setup = { checked: checked, never: !checked, progress: done + ' of 10 done', pct: done * 10 + '%', ring: 'conic-gradient(var(--primary) ' + done * 10 + '%, var(--muted) 0)', checkedAt: s.checked ? 'Checked just now' : 'Checked Oct 29, 9:12 AM',
      refresh: function () { up({ checked: true, toast: toast('Checked. The list is up to date.') }); },
      items: CHECKLIST.map(function (c) { var d = order.indexOf(c[0]) < done; return { label: c[1], done: d, todo: !d, optional: Boolean(c[2]), state: d ? 'Done' : 'To do' }; }) };
    // Plan.
    var negotiated = t[0] === 't1', trial = t[0] === 't5', overdue = suspended;
    var stt = trial ? ['Free trial', 'info'] : overdue ? ['Payment overdue', 'bad'] : closed ? ['Cancelled', 'ended'] : ['Active', 'good'];
    vals.sub2 = { chip: tone(stt[0], stt[1]), has: t[5] !== 'pilot' || Boolean(s.plan), none: t[5] === 'pilot' && !s.plan,
      rows: [['Monthly price', negotiated ? '৳1,500 (negotiated)' : money(p[2])], ['Setup fee', money(p[3])], ['Billing day', String(Math.min(28, Number(t[7].slice(8))))], ['Free until', trial ? 'Nov 17, 2026' : '—']].map(function (r) { return { k: r[0], v: r[1] }; }),
      holding: Boolean(s.held), holdText: 'Reminders held until Nov 10, 2026: ' + (s.heldWhy || 'paying next week, agreed by phone') + '.', endHold: function () { up({ held: false, toast: toast('Reminders are back on.') }); },
      invoices: P('PlatformBilling') };
    vals.changePlan = function () { up({ panel: 'plan' }); }; vals.holdIt = function () { up({ panel: 'hold' }); };
    // Jobs.
    var jobs = (s.queued || []).concat(JOBS);
    vals.jobs = jobs.map(function (j) { var st = JOB_ST[j[1]]; return { kind: JOB_KIND[j[0]], chip: tone(st[0], st[1]), when: short(j[2].slice(0, 10)) + ', ' + clock(j[2].slice(11, 16)), note: j[3], hasNote: Boolean(j[3]), link: j[4], download: function () { up({ toast: toast('Downloading the export.') }); } }; });
    vals.hasJobs = jobs.length > 0;
    var queue = function (kind, msg) { up({ queued: [[kind, 'pending', '2026-10-29T15:20', '', false]].concat(s.queued || []), dlg: null, rs: null, toast: toast(msg) }); };
    vals.exportNow = function () { queue('export', 'Export queued. It runs in a few minutes, and the owners get an email with the link.'); };
    vals.rebuild = function () { queue('reports_backfill', 'Report rebuild queued. The summaries are filled from the store’s first day in a few minutes.'); };
    vals.canReset = sup && t[4] !== 'client' && (active || suspended); vals.askReset = function () { up({ dlg: 'reset' }); };
    vals.canJobs = sup && !closed;
    // Purge.
    vals.showPurge = closed;
    vals.purge = { counted: Boolean(s.counted), notCounted: !s.counted, canCount: sup && !s.counted,
      start: function () { up({ counted: true, toast: toast('Counted. Check the numbers before you purge.') }); },
      rows: PURGE.map(function (r) { return { k: r[0], v: count(r[1]) }; }), tables: PURGE_TABLES.map(function (r) { return { k: r[0], v: count(r[1]) }; }),
      open: Boolean(s.ptab), aria: s.ptab ? 'true' : 'false', toggle: function () { up({ ptab: !s.ptab }); }, ask: function () { up({ dlg: 'purge' }); }, canPurge: sup };
    // Details.
    var details = [['Status', T_ST[t[3]][0]], ['Kind', KINDS[t[4]]], ['Store address', t[2] + '.managemind.app'], ['Plan', p[1]], ['Main language', 'Bangla'], ['Created', longDate(t[7])], ['Members', String(t[9])]];
    if (suspended || closed) details.splice(1, 0, ['Why', whyLabel(t[10])]);
    if (closed) details.splice(2, 0, ['Closed', 'Sep 20, 2026'], ['Can be purged from', 'Oct 20, 2026']);
    vals.details = details.map(function (r) { return { k: r[0], v: r[1] }; });
    vals.owners = [{ name: t[8][0], email: t[8][1], tile: initials(t[8][0]) }];
    vals.domains = (DOMAINS[t[0]] || [[t[2] + '.managemind.app', true]]).map(function (d) { return { host: d[0], main: d[1] }; });
    // Forms.
    vals.lf = pform(s, up, 'lf', { why: 'overdue', reason: '', code: '', typed: '' });
    vals.whys = choice(vals.lf, 'why', WHY);
    var lf = vals.lf.cur;
    vals.suspendIt = function () { up({ dlg: null, lf: null, status: 'suspended', toast: toast(t[1] + ' is suspended.') }); };
    vals.closeIt = function () { if (lf.code.length !== 6) { up({ ltried: true }); return; } up({ dlg: null, lf: null, ltried: false, status: 'closed', toast: toast(t[1] + ' is closed.') }); };
    vals.codeBad = Boolean(s.ltried) && lf.code.length !== 6;
    vals.typedOk = lf.typed.trim() === t[2]; vals.typeHint = 'Type ' + t[2] + ' to confirm.';
    vals.purgeIt = function () { if (lf.typed.trim() !== t[2] || lf.code.length !== 6) { up({ ltried: true }); return; } up({ dlg: null, lf: null, ltried: false, queued: [['purge', 'pending', '2026-10-29T15:20', '', false]].concat(s.queued || []), toast: toast('Approved. The purge runs in a few minutes.') }); };
    vals.typedBad = Boolean(s.ltried) && lf.typed.trim() !== t[2];
    vals.resetIt = function () { if (lf.typed.trim() !== t[2]) { up({ ltried: true }); return; } queue('reset', 'Reset queued. It runs in a few minutes.'); };
    vals.dl = { suspend: s.dlg === 'suspend', close: s.dlg === 'close', purge: s.dlg === 'purge', reset: s.dlg === 'reset',
      suspendTitle: 'Suspend ' + t[1] + '?', closeTitle: 'Close ' + t[1] + '?', purgeTitle: 'Purge ' + t[1] + ' for good?', resetTitle: 'Reset ' + t[1] + '?' };
    // Support access.
    vals.sp = pform(s, up, 'sp', { role: 'viewer', minutes: '60', reason: '' });
    vals.spRoles = choice(vals.sp, 'role', [['viewer', 'Viewer', 'Can look, but can’t change anything or see customers.']].concat(sup ? [['manager', 'Manager', 'Everything except billing and owners.']] : []));
    vals.spMins = [15, 30, 60, 120, 240].map(function (m) { var on = vals.sp.cur.minutes === String(m); return { label: m < 60 ? m + ' minutes' : (m / 60) + (m === 60 ? ' hour' : ' hours'), on: on ? 'true' : 'false', aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { vals.sp.set('minutes', String(m)); } }; });
    vals.spBad = Boolean(s.sptried) && vals.sp.cur.reason.trim().length < 10;
    vals.startSupport = function () { if (vals.sp.cur.reason.trim().length < 10) { up({ sptried: true }); return; } up({ panel: null, sp: null, sptried: false, toast: toast('Support access started. Opening ' + t[1] + '…') }); };
    // Change plan.
    vals.pl = pform(s, up, 'pl', { plan: s.plan || t[5], price: '', fee: '', day: String(Math.min(28, Number(t[7].slice(8)))), trial: '' });
    vals.plans = choice(vals.pl, 'plan', PLANS.map(function (x) { return [x[0], x[1], x[2] ? money(x[2]) + ' a month · setup ' + money(x[3]) : 'Free, not offered to new stores']; }));
    var pp = planOf(vals.pl.cur.plan);
    vals.priceHint = 'Leave empty for the plan’s price, ' + money(pp[2]) + '.'; vals.feeHint = 'Leave empty for the plan’s fee, ' + money(pp[3]) + '. Billed on the first invoice.';
    vals.savePlan = function () { up({ panel: null, pl: null, plan: vals.pl.cur.plan, toast: toast('Plan saved.') }); };
    // Hold reminders.
    vals.hd = pform(s, up, 'hd', { until: '2026-11-10', why: '' });
    vals.hdBad = Boolean(s.hdtried) && !vals.hd.cur.why.trim();
    vals.saveHold = function () { if (!vals.hd.cur.why.trim()) { up({ hdtried: true }); return; } up({ panel: null, hd: null, hdtried: false, held: true, heldWhy: vals.hd.cur.why.trim(), toast: toast('Reminders held until Nov 10, 2026.') }); };
    vals.pn = { support: s.panel === 'support', plan: s.panel === 'plan', hold: s.panel === 'hold' };
    vals.closePop = function () { up({ menu: null }); };
    vals.closeAll = function () { up({ menu: null, panel: null, dlg: null, lf: null, sp: null, pl: null, hd: null, ltried: false, sptried: false, hdtried: false }); };
    vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); vals.closeAll(); } };
    return vals;
  }
}
