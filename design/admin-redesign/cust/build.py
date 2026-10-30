import re, json
P='canvas/project/'
def rep(s,a,b,n=1):
    assert s.count(a)==n,(a[:60],s.count(a)); return s.replace(a,b)
SEARCH='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; opacity: .5"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>'
CHEV='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; opacity: .5"><path d="m7 15 5 5 5-5"></path><path d="m7 9 5-5 5 5"></path></svg>'
CHECK='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity: {{o.check}}; color: var(--foreground)"><path d="M20 6 9 17l-5-5"></path></svg>'
def combo(k):
    return f'<div class="mm-field"><span class="mm-label" id="mm-l-{k}">{{{{ad.{k}.title}}}}</span><div style="position: relative"><button type="button" class="mm-combo" role="combobox" aria-haspopup="listbox" aria-expanded="{{{{ad.{k}.aria}}}}" aria-labelledby="mm-l-{k}" disabled="{{{{ad.{k}.disabled}}}}" onClick="{{{{ad.{k}.toggle}}}}"><span class="mm-trunc" style="color: {{{{ad.{k}.color}}}}">{{{{ad.{k}.display}}}}</span>{CHEV}</button><sc-if value="{{{{ad.{k}.open}}}}" hint-placeholder-val="{{{{false}}}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close list" onClick="{{{{closeCombo}}}}" style="z-index: 35; background: transparent"></button><div class="mm-pop" role="dialog" aria-label="{{{{ad.{k}.title}}}}" onKeyDown="{{{{comboEsc}}}}"><div class="mm-popsearch">{SEARCH}<input class="mm-cmd-input" aria-label="{{{{ad.{k}.ph}}}}" placeholder="{{{{ad.{k}.ph}}}}" autoComplete="off" autoFocus="{{{{true}}}}" value="{{{{ad.{k}.query}}}}" onChange="{{{{ad.{k}.onQuery}}}}"></div><div role="listbox" aria-label="{{{{ad.{k}.title}}}}" class="mm-poplist"><sc-for list="{{{{ad.{k}.items}}}}" as="o" hint-placeholder-count="5"><button type="button" role="option" aria-selected="{{{{o.aria}}}}" class="mm-cmd-item" onClick="{{{{o.pick}}}}"><span class="mm-trunc" style="flex: 1">{{{{o.label}}}}</span>{CHECK}</button></sc-for><sc-if value="{{{{ad.{k}.none}}}}" hint-placeholder-val="{{{{false}}}}"><p class="mm-popempty">{{{{ad.{k}.empty}}}}</p></sc-if></div></div></sc-if></div></div>'
def pcombo(k):
    return f'<div class="mm-field"><span class="mm-label" id="mm-l-{k}">{{{{ad.{k}.title}}}}</span><button type="button" class="mm-combo" role="combobox" aria-haspopup="dialog" aria-expanded="{{{{ad.{k}.aria}}}}" aria-labelledby="mm-l-{k}" disabled="{{{{ad.{k}.disabled}}}}" onClick="{{{{ad.{k}.toggle}}}}"><span class="mm-trunc" style="color: {{{{ad.{k}.color}}}}">{{{{ad.{k}.display}}}}</span>{CHEV}</button></div>'

shared=open('cust/shared.js',encoding='utf-8').read()
shared=rep(shared,"conflictText: 'A customer with this phone already exists:',","conflictText: 'A customer with this phone already exists: ',")
listjs=open('cust/list.js',encoding='utf-8').read()
detjs=open('cust/detail.js',encoding='utf-8').read()
fdesk=open('cust/form-desktop.html',encoding='utf-8').read()
fdesk=rep(fdesk,'{{f.conflictText}} <a','{{f.conflictText}}<a')
fphone=open('cust/form-phone.html',encoding='utf-8').read()

