var START = { Delivery: {}, 'Edit zone': { panel: 'z1' }, 'New zone': { panel: 'new' }, 'Fee calculator': { calc: { district: 'Chattogram', area: 'Panchlaish', kg: '2.5' } }, 'Delete zone': { dlg: 'z3' } };
var ZONES_S = [
  { id: 'z1', bn: 'ঢাকার ভেতরে', en: 'Inside Dhaka', fee: 70, byWeight: true, freeKg: 1, perKg: 20, eta: '1–2 days', etaBn: '১–২ দিন', fallback: false, active: true, districts: ['Dhaka'], areas: [] },
  { id: 'z2', bn: 'চট্টগ্রাম শহর', en: 'Chattogram city', fee: 110, byWeight: true, freeKg: 1, perKg: 25, eta: '2–3 days', etaBn: '২–৩ দিন', fallback: false, active: true, districts: [], areas: ['Panchlaish', 'Kotwali', 'Halishahar', 'Agrabad', 'Khulshi'] },
  { id: 'z3', bn: 'ঢাকার আশেপাশে', en: 'Dhaka suburbs', fee: 100, byWeight: false, freeKg: 0, perKg: 0, eta: '2–3 days', etaBn: '২–৩ দিন', fallback: false, active: false, districts: ['Gazipur', 'Narayanganj'], areas: ['Savar', 'Keraniganj'] },
  { id: 'z4', bn: 'ঢাকার বাইরে', en: 'Outside Dhaka', fee: 130, byWeight: true, freeKg: 1, perKg: 30, eta: '3–5 days', etaBn: '৩–৫ দিন', fallback: true, active: true, districts: [], areas: [] }
];
var DISTRICTS = ['Dhaka', 'Chattogram', 'Gazipur', 'Narayanganj', 'Sylhet', 'Khulna', 'Rajshahi', 'Cumilla'];
function coverText(z) {
  if (z.fallback) return 'Everywhere else';
  var names = z.districts.concat(z.areas);
  return names.length > 3 ? names.slice(0, 3).join(', ') + ' and ' + (names.length - 3) + ' more' : names.join(', ');
}
function zoneFee(z, kg) { return z.fee + (z.byWeight && kg > z.freeKg ? Math.ceil(kg - z.freeKg) * z.perKg : 0); }
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Delivery');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    settingsVals(vals, s, up);
    var zones = s.zones || ZONES_S;
    vals.zones = zones.map(function (z) {
      return { name: z.en, fee: money(z.fee), weight: z.byWeight ? z.freeKg + ' kg included, then ' + money(z.perKg) + ' per kg' : 'Same fee at any weight', cover: coverText(z), eta: z.eta,
        fallback: z.fallback, off: !z.active, edit: function () { up({ panel: z.id, zf: null }); }, aria: 'Edit ' + z.en };
    });
    vals.noFallback = !zones.some(function (z) { return z.fallback && z.active; });
    vals.addZone = function () { up({ panel: 'new', zf: null }); };
    // The calculator.
    var c = s.calc || { district: 'Dhaka', area: 'Mirpur', kg: '1' };
    var setC = function (k, v) { var n = Object.assign({}, c); n[k] = v; up({ calc: n }); };
    var kg = num(c.kg) || 0;
    var hit = zones.filter(function (z) { return z.active && z.areas.indexOf(c.area) !== -1; })[0] || zones.filter(function (z) { return z.active && z.districts.indexOf(c.district) !== -1; })[0] || zones.filter(function (z) { return z.active && z.fallback; })[0];
    vals.calc = { district: c.district, onDistrict: function (e) { setC('district', e.target.value); }, area: c.area, onArea: function (e) { setC('area', e.target.value); }, kg: c.kg, onKg: function (e) { setC('kg', e.target.value); },
      result: hit ? hit.en + ': ' + money(zoneFee(hit, kg)) : 'No zone covers this area.', ok: Boolean(hit), why: hit ? (hit.areas.indexOf(c.area) !== -1 ? 'The area is listed in this zone.' : hit.fallback ? 'The fallback zone covers it.' : 'Its district is in this zone.') : '' };
    // The zone panel.
    var editing = zones.filter(function (z) { return z.id === s.panel; })[0];
    var blank = { id: 'z9', bn: '', en: '', fee: '', byWeight: false, freeKg: 1, perKg: 20, eta: '', etaBn: '', fallback: false, active: true, districts: [], areas: [] };
    var z = s.zf || Object.assign({}, editing || blank);
    var setZ = function (k, v) { var n = Object.assign({}, z); n[k] = v; up({ zf: n }); };
    var flag = function (k) { var v = z[k]; return { on: v, aria: v ? 'true' : 'false', bg: v ? 'var(--primary)' : 'var(--input)', x: v ? '14px' : '0px', toggle: function () { setZ(k, !v); } }; };
    var bad = Boolean(s.ztried) && (!String(z.en).trim() || !(num(z.fee) >= 0) || (!z.fallback && !z.districts.length && !z.areas.length));
    vals.zn = { open: Boolean(s.panel), title: editing ? 'Edit ' + editing.en : 'Add zone', isEdit: Boolean(editing),
      en: z.en, onEn: function (e) { setZ('en', e.target.value); }, bn: z.bn, onBn: function (e) { setZ('bn', e.target.value); }, fee: String(z.fee), onFee: function (e) { setZ('fee', e.target.value); },
      byWeight: flag('byWeight'), weightOn: z.byWeight, freeKg: String(z.freeKg), onFreeKg: function (e) { setZ('freeKg', e.target.value); }, perKg: String(z.perKg), onPerKg: function (e) { setZ('perKg', e.target.value); },
      eta: z.eta, onEta: function (e) { setZ('eta', e.target.value); }, etaBn: z.etaBn, onEtaBn: function (e) { setZ('etaBn', e.target.value); },
      fallback: flag('fallback'), notFallback: !z.fallback, fallbackTaken: z.fallback && zones.some(function (x) { return x.fallback && x.id !== z.id; }), active: flag('active'),
      districtsTitle: 'Whole districts (' + z.districts.length + ')', areasTitle: 'Single areas (' + z.areas.length + ')',
      districts: DISTRICTS.map(function (d) { var on = z.districts.indexOf(d) !== -1; return { label: d, pressed: on ? 'true' : 'false', toggle: function () { setZ('districts', on ? z.districts.filter(function (x) { return x !== d; }) : z.districts.concat([d])); } }; }),
      areas: z.areas.map(function (a) { return { label: a, aria: 'Remove ' + a, remove: function () { setZ('areas', z.areas.filter(function (x) { return x !== a; })); } }; }),
      areaQ: s.aq || '', onAreaQ: function (e) { up({ aq: e.target.value }); }, areaKey: function (e) { if (e.key === 'Enter' && (s.aq || '').trim()) { e.preventDefault(); up({ aq: '', zf: Object.assign({}, z, { areas: z.areas.concat([(s.aq || '').trim()]) }) }); } },
      bad: bad, del: function () { up({ dlg: z.id }); },
      save: function () {
        if (!String(z.en).trim() || !(num(z.fee) >= 0) || (!z.fallback && !z.districts.length && !z.areas.length)) { up({ ztried: true }); return; }
        var nz = Object.assign({}, z, { fee: num(z.fee), freeKg: num(z.freeKg) || 0, perKg: num(z.perKg) || 0 });
        up({ panel: null, zf: null, ztried: false, zones: editing ? zones.map(function (x) { return x.id === z.id ? nz : x; }) : zones.concat([nz]), toast: toast('Saved.') });
      } };
    var dz = zones.filter(function (x) { return x.id === s.dlg; })[0];
    vals.dz = { open: Boolean(dz), title: dz ? 'Delete ' + dz.en + '?' : '', confirm: function () { up({ dlg: null, panel: null, zones: zones.filter(function (x) { return x !== dz; }), toast: toast('Zone deleted.') }); } };
    vals.closeAll = function () { up({ panel: null, dlg: null, zf: null, ztried: false }); };
    return vals;
  }
}
