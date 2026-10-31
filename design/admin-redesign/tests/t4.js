let v=V(); console.log(v.tabs.map(t=>t.label+t.count).join(','), v.summary); v.cards[0].call(); v=V(); console.log(v.cl.title, v.cl.saveText);
v.cl.save(); v=V(); console.log(v.cl.bad, v.cl.badText); v.cl.outcomes[0].pick(); v=V(); v.cl.save(); v=V(); console.log(v.toastText, v.cl.title, v.cards.length);
v.cl.outcomes[2].pick(); v=V(); v.cl.whens[1].pick(); v=V(); v.cl.save(); v=V(); console.log(v.toastText, v.cl.title, v.tabs.map(t=>t.label+t.count).join(','));
v.cl.outcomes[1].pick(); v=V(); v.cl.save(); v=V(); console.log(v.toastText, v.cl.open, v.empty, v.emptyText);
