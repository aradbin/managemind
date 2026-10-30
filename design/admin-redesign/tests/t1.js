let v=V(); v.ed.lines[0].inc(); v=V(); console.log(v.ed.totalText, v.ed.wasText, v.ed.dropped, v.ed.refund);
v.ed.save(); v=V(); console.log('bad', v.ed.reasonBad); v.ed.onReason(ev('One more panjabi')); V().ed.save(); v=V();
console.log(v.ed.open, v.toastText, v.totals.map(t=>t.label+' '+t.value).join(' | '));
v.openPay(); v=V(); console.log(v.pf.amount); v.pf.save(); v=V(); console.log(v.toastText, v.od.pay.label, v.od.due, v.payments.length);
v.openBook(); v=V(); console.log(v.bk.open, v.bk.cod); v.bk.save(); v=V(); console.log(v.toastText, v.shipments[0].chip.label, v.od.del.label);
v.shipments[0].markShipped(); v=V(); v.shipments[0].delivered(); v=V(); console.log(v.dv.open, v.dv.codText); v.dv.save(); v=V(); console.log(v.toastText, v.od.status.label, v.od.pay.label, v.canReturn);
v.startReturn(); v=V(); console.log(v.returns.map(r=>r.ref+r.chip.label)); console.log(v.timeline.slice(0,4).map(e=>e.text));
v.onNote(ev('Called to thank')); V().addNote(); v=V(); console.log(v.timeline.filter(e=>e.isNote).length);
