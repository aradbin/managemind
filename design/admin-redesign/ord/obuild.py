import os, sys, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'inv'))
from pages import *
import build as B

def oread(n): return open('ord/' + n, encoding='utf-8').read()

ICONS.update({
    'msg': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>',
    'flag': '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"></path>',
    'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
    'undo': '<path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"></path>',
    'merge': '<path d="m8 6 4-4 4 4"></path><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"></path><path d="m20 22-5-5"></path>',
    'clock': '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>',
    'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
    'pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle>',
    'cart': '<circle cx="8" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>',
    'box': '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path>',
    'tag': '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"></path><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"></circle>',
})

OSECTIONS = [('orders', 'All orders', 'Orders'), ('confirm', 'Confirm orders', 'Confirm'), ('incomplete', 'Incomplete orders', 'Incomplete'),
             ('creturns', 'Courier returns', 'CourierReturns'), ('returns', 'Returns', 'Returns')]

def osections(cur, phone=False):
    out = []
    for k, lab, f in OSECTIONS:
        out.append('<a href="%s%s.dc.html" class="mm-tab"%s>%s</a>' % (f, 'Phone' if phone else '', ' aria-current="page"' if k == cur else '', lab))
    if phone:
        return ('<nav aria-label="Order sections" style="margin: 0 -16px; padding: 0 16px; overflow-x: auto; scrollbar-width: none">\n'
                '<div class="mm-secbar">' + ''.join(out) + '</div>\n</nav>')
    return '<nav aria-label="Order sections" style="overflow-x: auto">\n<div class="mm-secbar">' + ''.join(out) + '</div>\n</nav>'

ORD_LI = re.search(r'<li><a href="(?:#|Orders.dc.html)" class="mm-nav">(<svg(?:(?!</svg>).)*</svg>)<span style="flex: 1">Orders</span>(<span class="mm-navbadge">.*?</span></span>)<svg(?:(?!</svg>).)*</svg></a></li>', B.dhead)
assert ORD_LI
def ord_group(cur):
    subs = ''.join('<li><a href="%s.dc.html" class="mm-subbtn"%s>%s</a></li>' % (f, ' aria-current="page"' if k == cur else '', lab) for k, lab, f in OSECTIONS)
    return ('<li><a href="Orders.dc.html" class="mm-nav" aria-expanded="true">' + ORD_LI.group(1) + '<span style="flex: 1">Orders</span>' + ORD_LI.group(2) + B.CHEV_DOWN + '</a>\n<ul class="mm-sub">\n' + subs + '\n</ul></li>')