# Desktop head, from Collections, with Customers current.
col=open(P+'Collections.dc.html',encoding='utf-8').read()
head=col[:col.index('<main class="mm-scroll"')]
i=head.index('<li><a href="#" class="mm-nav" aria-expanded="true">'); j=head.index('</ul></li>',i)+len('</ul></li>')
blk=head[i:j]
blk=blk.replace('<li><a href="#" class="mm-nav" aria-expanded="true">','<li><a href="Main.dc.html" class="mm-nav">').replace(' style="transform: rotate(90deg)"','')
blk=blk[:blk.index('<ul class="mm-sub">')]+'</li>'
head=head[:i]+blk+head[j:]
head,n=re.subn(r'<li><a href="(?:#|Customers.dc.html)" class="mm-nav">(<svg(?:(?!</a>).)*?</svg>)Customers</a></li>',r'<li><a href="Customers.dc.html" class="mm-nav" aria-current="page">\1Customers</a></li>',head)
assert n==1,n
i=head.index('<ol style="list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 6px; color: var(--muted-foreground); white-space: nowrap">'); i=head.index('>',i)+1; j=head.index('</ol>',i)
CRUMB_CHEV='<li aria-hidden="true" style="display: flex"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg></li>'
head_list=head[:i]+'\n<li aria-current="page" style="color: var(--foreground)">Customers</li>\n'+head[j:]
head_det=head[:i]+'\n<li><a href="Customers.dc.html">Customers</a></li>'+CRUMB_CHEV+'<li aria-current="page" style="overflow: hidden; text-overflow: ellipsis; color: var(--foreground)">{{c.name}}</li>\n'+head[j:]
DCSS='''.mm-nav[aria-current=page]{background:var(--sidebar-accent);color:var(--sidebar-accent-foreground);font-weight:500}
.mm-cgrid{display:grid;grid-template-columns:minmax(0,1.5fr) 124px 60px 104px 92px minmax(0,1fr) 40px;align-items:center;column-gap:12px}
.mm-av{display:inline-flex;flex:none;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9999px;background:var(--muted);color:var(--foreground);font-size:12px;font-weight:600}
.mm-tagchip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border:0;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font:inherit;font-size:12px;font-weight:500;white-space:nowrap;cursor:pointer}
.mm-tagchip:hover{background:color-mix(in oklch,var(--secondary-foreground) 10%,var(--secondary))}
.mm-tagchip[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground)}
.mm-row[data-current=true]{background:var(--muted)}
.mm-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.mm-badge-sec{display:inline-flex;align-items:center;padding:2px 4px;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font-size:12px;font-weight:400;line-height:16px;white-space:nowrap}
.mm-dialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:calc(100% - 32px);max-width:512px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;padding:24px;border:1px solid var(--border);border-radius:10px;background:var(--background);color:var(--foreground);box-shadow:0 10px 15px -3px rgb(0 0 0 / .1),0 4px 6px -4px rgb(0 0 0 / .1)}
.mm-radio-row{display:flex;align-items:center;gap:12px;cursor:pointer}
.mm-radio-row .mm-radio{margin-top:0;padding:0;background:var(--background);cursor:pointer}
.mm-radio[aria-checked=true]{border-color:var(--primary)}
.mm-chipbox{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:36px;padding:4px 6px;box-sizing:border-box;border:1px solid var(--input);border-radius:8px;box-shadow:0 1px 2px 0 rgb(0 0 0 / .05)}
.mm-chipbox input{flex:1;min-width:120px;height:26px;padding:0 4px;border:0;outline:none;background:transparent;color:var(--foreground);font:inherit;font-size:14px}
.mm-chipbox input::placeholder{color:var(--muted-foreground)}
.mm .mm-chipbox input:focus-visible{box-shadow:none}
.mm-chip{display:inline-flex;align-items:center;gap:2px;height:24px;padding:0 2px 0 8px;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font-size:12px;font-weight:500}
.mm-chip button{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;opacity:.6;cursor:pointer}
.mm-err{color:var(--destructive) !important}
.mm-alert{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:10px}
.mm-alert>svg{flex:none;margin-top:2px}
.mm-alert-bad{color:var(--destructive);border-color:color-mix(in oklch,var(--destructive) 30%,transparent);background:color-mix(in oklch,var(--destructive) 5%,transparent)}
.mm-sbadge{display:inline-flex;flex:none;align-items:center;height:22px;padding:0 8px;border-radius:8px;font-size:12px;font-weight:500;white-space:nowrap}
.mm-sbad{background:color-mix(in oklch,var(--destructive) 12%,transparent);color:var(--destructive)}
.mm-panel{position:absolute;top:0;right:0;bottom:0;display:flex;flex-direction:column;width:440px;max-width:90%;border-left:1px solid var(--border);background:var(--background);color:var(--foreground);box-shadow:0 10px 15px -3px rgb(0 0 0 / .1),0 4px 6px -4px rgb(0 0 0 / .1)}
.mm-phead{flex:none;display:flex;flex-direction:column;gap:6px;padding:16px 48px 16px 16px}
.mm-pbody{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:20px;padding:4px 16px 16px}
.mm-pfoot{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--border)}
.mm-statrow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;border:1px solid var(--border);border-radius:14px;background:var(--card);overflow:hidden}
.mm-statrow>div{display:flex;flex-direction:column;gap:6px;padding:16px 20px}
.mm-statrow>div+div{border-left:1px solid var(--border)}
.mm-statrow dt{font-size:12px;font-weight:500;color:var(--muted-foreground)}
.mm-statrow dd{margin:0;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-0.01em;font-variant-numeric:tabular-nums}
.mm-cols{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px;align-items:start}
.mm-orow{display:grid;grid-template-columns:72px 64px minmax(0,1fr) auto;align-items:center;column-gap:12px;min-height:52px;padding:8px 20px;border-bottom:1px solid var(--border)}
li:last-child>.mm-orow{border-bottom:0}
.mm-orow:hover{background:color-mix(in oklch,var(--muted) 50%,transparent)}
.mm-dotlabel{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted-foreground);white-space:nowrap}
.mm-dotlabel>span{width:8px;height:8px;border-radius:9999px}
.mm-rbar{height:8px;overflow:hidden;border-radius:9999px;background:color-mix(in oklch,var(--destructive) 22%,transparent)}
.mm-rbar>span{display:block;height:100%;border-radius:9999px;background:var(--success)}
.mm-addr{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:10px}
.mm-switch{display:inline-flex;flex:none;align-items:center;width:32px;height:18px;padding:0 1px;box-sizing:border-box;border:0;border-radius:9999px;cursor:pointer;box-shadow:0 1px 2px 0 rgb(0 0 0 / .05);transition:background .15s}
.mm-switch:disabled{opacity:.5;cursor:not-allowed}
.mm-knob{display:block;width:16px;height:16px;border-radius:9999px;background:var(--background);transition:transform .15s}
.mm-swrow{display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer}
.mm-combo:disabled{opacity:.5;cursor:not-allowed}
@media (max-width:1100px){.mm-cols{grid-template-columns:minmax(0,1fr)}}
</style>'''
def finish(h, body, js, props, root):
    i=h.rindex('</style>'); h=h[:i]+DCSS+h[i+len('</style>'):]
    return h+body+"\n<script type=\"text/x-dc\" data-dc-script data-props='"+json.dumps(props,ensure_ascii=False,separators=(',',':'))+"'>\nvar ROOT = '"+root+"';\n"+shared+js+"</script>\n</body>\n</html>\n"
