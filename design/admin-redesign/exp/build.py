import re, json
P='canvas/project/'
def rep(s,a,b,n=1):
    assert s.count(a)==n,(a[:70],s.count(a)); return s.replace(a,b)
def grab(path, name):
    t=open(path,encoding='utf-8').read(); i=t.index(name+"='''")+len(name)+4; return t[i:t.index("'''",i)]
SEARCH='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; opacity: .5"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>'
CHEV='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; opacity: .5"><path d="m7 15 5 5 5-5"></path><path d="m7 9 5-5 5 5"></path></svg>'
CHECK='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; opacity: {{o.check}}; color: var(--foreground)"><path d="M20 6 9 17l-5-5"></path></svg>'
def pop(p):
    return ('<sc-if value="{{%s.open}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close list" onClick="{{closeCombo}}" style="z-index: 35; background: transparent"></button><div class="mm-pop" role="dialog" aria-label="{{%s.title}}" onKeyDown="{{comboEsc}}"><div class="mm-popsearch">%s<input class="mm-cmd-input" aria-label="{{%s.ph}}" placeholder="{{%s.ph}}" autoComplete="off" autoFocus="{{true}}" value="{{%s.query}}" onChange="{{%s.onQuery}}"></div><div role="listbox" aria-label="{{%s.title}}" class="mm-poplist" style="max-height: 280px"><sc-for list="{{%s.items}}" as="o" hint-placeholder-count="7"><button type="button" role="option" aria-selected="{{o.aria}}" class="mm-cmd-item" onClick="{{o.pick}}"><sc-if value="{{o.hasColor}}" hint-placeholder-val="{{true}}"><span class="mm-sw" aria-hidden="true" style="background: {{o.color}}"></span></sc-if><span style="flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px"><span class="mm-trunc">{{o.label}}</span><sc-if value="{{o.hasSub}}" hint-placeholder-val="{{false}}"><span class="mm-trunc" lang="bn" style="font-size: 12px; color: var(--muted-foreground)">{{o.sub}}</span></sc-if></span>%s</button></sc-for><sc-if value="{{%s.none}}" hint-placeholder-val="{{false}}"><p class="mm-popempty">{{%s.empty}}</p></sc-if></div></div></sc-if>') % (p,p,SEARCH,p,p,p,p,p,p,CHECK,p,p)
script=open('exp/script.js',encoding='utf-8').read()

