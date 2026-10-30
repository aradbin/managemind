import re, json
P='canvas/project/'
def rep(s,a,b,n=1):
    assert s.count(a)==n,(a[:70],s.count(a)); return s.replace(a,b)
SEARCH='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; opacity: .5"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>'
CHEV='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; opacity: .5"><path d="m7 15 5 5 5-5"></path><path d="m7 9 5-5 5 5"></path></svg>'
CHECK='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; opacity: {{o.check}}; color: var(--foreground)"><path d="M20 6 9 17l-5-5"></path></svg>'
X12='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
PLUS='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>'
def pop(p):
    return ('<sc-if value="{{%s.open}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close list" onClick="{{closeCombo}}" style="z-index: 35; background: transparent"></button><div class="mm-pop" role="dialog" aria-label="{{%s.title}}" onKeyDown="{{comboEsc}}" style="min-width: 300px"><div class="mm-popsearch">%s<input class="mm-cmd-input" aria-label="{{%s.ph}}" placeholder="{{%s.ph}}" autoComplete="off" autoFocus="{{true}}" value="{{%s.query}}" onChange="{{%s.onQuery}}"></div><div role="listbox" aria-label="{{%s.title}}" aria-multiselectable="{{%s.multi}}" class="mm-poplist" style="max-height: 300px"><sc-for list="{{%s.items}}" as="o" hint-placeholder-count="6"><sc-if value="{{o.head}}" hint-placeholder-val="{{false}}"><div class="mm-gh" role="presentation">{{o.label}}</div></sc-if><sc-if value="{{o.isOpt}}" hint-placeholder-val="{{true}}"><button type="button" role="option" aria-selected="{{o.aria}}" class="mm-cmd-item" onClick="{{o.pick}}"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc">{{o.label}}</span><sc-if value="{{o.hasSub}}" hint-placeholder-val="{{false}}"><span class="mm-trunc" style="font-size: 12px; line-height: 16px; color: var(--muted-foreground)">{{o.sub}}</span></sc-if></span>%s</button></sc-if></sc-for><sc-if value="{{%s.none}}" hint-placeholder-val="{{false}}"><p class="mm-popempty">{{%s.empty}}</p></sc-if></div></div></sc-if>') % (p,p,SEARCH,p,p,p,p,p,p,p,CHECK,p,p)
def chipbox(p, combo, popover):
    return ('<div style="position: relative"><div class="mm-chipbox"><sc-for list="{{%s.chips}}" as="ch" hint-placeholder-count="1"><span class="mm-chip">{{ch.label}}<button type="button" aria-label="{{ch.removeAria}}" onClick="{{ch.remove}}">%s</button></span></sc-for><button type="button" class="mm-btn mm-ghost mm-addchip" aria-haspopup="%s" aria-expanded="{{%s.aria}}" onClick="{{%s.toggle}}">%sAdd</button></div>%s</div>') % (p,X12,'listbox' if popover else 'dialog',combo,combo,PLUS,pop(combo) if popover else '')

shared=open('promo/shared.js',encoding='utf-8').read()
listjs=open('promo/list.js',encoding='utf-8').read()
edjs=open('promo/editor.js',encoding='utf-8').read()

