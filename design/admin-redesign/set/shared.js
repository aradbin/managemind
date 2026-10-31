// Settings: a form whose edits wait in s.f until saved, a save bar, and the pieces fields are made of.
function P(name) { return name + (ROOT === 'mm' ? 'Phone' : '') + '.dc.html'; }
function form(s, up, toast, BASE, savedText) {
  var base = Object.assign({}, BASE, s.saved || {}), edits = s.f || {};
  var cur = Object.assign({}, base, edits);
  var dirty = Object.keys(edits).some(function (k) { return JSON.stringify(edits[k]) !== JSON.stringify(base[k]); });
  var set = function (k, v) { var n = Object.assign({}, edits); n[k] = v; up({ f: n }); };
  var f = { cur: cur, base: base, dirty: dirty, set: set };
  Object.keys(base).forEach(function (k) {
    var v = cur[k];
    if (typeof v === 'boolean') f[k] = { on: v, off: !v, aria: v ? 'true' : 'false', bg: v ? 'var(--primary)' : 'var(--input)', x: v ? '14px' : '0px', toggle: function () { set(k, !v); } };
    else if (Array.isArray(v)) f[k] = { list: v };
    else f[k] = { value: String(v), on: function (e) { set(k, e.target.value); }, empty: String(v).trim() === '' };
  });
  f.bar = { show: dirty, label: 'Unsaved changes', cancel: 'Discard', save: 'Save' };
  f.discard = function () { up({ f: null, tried: false }); };
  f.save = function (check) {
    if (check && !check(cur)) { up({ tried: true }); return; }
    up({ saved: Object.assign({}, s.saved || {}, cur), f: null, tried: false, toast: toast(savedText || 'Saved.') });
  };
  return f;
}
// One choice of several: a radio list or segmented chips, bound to f.cur[k].
function choice(f, k, opts) {
  return opts.map(function (o) { var on = f.cur[k] === o[0]; return { label: o[1], sub: o[2] || '', hasSub: Boolean(o[2]), on: on, aria: on ? 'true' : 'false', pressed: on ? 'true' : 'false', pick: function () { f.set(k, o[0]); } }; });
}
// Several choices: chips that toggle membership of f.cur[k].
function many(f, k, opts) {
  var cur = f.cur[k] || [];
  return opts.map(function (o) { var on = cur.indexOf(o[0]) !== -1; return { label: o[1], on: on, pressed: on ? 'true' : 'false', aria: on ? 'true' : 'false', box: on ? 'var(--primary)' : 'transparent', edge: on ? 'var(--primary)' : 'var(--input)', toggle: function () { f.set(k, on ? cur.filter(function (x) { return x !== o[0]; }) : cur.concat([o[0]])); } }; });
}
function settingsVals(vals, s, up) {
  vals.closeAll = function () { up({ panel: null, dlg: null, menu: null }); };
  vals.closePop = function () { up({ menu: null }); };
  vals.escClose = function (e) { if (e.key === 'Escape') { e.preventDefault(); up({ panel: null, dlg: null, menu: null }); } };
  vals.readOnly = Boolean(s.viewer); vals.canEdit = !s.viewer;
}