lprops={"startOn":{"editor":"enum","options":["List","Tag filter","Row menu","Add customer","Edit customer","Phone taken","Export","Delete customer","More"],"default":"List"},"dark":{"editor":"boolean","default":False},"font":{"editor":"enum","options":["Inter","Geist"],"default":"Inter"},"$preview":{"width":1440,"height":900}}
dprops={"startOn":{"editor":"enum","options":["Customer","Flagged customer","No orders yet","More menu","Edit customer","Add address","Edit address","Area list","Delete personal data"],"default":"Customer"},"dark":{"editor":"boolean","default":False},"font":{"editor":"enum","options":["Inter","Geist"],"default":"Inter"},"$preview":{"width":1440,"height":900}}
lb=open('cust/list-desktop.html',encoding='utf-8').read().replace('@@FORM@@',fdesk)
db=open('cust/detail-desktop.html',encoding='utf-8').read().replace('@@FORM@@',fdesk)
for k in ['div','dist','area']: db=rep(db,'@@COMBO:'+k+'@@',combo(k))
open(P+'Customers.dc.html','w',encoding='utf-8').write(finish(head_list.replace('<title>Collections — managemind admin</title>','<title>Customers — managemind admin</title>'),lb,listjs,lprops,'mm mm-root'))
open(P+'Customer.dc.html','w',encoding='utf-8').write(finish(head_det.replace('<title>Collections — managemind admin</title>','<title>Customer — managemind admin</title>'),db,detjs,dprops,'mm mm-root'))