col=open(P+'Collections.dc.html',encoding='utf-8').read()
head=col[:col.index('<main class="mm-scroll"')]
i=head.index('<li><a href="#" class="mm-nav" aria-expanded="true">'); j=head.index('</ul></li>',i)+len('</ul></li>')
blk=head[i:j].replace('<li><a href="#" class="mm-nav" aria-expanded="true">','<li><a href="Main.dc.html" class="mm-nav">').replace(' style="transform: rotate(90deg)"','')
blk=blk[:blk.index('<ul class="mm-sub">')]+'</li>'
head=head[:i]+blk+head[j:]
head=re.sub(r'<li><a href="#" class="mm-nav">(<svg(?:(?!</a>).)*?</svg>)Customers</a></li>',r'<li><a href="Customers.dc.html" class="mm-nav">\1Customers</a></li>',head)
head,n=re.subn(r'<li><a href="#" class="mm-nav">(<svg(?:(?!</a>).)*?</svg>)Promotions</a></li>',r'<li><a href="Promotions.dc.html" class="mm-nav" aria-current="page">\1Promotions</a></li>',head)
assert n==1
i=head.index('<ol style="list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 6px; color: var(--muted-foreground); white-space: nowrap">'); i=head.index('>',i)+1; j=head.index('</ol>',i)
CRUMB_CHEV='<li aria-hidden="true" style="display: flex"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg></li>'
head_list=head[:i]+'\n<li aria-current="page" style="color: var(--foreground)">Promotions</li>\n'+head[j:]
head_ed=head[:i]+'\n<li><a href="Promotions.dc.html">Promotions</a></li>'+CRUMB_CHEV+'<li aria-current="page" style="overflow: hidden; text-overflow: ellipsis; color: var(--foreground)">{{hd.title}}</li>\n'+head[j:]
DCSS='''.mm{--warn:oklch(.666 .179 58.318)}
.mm.dark{--warn:oklch(.769 .188 70.08)}
.mm-nav[aria-current=page]{background:var(--sidebar-accent);color:var(--sidebar-accent-foreground);font-weight:500}
.mm-pgrid{display:grid;grid-template-columns:minmax(0,2fr) 96px 104px 60px 112px 116px 132px 40px;align-items:center;column-gap:12px}
.mm-tabcount{font-size:12px;font-weight:500;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.mm-codechip{display:inline-flex;flex:none;align-items:center;height:20px;padding:0 6px;border-radius:6px;background:var(--muted);color:var(--foreground);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:500;white-space:nowrap}
.mm-ubar{display:block;width:80px;height:4px;overflow:hidden;border-radius:9999px;background:var(--muted)}
.mm-ubar>span{display:block;height:100%;border-radius:9999px;background:var(--primary)}
.mm-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.mm-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em}
.mm-badge-sec{display:inline-flex;align-items:center;padding:2px 4px;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font-size:12px;font-weight:400;line-height:16px;white-space:nowrap}
.mm-fbox{display:inline-flex;flex:none;align-items:center;justify-content:center;width:16px;height:16px;padding:0;box-sizing:border-box;border:1px solid;border-radius:4px;color:var(--primary-foreground)}
.mm-cmd-item:disabled{opacity:.5;pointer-events:none}
.mm-sbadge{display:inline-flex;flex:none;align-items:center;height:22px;padding:0 8px;border-radius:8px;font-size:12px;font-weight:500;white-space:nowrap}
.mm-dialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:calc(100% - 32px);max-width:512px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;padding:24px;border:1px solid var(--border);border-radius:10px;background:var(--background);color:var(--foreground);box-shadow:0 10px 15px -3px rgb(0 0 0 / .1),0 4px 6px -4px rgb(0 0 0 / .1)}
.mm-alert{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:10px}
.mm-alert>svg{flex:none;margin-top:2px}
.mm-alert-bad{color:var(--destructive);border-color:color-mix(in oklch,var(--destructive) 30%,transparent);background:color-mix(in oklch,var(--destructive) 5%,transparent)}
.mm-err{color:var(--destructive) !important}
.mm-statrow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;border:1px solid var(--border);border-radius:14px;background:var(--card);overflow:hidden}
.mm-statrow>div{display:flex;flex-direction:column;gap:6px;padding:14px 18px}
.mm-statrow>div+div{border-left:1px solid var(--border)}
.mm-statrow dt{font-size:12px;font-weight:500;color:var(--muted-foreground)}
.mm-statrow dd{margin:0;font-size:18px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums}
.mm-sum{position:sticky;top:-20px;z-index:15;display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--muted);font-weight:500;box-shadow:0 1px 2px 0 rgb(0 0 0 / .05)}
.mm-sum>svg{flex:none;margin-top:2px;color:var(--muted-foreground)}
.mm-affix-r>span{left:auto;right:12px}
.mm-affix-r>.mm-input{padding-left:12px;padding-right:28px}
.mm-bx{display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px;align-items:start}
.mm-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}
.mm-checkrow{display:inline-flex;align-items:center;gap:8px;min-height:28px;cursor:pointer}
.mm-checkrow .mm-fbox{cursor:pointer}
.mm-switch{display:inline-flex;flex:none;align-items:center;width:32px;height:18px;padding:0 1px;box-sizing:border-box;border:0;border-radius:9999px;cursor:pointer;box-shadow:0 1px 2px 0 rgb(0 0 0 / .05);transition:background .15s}
.mm-knob{display:block;width:16px;height:16px;border-radius:9999px;background:var(--background);transition:transform .15s}
.mm-swrow{display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer}
.mm-more{display:flex;align-items:center;gap:6px;width:100%;margin:-4px 0;padding:6px 0;border:0;background:transparent;color:var(--muted-foreground);font:inherit;font-size:14px;font-weight:500;text-align:left;cursor:pointer}
.mm-more:hover{color:var(--foreground)}
.mm-more svg{transition:transform .2s}
.mm-more[aria-expanded=true] svg{transform:rotate(90deg)}
.mm-chipbox{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:36px;padding:4px 6px;box-sizing:border-box;border:1px solid var(--input);border-radius:8px;box-shadow:0 1px 2px 0 rgb(0 0 0 / .05)}
.mm-chip{display:inline-flex;align-items:center;gap:2px;height:24px;padding:0 2px 0 8px;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font-size:12px;font-weight:500}
.mm-chip button{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;opacity:.6;cursor:pointer}
.mm-addchip{height:26px;padding:0 8px;font-size:13px;color:var(--muted-foreground)}
.mm-gh{padding:8px 8px 4px;font-size:12px;font-weight:500;color:var(--muted-foreground)}
.mm-tagchip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border:0;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font:inherit;font-size:13px;font-weight:500;white-space:nowrap;cursor:pointer}
.mm-tagchip[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground)}
.mm-collapse{display:flex;align-items:flex-start;gap:12px;width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mm-collapse>svg{flex:none;margin-top:2px;color:var(--muted-foreground);transition:transform .2s}
.mm-collapse[aria-expanded=true]>svg{transform:rotate(180deg)}
.mm-tcgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start}
.mm-tcres{display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:10px;background:var(--muted)}
.mm-totals{display:flex;flex-direction:column;gap:4px;margin:0;padding-top:10px;border-top:1px solid var(--border)}
.mm-totals>div{display:flex;justify-content:space-between;gap:12px}
.mm-totals dt{color:var(--muted-foreground)}
.mm-totals dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.mm-totals .mm-total{margin-top:4px;padding-top:8px;border-top:1px solid var(--border);font-weight:600}
.mm-totals .mm-total dt{color:var(--foreground)}
.mm-stepper{display:inline-flex;flex:none;align-items:center;height:28px;border:1px solid var(--input);border-radius:8px;overflow:hidden}
.mm-stepper button{width:28px;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:16px;cursor:pointer}
.mm-stepper button:hover{background:var(--accent)}
.mm-stepper span{min-width:22px;text-align:center;font-variant-numeric:tabular-nums}
.mm-rcard:disabled{cursor:not-allowed}
.mm-rcard:disabled:not([aria-checked=true]){opacity:.5}
.mm-row{position:relative}
</style>'''
def finish(h, body, js, props, root, title):
    h=h.replace('<title>Collections — managemind admin</title>','<title>'+title+'</title>')
    i=h.rindex('</style>'); h=h[:i]+DCSS+h[i+len('</style>'):]
    return h+body+"\n<script type=\"text/x-dc\" data-dc-script data-props='"+json.dumps(props,ensure_ascii=False,separators=(',',':'))+"'>\nvar ROOT = '"+root+"';\n"+shared+js+"</script>\n</body>\n</html>\n"