col=open(P+'Collections.dc.html',encoding='utf-8').read()
head=col[:col.index('<main class="mm-scroll"')]
i=head.index('<li><a href="#" class="mm-nav" aria-expanded="true">'); j=head.index('</ul></li>',i)+len('</ul></li>')
blk=head[i:j].replace('<li><a href="#" class="mm-nav" aria-expanded="true">','<li><a href="Main.dc.html" class="mm-nav">').replace(' style="transform: rotate(90deg)"','')
blk=blk[:blk.index('<ul class="mm-sub">')]+'</li>'
head=head[:i]+blk+head[j:]
head=re.sub(r'<li><a href="#" class="mm-nav">(<svg(?:(?!</a>).)*?</svg>)Customers</a></li>',r'<li><a href="Customers.dc.html" class="mm-nav">\1Customers</a></li>',head)
head=re.sub(r'<li><a href="#" class="mm-nav">(<svg(?:(?!</a>).)*?</svg>)Promotions</a></li>',r'<li><a href="Promotions.dc.html" class="mm-nav">\1Promotions</a></li>',head)
head,n=re.subn(r'<li><a href="(?:#|Expenses.dc.html)" class="mm-nav">(<svg(?:(?!</a>).)*?</svg>)Expenses</a></li>',r'<li><a href="Expenses.dc.html" class="mm-nav" aria-current="page">\1Expenses</a></li>',head)
assert n==1
i=head.index('<ol style="list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 6px; color: var(--muted-foreground); white-space: nowrap">'); i=head.index('>',i)+1; j=head.index('</ol>',i)
head=head[:i]+'\n<li aria-current="page" style="color: var(--foreground)">Expenses</li>\n'+head[j:]
head=head.replace('<title>Collections — managemind admin</title>','<title>Expenses — managemind admin</title>')
ECSS='''.mm-egrid{display:grid;grid-template-columns:64px minmax(0,1.1fr) minmax(0,1.6fr) 72px 64px 104px 40px;align-items:center;column-gap:12px}
.mm-rgrid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1.1fr) 150px 72px 104px 40px;align-items:center;column-gap:12px}
.mm-sw{display:inline-block;flex:none;width:8px;height:8px;border-radius:2px}
.mm-stack{display:flex;gap:2px;height:12px;overflow:hidden;border-radius:4px}
.mm-seg{display:block;min-width:2px;height:100%;cursor:pointer;transition:opacity .15s}
.mm-seg:hover{filter:brightness(1.08)}
.mm-tip{position:absolute;right:0;bottom:calc(100% + 6px);padding:4px 8px;border-radius:6px;background:var(--primary);color:var(--primary-foreground);font-size:12px;font-weight:500;white-space:nowrap;pointer-events:none}
.mm-legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 24px;margin:0;padding:0;list-style:none}
.mm-lgbtn{display:flex;align-items:center;gap:8px;width:100%;min-height:30px;padding:0 6px;box-sizing:border-box;border:0;border-radius:6px;background:transparent;color:var(--foreground);font:inherit;text-align:left;cursor:pointer;transition:opacity .15s}
.mm-lgbtn:hover,.mm-lgbtn[aria-pressed=true]{background:var(--accent)}
.mm-note{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:10px;background:var(--muted)}
.mm-note>svg{flex:none;margin-top:2px;color:var(--muted-foreground)}
.mm-needed{margin-left:6px;padding:0 4px;border-radius:4px;background:color-mix(in oklch,var(--warn) 16%,transparent);color:var(--warn);font-size:11px;font-weight:500;line-height:16px}
.mm-panel{position:absolute;top:0;right:0;bottom:0;display:flex;flex-direction:column;width:440px;max-width:90%;border-left:1px solid var(--border);background:var(--background);color:var(--foreground);box-shadow:0 10px 15px -3px rgb(0 0 0 / .1),0 4px 6px -4px rgb(0 0 0 / .1)}
.mm-phead{flex:none;display:flex;flex-direction:column;gap:6px;padding:16px 48px 16px 16px}
.mm-pbody{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:20px;padding:4px 16px 16px}
.mm-pfoot{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--border)}
.mm-dropbtn{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;box-sizing:border-box;border:1px dashed var(--input);border-radius:10px;background:transparent;color:var(--muted-foreground);font:inherit;text-align:left;cursor:pointer}
.mm-dropbtn:hover{background:var(--accent)}
.mm-filerow{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--border);border-radius:10px}
.mm-rthumb{display:inline-flex;flex:none;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:var(--muted);color:var(--muted-foreground)}
.mm-paygrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.mm-paybtn{height:36px;padding:0 8px;border:1px solid var(--input);border-radius:8px;background:var(--background);color:var(--foreground);font:inherit;font-size:14px;font-weight:500;cursor:pointer}
.mm-paybtn[aria-checked=true]{border-color:var(--primary);background:var(--primary);color:var(--primary-foreground)}
'''
DCSS=grab('promo/build.py','DCSS').replace('</style>','')+ECSS+'</style>'
i=head.rindex('</style>'); dhead=head[:i]+DCSS+head[i+len('</style>'):]
props={"startOn":{"editor":"enum","options":["Expenses","Filtered by category","Record expense","Edit expense","Category list","Delete expense","Previous month","Recurring","New recurring","Edit recurring","Categories","Edit category","Add category","Row actions"],"default":"Expenses"},"dark":{"editor":"boolean","default":False},"font":{"editor":"enum","options":["Inter","Geist"],"default":"Inter"},"$preview":{"width":1440,"height":900}}
forms=open('exp/forms-desktop.html',encoding='utf-8').read().replace('@@CHEV@@',CHEV)
for k in ['ef.cat','rf.cat','rf.day']: forms=rep(forms,'@@POP:'+k+'@@',pop(k))
fe,fr=forms.split('@@SPLIT@@')
body=open('exp/desktop.html',encoding='utf-8').read()
body=rep(body,'@@EXPFORM@@',fe); body=rep(body,'@@RECFORM@@',fr)
open(P+'Expenses.dc.html','w',encoding='utf-8').write(dhead+body+"\n<script type=\"text/x-dc\" data-dc-script data-props='"+json.dumps(props,ensure_ascii=False,separators=(',',':'))+"'>\nvar ROOT = 'mm mm-root';\n"+script+"</script>\n</body>\n</html>\n")

cp=open(P+'CategoriesPhone.dc.html',encoding='utf-8').read()
ph=cp[:cp.index('</style>')].replace('<title>Categories — phone</title>','<title>Expenses — phone</title>')
PCSS=grab('cust/build.py','PCSS').replace('</style>\n</helmet>\n','')
PX=grab('promo/build.py','PX').replace('</style>\n</helmet>\n','')
PE=ECSS.replace('.mm-paybtn{height:36px;','.mm-paybtn{height:40px;').replace('.mm-legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))','.mm-legend{display:grid;grid-template-columns:minmax(0,1fr)').replace('min-height:30px','min-height:34px')+'.mm-prow{position:relative}\n</style>\n</helmet>\n'
pbody=open('exp/phone.html',encoding='utf-8').read().replace('@@CHEV@@',CHEV)
props['$preview']={"width":390,"height":844}
open(P+'ExpensesPhone.dc.html','w',encoding='utf-8').write(ph+PCSS+PX+PE+pbody+"\n<script type=\"text/x-dc\" data-dc-script data-props='"+json.dumps(props,ensure_ascii=False,separators=(',',':'))+"'>\nvar ROOT = 'mm';\n"+script+"</script>\n</body>\n</html>\n")
print('built')