# Phone head, from Categories phone.
cp=open(P+'CategoriesPhone.dc.html',encoding='utf-8').read()
ph=cp[:cp.index('</style>')]
PCSS='''.mm{--success:oklch(.723 .219 149.579);--page:oklch(.985 0 0)}
.mm.dark{--success:oklch(.792 .209 151.711);--page:oklch(.145 0 0)}
.mm-row{gap:12px;min-height:64px;padding:8px 4px 8px 12px}
.mm-av{display:inline-flex;flex:none;align-items:center;justify-content:center;width:40px;height:40px;border-radius:9999px;background:var(--muted);color:var(--foreground);font-size:13px;font-weight:600}
.mm-tagchip{display:inline-flex;align-items:center;height:24px;padding:0 8px;border:0;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font:inherit;font-size:13px;font-weight:500;white-space:nowrap;cursor:pointer}
.mm-tagchip[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground)}
.mm-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.mm-badge{display:inline-flex;flex:none;align-items:center;padding:1px 6px;border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:500;line-height:16px;color:var(--muted-foreground);white-space:nowrap}
.mm-sbadge{display:inline-flex;flex:none;align-items:center;height:22px;padding:0 8px;border-radius:8px;font-size:12px;font-weight:500;white-space:nowrap}
.mm-sbad{background:color-mix(in oklch,var(--destructive) 12%,transparent);color:var(--destructive)}
.mm-card{display:flex;flex-direction:column;gap:16px;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.mm-chead{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:20px}
.mm-ctitle{margin:0;font-size:16px;font-weight:600;line-height:20px}
.mm-statrow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:0;border:1px solid var(--border);border-radius:12px;background:var(--card);overflow:hidden}
.mm-statrow>div{display:flex;flex-direction:column;gap:4px;padding:12px 16px}
.mm-statrow>div:nth-child(even){border-left:1px solid var(--border)}
.mm-statrow>div:nth-child(n+3){border-top:1px solid var(--border)}
.mm-statrow dt{font-size:12px;font-weight:500;color:var(--muted-foreground)}
.mm-statrow dd{margin:0;font-size:18px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums}
.mm-orow{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:60px;padding:10px 16px;border-bottom:1px solid var(--border)}
li:last-child>.mm-orow{border-bottom:0}
.mm-num{text-align:right;font-variant-numeric:tabular-nums}
.mm-dotlabel{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted-foreground);white-space:nowrap}
.mm-dotlabel>span{width:8px;height:8px;border-radius:9999px}
.mm-rbar{height:8px;overflow:hidden;border-radius:9999px;background:color-mix(in oklch,var(--destructive) 22%,transparent)}
.mm-rbar>span{display:block;height:100%;border-radius:9999px;background:var(--success)}
.mm-addr{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:10px}
.mm-alert{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;font-size:13px;line-height:18px}
.mm-alert>svg{flex:none;margin-top:1px}
.mm-alert-bad{color:var(--destructive);border-color:color-mix(in oklch,var(--destructive) 30%,transparent);background:color-mix(in oklch,var(--destructive) 5%,transparent)}
.mm-err{color:var(--destructive) !important}
.mm-chipbox input{flex:1;min-width:100px;height:28px;padding:0 4px;border:0;outline:none;background:transparent;color:var(--foreground);font:inherit;font-size:16px}
.mm-chipbox input::placeholder{color:var(--muted-foreground)}
.mm .mm-chipbox input:focus-visible{box-shadow:none}
.mm-switch{display:inline-flex;flex:none;align-items:center;width:32px;height:18px;padding:0 1px;box-sizing:border-box;border:0;border-radius:9999px;cursor:pointer;box-shadow:0 1px 2px 0 rgb(0 0 0 / .05);transition:background .15s}
.mm-switch:disabled{opacity:.5;cursor:not-allowed}
.mm-knob{display:block;width:16px;height:16px;border-radius:9999px;background:var(--background);transition:transform .15s}
.mm-swrow{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:48px;cursor:pointer}
.mm-radio-row{display:flex;align-items:center;gap:12px;min-height:44px;cursor:pointer}
.mm-radio{display:inline-flex;flex:none;align-items:center;justify-content:center;width:18px;height:18px;padding:0;box-sizing:border-box;border:1px solid var(--input);border-radius:9999px;background:var(--background);cursor:pointer}
.mm-radio[aria-checked=true]{border-color:var(--primary)}
.mm-dot{width:8px;height:8px;border-radius:9999px;background:var(--primary)}
.mm-combo:disabled{opacity:.5;cursor:not-allowed}
.mm-alertbox{position:absolute;left:16px;right:16px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:16px;padding:24px;border:1px solid var(--border);border-radius:10px;background:var(--background);color:var(--foreground);box-shadow:0 10px 15px -3px rgb(0 0 0 / .1),0 4px 6px -4px rgb(0 0 0 / .1)}
.mm-toast{position:absolute;left:16px;right:16px;z-index:80;display:flex;align-items:center;gap:8px;padding:14px 16px;border:1px solid var(--border);border-radius:8px;background:var(--popover);color:var(--foreground);font-size:13px;line-height:20px;box-shadow:0 4px 12px rgb(0 0 0 / .1)}
</style>
</helmet>
'''
def pfinish(title, body, js, props):
    h=ph.replace('<title>Categories — phone</title>','<title>'+title+'</title>')
    return h+PCSS+body+"\n<script type=\"text/x-dc\" data-dc-script data-props='"+json.dumps(props,ensure_ascii=False,separators=(',',':'))+"'>\nvar ROOT = 'mm';\n"+shared+js+"</script>\n</body>\n</html>\n"
lprops['$preview']={"width":390,"height":844}; dprops['$preview']={"width":390,"height":844}
lpb=open('cust/list-phone.html',encoding='utf-8').read().replace('@@FORM@@',fphone)
dpb=open('cust/detail-phone.html',encoding='utf-8').read().replace('@@FORM@@',fphone)
for k in ['div','dist','area']: dpb=rep(dpb,'@@PCOMBO:'+k+'@@',pcombo(k))
open(P+'CustomersPhone.dc.html','w',encoding='utf-8').write(pfinish('Customers — phone',lpb,listjs,lprops))
open(P+'CustomerPhone.dc.html','w',encoding='utf-8').write(pfinish('Customer — phone',dpb,detjs,dprops))
print('built')