lprops={"startOn":{"editor":"enum","options":["List","Live only","Type filter","Row menu","End now"],"default":"List"},"dark":{"editor":"boolean","default":False},"font":{"editor":"enum","options":["Inter","Geist"],"default":"Inter"},"$preview":{"width":1440,"height":900}}
eprops={"startOn":{"editor":"enum","options":["Code promotion","Automatic","Buy X get Y","New promotion","What it gives","Add a condition","Test cart","Generate codes","Status","Missing details"],"default":"Code promotion"},"dark":{"editor":"boolean","default":False},"font":{"editor":"enum","options":["Inter","Geist"],"default":"Inter"},"$preview":{"width":1440,"height":900}}
lb=open('promo/list-desktop.html',encoding='utf-8').read()
eb=open('promo/editor-desktop.html',encoding='utf-8').read()
eb=eb.replace('@@CHEV@@',CHEV)
for k in ['act','tc.product','tc.area']: eb=rep(eb,'@@POP:'+k+'@@',pop(k))
for k in ['target','buyItems','getItems']: eb=rep(eb,'@@SEL:'+k+'@@',chipbox(k,k+'.combo',True))
eb=rep(eb,'@@CSEL@@',chipbox('c','c.combo',True),3)
open(P+'Promotions.dc.html','w',encoding='utf-8').write(finish(head_list,lb,listjs,lprops,'mm mm-root','Promotions — managemind admin'))
open(P+'Promotion.dc.html','w',encoding='utf-8').write(finish(head_ed,eb,edjs,eprops,'mm mm-root','Promotion — managemind admin'))

