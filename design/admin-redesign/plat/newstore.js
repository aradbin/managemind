var START = { 'Step 1: store': {}, 'Address taken': { ns: { name: 'Nakshi Fashion', slug: 'nakshi' } }, 'Missing fields': { tried: true },
  'Step 2: owner': { step: 1, ns: { name: 'Sonar Bangla Sweets', slug: 'sonarbangla' } }, 'Step 3: plan': { step: 2, ns: { name: 'Sonar Bangla Sweets', slug: 'sonarbangla', email: 'mitu@sonarbanglasweets.com', owner: 'Mitu Akter' } },
  'Step 4: look': { step: 3, ns: { name: 'Sonar Bangla Sweets', slug: 'sonarbangla', email: 'mitu@sonarbanglasweets.com', owner: 'Mitu Akter', plan: 'starter' } } };
var NSTEPS = ['Store', 'Owner', 'Plan', 'Look'];
var PRESETS = [['fashion', 'Fashion', 'A large banner and collections first'], ['grocery', 'Grocery', 'Categories and offers first'], ['general', 'General', 'A bit of everything']];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Step 1: store');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    vals.readOnly = false;
    var step = s.step || 0;
    var f = pform(s, up, 'ns', { name: '', slug: '', lang: 'bn', kind: 'client', email: '', owner: '', plan: '', price: '', fee: '', day: '28', trial: '', preset: 'fashion' });
    vals.f = f; var c = f.cur;
    var slug = c.slug.trim().toLowerCase(), taken = STORES.some(function (t) { return t[2] === slug; }), slugOk = /^[a-z0-9-]{3,32}$/.test(slug);
    vals.slugNote = !slug ? '' : !slugOk ? '3–32 lowercase letters, numbers or hyphens.' : taken ? 'That address is already taken.' : slug + '.managemind.app is free.';
    vals.slugFree = Boolean(slug) && slugOk && !taken; vals.slugBad = Boolean(slug) && (!slugOk || taken);
    vals.slugHasNote = Boolean(slug);
    var tried = Boolean(s.tried);
    vals.nameBad = tried && !c.name.trim(); vals.slugMissing = tried && !slug;
    vals.emailBad = tried && step === 1 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim()); vals.ownerBad = tried && step === 1 && !c.owner.trim();
    vals.langs = choice(f, 'lang', [['bn', 'Bangla'], ['en', 'English']]);
    vals.kinds = choice(f, 'kind', [['client', 'Client'], ['demo', 'Demo'], ['test', 'Test']]);
    vals.plans = choice(f, 'plan', [['', 'No plan yet', 'Everything is allowed until one is set.']].concat(PLANS.map(function (p) { return [p[0], p[1], p[2] ? money(p[2]) + ' a month · setup ' + money(p[3]) : 'Free, not offered to new stores']; })));
    var pp = planOf(c.plan); vals.hasPlan = Boolean(pp);
    vals.priceHint = pp ? 'Leave empty for the plan’s price, ' + money(pp[2]) + '.' : ''; vals.feeHint = pp ? 'Leave empty for the plan’s fee, ' + money(pp[3]) + '. Billed on the first invoice.' : '';
    vals.presets = choice(f, 'preset', PRESETS);
    vals.steps = NSTEPS.map(function (n, i) { return { label: n, n: String(i + 1), s: i < step ? 'done' : i === step ? 'now' : 'todo', cur: i === step ? 'step' : 'false' }; });
    vals.stepOf = 'Step ' + (step + 1) + ' of 4: ' + NSTEPS[step];
    vals.is0 = step === 0; vals.is1 = step === 1; vals.is2 = step === 2; vals.is3 = step === 3;
    vals.hasBack = step > 0; vals.notLast = step < 3; vals.isLast = step === 3;
    var ok = [function () { return c.name.trim() && slugOk && !taken; }, function () { return c.owner.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim()); }, function () { return true; }, function () { return true; }][step];
    vals.next = function () { if (!ok()) { up({ tried: true }); return; } up({ step: step + 1, tried: false }); };
    vals.back = function () { up({ step: step - 1, tried: false }); };
    vals.create = function () { up({ done: true, toast: toast(c.name.trim() + ' was created. ' + c.email.trim() + ' has an email with how to sign in.') }); };
    vals.done = Boolean(s.done); vals.notDone = !s.done;
    vals.doneTitle = c.name.trim() + ' is ready'; vals.doneText = c.email.trim() + ' has an email with the admin’s address and how to sign in.';
    vals.storeHref = P('PlatformStore'); vals.again = function () { up({ done: false, step: 0, ns: null }); };
    vals.summary = [['Store', c.name.trim() || '—'], ['Address', slug ? slug + '.managemind.app' : '—'], ['Owner', c.owner.trim() ? c.owner.trim() + ' · ' + c.email.trim() : '—'], ['Plan', pp ? pp[1] : 'No plan yet']].map(function (r) { return { k: r[0], v: r[1] }; });
    vals.closeAll = function () {}; vals.escClose = function () {};
    return vals;
  }
}