OCSS = '''
.mm-skel{display:block;flex:none;max-width:100%;border-radius:6px;background:color-mix(in oklch,var(--foreground) 8%,transparent);animation:mm-pulse 1.6s ease-in-out infinite}
@keyframes mm-pulse{50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){.mm-skel{animation:none}}
.mm-bulk{grid-column:2/-1;display:flex;align-items:center;gap:2px;min-width:0;overflow-x:auto}
.mm-bulk .mm-btn{height:28px;padding:0 8px;font-size:13px}
.mm-bulk-sep{flex:none;width:1px;height:16px;margin:0 6px;background:var(--border)}
.mm{--violet:oklch(.541 .281 293.009)}
.mm.dark{--violet:oklch(.702 .183 293.541)}
.mm-ogrid{display:grid;grid-template-columns:24px 76px minmax(0,1.7fr) 112px 100px 104px 120px 88px 36px;align-items:center;column-gap:12px}
.mm-incgrid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1.6fr) 96px 120px 136px 104px 36px;align-items:center;column-gap:12px}
.mm-crgrid{display:grid;grid-template-columns:76px minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1.4fr) 110px 120px 128px;align-items:center;column-gap:12px}
.mm-rtgrid{display:grid;grid-template-columns:80px 76px minmax(0,1.3fr) minmax(0,1.3fr) 128px 96px 96px 36px;align-items:center;column-gap:12px}
.mm-oline{display:grid;grid-template-columns:40px minmax(0,1fr) 120px 96px;align-items:center;column-gap:12px}
.mm-eline{display:grid;grid-template-columns:minmax(0,1fr) auto 84px 28px;align-items:center;column-gap:10px}
.mm-nline{display:grid;grid-template-columns:minmax(0,1fr) 112px 100px 90px 28px;align-items:center;column-gap:10px}
.mm-thumb2{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:8px;background:var(--muted);color:var(--muted-foreground)}
.mm-flag{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:500;color:var(--destructive)}
.mm-flag.mm-warn{color:var(--warn)}
.mm-ccards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.mm-ccard{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.mm-ccard[data-due=true]{border-color:color-mix(in oklch,var(--warn) 45%,var(--border))}
.mm-steps{display:flex;align-items:center;gap:0;list-style:none;margin:0;padding:0}
.mm-steps li{display:flex;align-items:center;gap:8px;flex:1;min-width:0;font-size:13px;color:var(--muted-foreground)}
.mm-steps li:not(:last-child)::after{content:"";flex:1;height:1px;margin:0 8px;background:var(--border)}
.mm-steps .mm-sdot{display:inline-flex;flex:none;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;border:1px solid var(--border);background:var(--background);font-size:11px;font-weight:600}
.mm-steps li[data-s=done]{color:var(--foreground)}
.mm-steps li[data-s=done] .mm-sdot{background:var(--primary);border-color:var(--primary);color:var(--primary-foreground)}
.mm-steps li[data-s=now]{color:var(--foreground);font-weight:500}
.mm-steps li[data-s=now] .mm-sdot{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in oklch,var(--primary) 15%,transparent)}
.mm-tl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.mm-tl>li{position:relative;display:flex;gap:12px;padding:0 0 14px}
.mm-tl>li:last-child{padding-bottom:0}
.mm-tl>li::before{content:"";position:absolute;left:5px;top:14px;bottom:0;width:1px;background:var(--border)}
.mm-tl>li:last-child::before{display:none}
.mm-tldot{flex:none;width:11px;height:11px;margin-top:4px;border-radius:9999px;border:2px solid var(--background);background:var(--muted-foreground);box-shadow:0 0 0 1px var(--border)}
.mm-tl .mm-tlnote{padding:8px 10px;border-radius:8px;background:var(--muted);white-space:pre-line}
.mm-kv{display:flex;justify-content:space-between;gap:12px;font-variant-numeric:tabular-nums}
.mm-kv>span:first-child{color:var(--muted-foreground)}
.mm-tagrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.mm-tagx{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 4px 0 8px;border-radius:6px;background:var(--secondary);font-size:12px;font-weight:500}
.mm-tagx button{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--muted-foreground);cursor:pointer}
.mm-tagx button:hover{background:var(--accent);color:var(--foreground)}
.mm-banner{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid color-mix(in oklch,var(--warn) 35%,transparent);border-radius:10px;background:color-mix(in oklch,var(--warn) 7%,transparent)}
.mm-banner>svg{flex:none;margin-top:2px;color:var(--warn)}
.mm-banner.mm-bad{border-color:color-mix(in oklch,var(--destructive) 30%,transparent);background:color-mix(in oklch,var(--destructive) 5%,transparent)}
.mm-banner.mm-bad>svg{color:var(--destructive)}
.mm-script{padding:12px 14px;border-radius:10px;background:var(--muted);font-size:13px;line-height:20px}
.mm-sticky{position:sticky;top:0}
'''

def odhead_for(cur, crumbs, title):
    h = dhead_for(None, crumbs, title)
    h = h.replace(B.inv_group(None), B.m.group(0).replace('href="#"', 'href="Inventory.dc.html"'), 1)
    h = h.replace(ORD_LI.group(0), ord_group(cur), 1)
    k = h.rindex('</style>')
    return h[:k] + OCSS + h[k:]

def ophead_for(title):
    h = phead_for(title)
    k = h.rindex('</style>')
    return h[:k] + OCSS + PCSS + h[k:]

PCSS = '''
.mm-badge-sec{display:inline-flex;align-items:center;padding:2px 6px;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font-size:12px;font-weight:500;line-height:16px;white-space:nowrap}
.mm-check{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:1px solid;border-radius:4px;color:var(--primary-foreground);cursor:pointer;vertical-align:middle;box-shadow:0 1px 2px 0 rgb(0 0 0 / .05)}
.mm-check{width:18px;height:18px}
.mm-ccards{grid-template-columns:minmax(0,1fr)}
.mm-ccard{padding:14px}
.mm-steps li{font-size:12px}
.mm-steps li:not(:last-child)::after{margin:0 4px}
.mm-kv{font-size:14px}
'''