cp=open(P+'CategoriesPhone.dc.html',encoding='utf-8').read()
ph=cp[:cp.index('</style>')]
cust=open('cust/build.py',encoding='utf-8').read()
PCSS=cust[cust.index("PCSS='''")+8:cust.index("'''",cust.index("PCSS='''")+8)]
PCSS=PCSS.replace('</style>\n</helmet>\n','')
PX='''.mm{--warn:oklch(.666 .179 58.318)}
.mm.dark{--warn:oklch(.769 .188 70.08)}
.mm-tabcount{font-size:12px;font-weight:500;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.mm-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em}
.mm-sum{position:sticky;top:-12px;z-index:15;display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--muted);font-weight:500;line-height:20px;box-shadow:0 1px 2px 0 rgb(0 0 0 / .05)}
.mm-sum>svg{flex:none;margin-top:2px;color:var(--muted-foreground)}
.mm-affix{position:relative;display:block;min-width:0}
.mm-affix>span{position:absolute;left:12px;top:10px;color:var(--muted-foreground);pointer-events:none}
.mm-affix>.mm-input{padding-left:28px}
.mm-affix-r>span{left:auto;right:12px}
.mm-affix-r>.mm-input{padding-left:12px;padding-right:28px}
.mm-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.mm-rcard{display:flex;align-items:flex-start;gap:12px;width:100%;padding:12px;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--foreground);font:inherit;text-align:left;cursor:pointer}
.mm-rcard[aria-checked=true]{border-color:var(--primary);background:color-mix(in oklch,var(--muted) 60%,transparent)}
.mm-rcard .mm-radio{margin-top:1px}
.mm-rcard:disabled{cursor:not-allowed}
.mm-rcard:disabled:not([aria-checked=true]){opacity:.5}
.mm-rule{display:flex;padding:12px;border:1px solid var(--border);border-radius:10px}
.mm-and{align-self:center;margin:-4px 0;padding:0 8px;border-radius:6px;background:var(--muted);color:var(--muted-foreground);font-size:12px;font-weight:600;line-height:20px;letter-spacing:.04em}
.mm-chipbox{min-height:40px}
.mm-gh{padding:12px 12px 4px;font-size:12px;font-weight:500;color:var(--muted-foreground)}
.mm-fbox{display:inline-flex;flex:none;align-items:center;justify-content:center;width:18px;height:18px;padding:0;box-sizing:border-box;border:1px solid;border-radius:4px;color:var(--primary-foreground)}
.mm-checkrow{display:flex;align-items:center;gap:12px;min-height:44px;font-size:15px;cursor:pointer}
.mm-checkrow .mm-fbox{cursor:pointer}
.mm-collapse{display:flex;align-items:flex-start;gap:12px;width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mm-collapse>svg{flex:none;margin-top:2px;color:var(--muted-foreground);transition:transform .2s}
.mm-collapse[aria-expanded=true]>svg{transform:rotate(180deg)}
.mm-tcres{display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:10px;background:var(--muted)}
.mm-totals{display:flex;flex-direction:column;gap:4px;margin:0;padding-top:10px;border-top:1px solid var(--border)}
.mm-totals>div{display:flex;justify-content:space-between;gap:12px}
.mm-totals dt{color:var(--muted-foreground)}
.mm-totals dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.mm-totals .mm-total{margin-top:4px;padding-top:8px;border-top:1px solid var(--border);font-weight:600}
.mm-totals .mm-total dt{color:var(--foreground)}
.mm-stepper{display:inline-flex;flex:none;align-items:center;height:32px;border:1px solid var(--input);border-radius:8px;overflow:hidden}
.mm-stepper button{width:32px;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:18px;cursor:pointer}
.mm-stepper span{min-width:24px;text-align:center;font-variant-numeric:tabular-nums}
.mm-plist{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:10px}
.mm-plist>li:last-child>div{border-bottom:0}
.mm-prow{display:flex;align-items:center;border-bottom:1px solid var(--border)}
.mm-rowlink{gap:2px}
.mm-statrow dd{font-size:16px}
</style>
</helmet>
'''
def pfinish(title, body, js, props):
    h=ph.replace('<title>Categories — phone</title>','<title>'+title+'</title>')
    return h+PCSS+PX+body+"\n<script type=\"text/x-dc\" data-dc-script data-props='"+json.dumps(props,ensure_ascii=False,separators=(',',':'))+"'>\nvar ROOT = 'mm';\n"+shared+js+"</script>\n</body>\n</html>\n"
lprops['$preview']={"width":390,"height":844}; eprops['$preview']={"width":390,"height":844}
lpb=open('promo/list-phone.html',encoding='utf-8').read()
epb=open('promo/editor-phone.html',encoding='utf-8').read().replace('@@CHEV@@',CHEV)
for k in ['target','buyItems','getItems']: epb=rep(epb,'@@PSEL:'+k+'@@',chipbox(k,k+'.combo',False))
epb=rep(epb,'@@PCSEL@@',chipbox('c','c.combo',False),3)
open(P+'PromotionsPhone.dc.html','w',encoding='utf-8').write(pfinish('Promotions — phone',lpb,listjs,lprops))
open(P+'PromotionPhone.dc.html','w',encoding='utf-8').write(pfinish('Promotion — phone',epb,edjs,eprops))
print('built')
