var CUSTOMERS = [
  { id: 'c1', name: 'Rahim Ahmed', phone: '01712345678', email: 'rahim.ahmed@gmail.com', orders: 12, spent: 28450, last: '26 Oct', since: '4 Mar 2025', tags: ['vip', 'dhaka'], flagged: false, risky: false, failed: 1, note: 'Prefers delivery after 6 pm. On weekdays, send to the office address.' },
  { id: 'c2', name: 'Nusrat Jahan', phone: '01819224466', email: '', orders: 7, spent: 15890, last: '24 Oct', since: '12 Jan 2026', tags: ['eid'], flagged: false, risky: false, failed: 0, note: '' },
  { id: 'c3', name: 'Tanvir Hasan', phone: '01911778899', email: '', orders: 3, spent: 4200, last: '20 Oct', since: '2 Jul 2026', tags: [], flagged: false, risky: true, failed: 2, note: '' },
  { id: 'c4', name: 'Farzana Akter', phone: '01611305522', email: 'farzana.boutique@gmail.com', orders: 21, spent: 61200, last: '27 Oct', since: '18 Nov 2024', tags: ['vip', 'wholesale'], flagged: false, risky: false, failed: 0, note: '' },
  { id: 'c5', name: 'Sabbir Rahman', phone: '01552114477', email: '', orders: 1, spent: 1850, last: '22 Oct', since: '22 Oct 2026', tags: [], flagged: false, risky: false, failed: 0, note: '' },
  { id: 'c6', name: 'Mitu Das', phone: '01716993311', email: '', orders: 5, spent: 9900, last: '30 Sep', since: '9 Apr 2026', tags: ['ctg'], flagged: false, risky: false, failed: 0, note: '' },
  { id: 'c7', name: 'Arif Chowdhury', phone: '01313662200', email: 'arif.c@outlook.com', orders: 0, spent: 0, last: '', since: '', tags: [], flagged: false, risky: false, failed: 0, note: '' },
  { id: 'c8', name: 'Sharmin Sultana', phone: '01790445566', email: '', orders: 9, spent: 18750, last: '12 Oct', since: '3 Feb 2026', tags: ['eid', 'repeat'], flagged: false, risky: false, failed: 0, note: '' },
  { id: 'c9', name: 'Kamal Uddin', phone: '01987121212', email: '', orders: 2, spent: 3100, last: '18 Aug', since: '1 Aug 2026', tags: [], flagged: true, risky: true, failed: 0, note: 'Gave a wrong address twice.' },
  { id: 'c10', name: 'Joya Roy', phone: '01688454545', email: '', orders: 4, spent: 7600, last: '2 Oct', since: '20 May 2026', tags: ['ctg'], flagged: false, risky: false, failed: 0, note: '' },
  { id: 'c11', name: 'Imran Hossain', phone: '01722889900', email: '', orders: 6, spent: 12300, last: '18 Oct', since: '30 Mar 2026', tags: ['repeat'], flagged: false, risky: false, failed: 0, note: '' },
  { id: 'c12', name: 'Rupa Khatun', phone: '01855667788', email: '', orders: 1, spent: 950, last: '12 Sep', since: '12 Sep 2026', tags: [], flagged: false, risky: false, failed: 0, note: '' }
];
var FONTS = {
  Inter: "'Inter', 'Noto Sans Bengali', system-ui, sans-serif",
  Geist: "'Geist', 'Noto Sans Bengali', system-ui, sans-serif"
};
function copy(x) { return JSON.parse(JSON.stringify(x)); }
function money(n) { return '৳' + Math.round(n).toLocaleString('en-US'); }
function plural(x, one, many) { return x.toLocaleString('en-US') + ' ' + (x === 1 ? one : many); }
function phoneOk(p) {
  var d = String(p || '').replace(/[^0-9]/g, '');
  if (d.indexOf('880') === 0) d = d.slice(2);
  return /^01[3-9][0-9]{8}$/.test(d) ? d : null;
}
function fmtPhone(p) { return p ? p.slice(0, 5) + '-' + p.slice(5) : ''; }
function initials(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
function allTags(customers) {
  var out = {};
  customers.forEach(function (c) { c.tags.forEach(function (t) { out[t] = (out[t] || 0) + 1; }); });
  return Object.keys(out).sort().map(function (t) { return { label: t, count: out[t] }; });
}
function riskBadge(c) {
  if (c.risky) return { label: 'Risky' + (c.score !== null && c.score !== undefined ? ' · ' + c.score + '%' : ''), bg: 'color-mix(in oklch, var(--destructive) 12%, transparent)', fg: 'var(--destructive)' };
  if (c.score === null || c.score === undefined) return { label: 'New', bg: 'var(--muted)', fg: 'var(--muted-foreground)' };
  if (c.score >= 80) return { label: c.score + '%', bg: 'color-mix(in oklch, var(--success) 14%, transparent)', fg: 'var(--success)' };
  return { label: c.score + '%', bg: 'var(--muted)', fg: 'var(--foreground)' };
}

// The add / edit customer form, the same on the list and on one customer.
function customerForm(s, up, customers, onSave, onDelete) {
  var form = s.form || null;
  var editing = form && form.mode === 'edit' ? customers.filter(function (c) { return c.id === form.id; })[0] : null;
  var key = JSON.stringify(form);
  var d = s.fd && s.fdFor === key ? s.fd : (editing
    ? { phone: fmtPhone(editing.phone), name: editing.name, email: editing.email || '', tags: editing.tags.slice(), note: editing.note || '', tagInput: '', tried: false }
    : { phone: '', name: '', email: '', tags: [], note: '', tagInput: '', tried: false });
  var setF = function (patch) { up({ fd: Object.assign({}, d, patch), fdFor: key }); };
  var ph = phoneOk(d.phone);
  var other = ph ? customers.filter(function (c) { return c.phone === ph && (!editing || c.id !== editing.id); })[0] : null;
  var digits = d.phone.replace(/[^0-9]/g, '');
  var phoneErr = !ph && (d.tried || digits.length >= 11) ? (d.phone.trim() ? 'Enter a Bangladeshi mobile number, like 01712-345678.' : 'Enter their phone number.') : '';
  var nameErr = d.tried && !d.name.trim() ? 'Enter their name.' : '';
  var emailErr = d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()) && d.tried ? 'This doesn’t look like an email address.' : '';
  var addTag = function (t) {
    t = String(t || '').trim().toLowerCase().replace(/,/g, '');
    if (!t || d.tags.indexOf(t) !== -1) { setF({ tagInput: '' }); return; }
    setF({ tags: d.tags.concat([t]), tagInput: '' });
  };
  var known = allTags(customers).map(function (t) { return t.label; });
  var tq = d.tagInput.trim().toLowerCase();
  var sugg = known.filter(function (t) { return d.tags.indexOf(t) === -1 && (!tq || t.indexOf(tq) === 0); }).slice(0, 6);
  return {
    open: Boolean(form), isEdit: Boolean(editing),
    title: editing ? 'Edit customer' : 'Add customer',
    sub: editing ? 'Changes apply to new orders. Past orders keep what they were placed with.' : 'Customers are also added with their first order.',
    phone: d.phone, onPhone: function (e) { setF({ phone: e.target.value }); },
    phoneErr: phoneErr, hasPhoneErr: Boolean(phoneErr),
    conflict: Boolean(other), conflictText: 'A customer with this phone already exists:', conflictName: other ? other.name : '',
    name: d.name, onName: function (e) { setF({ name: e.target.value }); },
    nameErr: nameErr, hasNameErr: Boolean(nameErr),
    email: d.email, onEmail: function (e) { setF({ email: e.target.value }); },
    emailErr: emailErr, hasEmailErr: Boolean(emailErr),
    tags: d.tags.map(function (t) { return { label: t, removeAria: 'Remove tag ' + t, remove: function () { setF({ tags: d.tags.filter(function (x) { return x !== t; }) }); } }; }),
    tagInput: d.tagInput,
    onTagInput: function (e) {
      var v = e.target.value;
      if (v.indexOf(',') !== -1) addTag(v); else setF({ tagInput: v });
    },
    tagKey: function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addTag(d.tagInput); }
      else if (e.key === 'Backspace' && !d.tagInput && d.tags.length) setF({ tags: d.tags.slice(0, -1) });
    },
    sugg: sugg.map(function (t) { return { label: t, add: function () { addTag(t); } }; }), hasSugg: sugg.length > 0,
    note: d.note, onNote: function (e) { setF({ note: e.target.value }); },
    askDelete: function () { if (editing && onDelete) onDelete(editing); },
    saveText: editing ? 'Save' : 'Add customer',
    save: function () {
      if (!ph || !d.name.trim() || other || (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()))) { setF({ tried: true }); return; }
      var tags = d.tagInput.trim() ? d.tags.concat([d.tagInput.trim().toLowerCase()]) : d.tags;
      onSave({ phone: ph, name: d.name.trim(), email: d.email.trim(), tags: tags, note: d.note.trim() }, editing);
    }
  };
}
