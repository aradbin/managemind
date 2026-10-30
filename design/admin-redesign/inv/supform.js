// Shared with the supplier page: add or edit one, in a panel.
function supplierForm(s, up, sups, onSave, onArchive) {
  var form = s.form || null;
  var editing = form && form !== 'new' ? sups.filter(function (x) { return x.id === form; })[0] : null;
  var f = s.f && s.fFor === form ? s.f : (editing
    ? { name: editing.name, contact: editing.contact, phones: editing.phones.join(', '), email: editing.email, address: editing.address, note: editing.note, opening: editing.opening ? String(editing.opening) : '' }
    : { name: '', contact: '', phones: '', email: '', address: '', note: '', opening: '' });
  var setF = function (k) { return function (e) { var n = Object.assign({}, f); n[k] = e.target.value; up({ f: n, fFor: form }); }; };
  var ob = f.opening.trim() ? num(f.opening) : 0;
  var nameErr = Boolean(s.tried) && !f.name.trim();
  var obErr = ob === null;
  return {
    open: Boolean(form), isEdit: Boolean(editing), canArchive: Boolean(editing && !editing.archived),
    title: editing ? 'Edit supplier' : 'New supplier', saveText: editing ? 'Save' : 'Add supplier',
    sub: editing ? editing.name : 'Who you buy from. Add their opening balance if you already owe them.',
    name: f.name, contact: f.contact, phones: f.phones, email: f.email, address: f.address, note: f.note, opening: f.opening,
    onName: setF('name'), onContact: setF('contact'), onPhones: setF('phones'), onEmail: setF('email'), onAddress: setF('address'), onNote: setF('note'), onOpening: setF('opening'),
    nameErr: nameErr, nameErrAria: nameErr ? 'true' : 'false', obErr: obErr, obErrAria: obErr ? 'true' : 'false',
    save: function () {
      if (!f.name.trim() || obErr) { up({ tried: true }); return; }
      var data = { name: f.name.trim(), contact: f.contact.trim(), phones: f.phones.split(',').map(function (p) { return p.trim(); }).filter(Boolean), email: f.email.trim(), address: f.address.trim(), note: f.note.trim(), opening: ob || 0 };
      onSave(data, editing);
    },
    archive: function () { if (editing && onArchive) onArchive(editing); }
  };
}