OTABBAR = (TABBAR.replace('<a href="#" class="mm-tabitem" aria-current="page">', '<a href="#" class="mm-tabitem">')
           .replace('<a href="#" class="mm-tabitem"><span class="mm-pill"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2',
                    '<a href="OrdersPhone.dc.html" class="mm-tabitem" aria-current="page"><span class="mm-pill"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2'))
assert OTABBAR.count('aria-current') == 1 and 'OrdersPhone' in OTABBAR

def oexpand(t, phone=False):
    t = re.sub(r'@@OSECTIONS:(\w+)@@', lambda mm: osections(mm.group(1), phone), t)
    t = t.replace('@@TABBAR@@', OTABBAR)
    return expand(t, phone)

OSHARED = oread('shared.js')

def owrite(name, desk_cur, crumbs, title, d, ph, js, opts, default, popts=None):
    js = OSHARED + js
    write(name, odhead_for(desk_cur, crumbs, title), oexpand(d), js, props(opts, default), 'mm mm-root')
    if ph is not None:
        write(name + 'Phone', ophead_for(title), oexpand(ph, True), js, props(popts or opts, default, True), 'mm')

def otop(title, actions, sec):
    return dtop(title, actions, sec).replace('@@SECTIONS:%s@@' % sec, '@@OSECTIONS:%s@@' % sec)

def optop(title, action, sec):
    return ptop(title, action, sec).replace('@@SECTIONS:%s@@' % sec, '@@OSECTIONS:%s@@' % sec)

CHECK = svg(ICONS['check'], 14, 'color: var(--primary-foreground)').replace('stroke-width="2"', 'stroke-width="3"')
def checkbox(p, aria_label=None, extra=''):
    al = ' aria-label="{{%s}}"' % aria_label if aria_label else ''
    return ('<button type="button" role="checkbox" class="mm-check" aria-checked="{{%s.aria}}"%s onClick="{{%s.toggle}}" style="background: {{%s.box}}; border-color: {{%s.edge}}%s"><sc-if value="{{%s.on}}" hint-placeholder-val="{{false}}">' % (p, al, p, p, p, extra, p)
            + CHECK + '</sc-if></button>')

def kv(lab_hole, val_hole, strong=False, color=''):
    st = ' style="font-weight: 600; color: var(--foreground)"' if strong else ''
    c = ' style="color: %s"' % color if color else ''
    return '<div class="mm-kv"%s><span>%s</span><span%s>%s</span></div>' % (' style="font-weight: 600"' if strong else '', lab_hole, c, val_hole)

def radio_list(p, label_id, name_hole=None, sub=True, count=6, var='o'):
    name_hole = name_hole or var + '.label'
    subh = '<sc-if value="{{%s.hasSub}}" hint-placeholder-val="{{false}}"><span class="mm-muted" style="font-size: 12px; line-height: 16px">{{%s.sub}}</span></sc-if>' % (var, var) if sub else ''
    return ('<div role="radiogroup" aria-labelledby="%s" style="display: flex; flex-direction: column; gap: 6px"><sc-for list="{{%s}}" as="%s" hint-placeholder-count="%d">'
            '<button type="button" role="radio" class="mm-mode" aria-checked="{{%s.aria}}" onClick="{{%s.pick}}">' % (label_id, p, var, count, var, var)
            + radio('%s.on' % var) + '<span style="display: flex; flex-direction: column; min-width: 0"><span>{{%s}}</span>%s</span></button></sc-for></div>' % (name_hole, subh))

def chips(p, var, count=4, label_id=None):
    al = ' role="group" aria-labelledby="%s"' % label_id if label_id else ''
    return '<div%s style="display: flex; flex-wrap: wrap; gap: 6px"><sc-for list="{{%s}}" as="%s" hint-placeholder-count="%d"><button type="button" class="mm-chipq" aria-pressed="{{%s.on}}" onClick="{{%s.pick}}">{{%s.label}}</button></sc-for></div>' % (al, p, var, count, var, var, var)

if __name__ == '__main__':
    sys.path.insert(0, 'ord')
    import opages
    which = sys.argv[1:] or list(opages.ALL)
    for w in which:
        opages.ALL[w]()
        print('built', w)
