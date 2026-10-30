import os, sys, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'rep'))
from rbuild import *
import build as B

def sread(n): return open('set/' + n, encoding='utf-8').read()

ICONS.update({
    'store': '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"></path><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"></path><path d="M2 7h20"></path>',
    'globe': '<circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
    'warehouse': '<path d="M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11"></path><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35a2 2 0 0 1 1.26-1.86l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35z"></path><path d="M6 13h12"></path><path d="M6 17h12"></path>',
    'card': '<rect width="20" height="14" x="2" y="5" rx="2"></rect><path d="M2 10h20"></path>',
    'percent': '<path d="M19 5 5 19"></path><circle cx="6.5" cy="6.5" r="2.5"></circle><circle cx="17.5" cy="17.5" r="2.5"></circle>',
    'bell': '<path d="M10.268 21a2 2 0 0 0 3.464 0"></path><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path>',
    'receipt': '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"></path><path d="M14 8H8"></path><path d="M16 12H8"></path><path d="M13 16H8"></path>',
    'key': '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"></path><path d="m21 2-9.6 9.6"></path><circle cx="7.5" cy="15.5" r="5.5"></circle>',
    'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle>',
    'mail': '<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>',
})

SNAV = [('Store', [('store', 'Store profile', 'SettingsStore'), ('domains', 'Domains', 'SettingsDomains'), ('staff', 'Staff', 'SettingsStaff'), ('location', 'Stock location', 'SettingsLocation')]),
        ('Selling', [('payments', 'Payments', 'SettingsPayments'), ('delivery', 'Delivery', 'SettingsDelivery'), ('couriers', 'Couriers', 'SettingsCouriers'), ('checkout', 'Checkout', 'SettingsCheckout'),
                     ('confirmation', 'Order confirmation', 'SettingsConfirmation'), ('vat', 'VAT', 'SettingsVat'), ('returns', 'Returns', 'SettingsReturns')]),
        ('Messages', [('notifications', 'Notifications', 'SettingsNotifications'), ('templates', 'Message wording', 'SettingsTemplates'), ('log', 'Delivery log', 'SettingsLog')]),
        ('Plan and data', [('billing', 'Plan and billing', 'SettingsBilling')])]
PAGES_ALL = [x for g in SNAV for x in g[1]]

SET_LI = re.search(r'<li><a href="(?:#|Settings.dc.html)" class="mm-nav">(<svg(?:(?!</svg>).)*</svg>)Settings</a></li>', B.dhead)
BILL_LI = re.search(r'<li><a href="(?:#|SettingsBilling.dc.html)" class="mm-nav">(<svg(?:(?!</svg>).)*</svg>)Billing</a></li>', B.dhead)
assert SET_LI and BILL_LI

SCSS = '''
.mm-sgrid{display:grid;grid-template-columns:200px minmax(0,780px);gap:32px;align-items:start}
.mm-snav{position:sticky;top:0;display:flex;flex-direction:column;gap:1px}
.mm-snav-h{margin:14px 0 4px;padding:0 10px;font-size:12px;font-weight:500;color:var(--muted-foreground)}
.mm-snav-h:first-child{margin-top:0}
.mm-snav-a{display:flex;align-items:center;height:32px;padding:0 10px;border-radius:8px;color:var(--muted-foreground);font-size:14px;text-decoration:none}
button.mm-snav-a{width:100%;border:0;background:transparent;font:inherit;text-align:left;cursor:pointer}
.mm-snav-a:hover{background:var(--accent);color:var(--foreground)}
.mm-snav-a[aria-current=page]{background:var(--accent);color:var(--foreground);font-weight:500}
.mm-scol{display:flex;flex-direction:column;gap:16px;min-width:0}
.mm-card .mm-swrow{min-height:40px}
.mm-swtext{display:flex;flex-direction:column;gap:2px;min-width:0}
.mm-swtext>span:first-child{font-weight:500}
.mm-swtext>span+span{font-size:13px;color:var(--muted-foreground)}
.mm-sdiv{height:1px;margin:0 -20px;background:var(--border)}
.mm-chips{display:flex;flex-wrap:wrap;gap:6px}
.mm-ok{color:var(--success)}
.mm-scards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.mm-scard{display:flex;gap:12px;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--card);color:var(--foreground);text-decoration:none}
.mm-scard:hover{background:color-mix(in oklch,var(--muted) 40%,var(--card))}
.mm-sico{display:inline-flex;flex:none;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--muted)}
.mm-meter{display:block;height:6px;border-radius:9999px;background:var(--muted);overflow:hidden}
.mm-meter>span{display:block;height:100%;border-radius:9999px;background:var(--primary)}
.mm-code2{padding:2px 6px;border-radius:6px;background:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
'''
SPCSS = '''
.mm-scards{grid-template-columns:minmax(0,1fr);gap:0;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--card)}
.mm-scard{border:0;border-radius:0;border-top:1px solid var(--border);padding:14px 16px}
.mm-scard:first-child{border-top:0}
.mm-sdiv{margin:0 -16px}
'''

def snav(cur):
    out = ['<nav aria-label="Settings" class="mm-snav">']
    for g, items in SNAV:
        out.append('<p class="mm-snav-h">%s</p>' % g)
        for k, lab, f in items:
            out.append('<a href="%s.dc.html" class="mm-snav-a"%s>%s</a>' % (f, ' aria-current="page"' if k == cur else '', lab))
    out.append('</nav>')
    return ''.join(out)

def sdhead(cur, title, crumbs=None):
    h = dhead_for(None, crumbs or [('Settings', 'Settings.dc.html'), (title, '')], title)
    h = h.replace(B.inv_group(None), B.m.group(0).replace('href="#"', 'href="Inventory.dc.html"'), 1)
    if cur == 'billing':
        h = h.replace(BILL_LI.group(0), '<li><a href="SettingsBilling.dc.html" class="mm-nav" aria-current="page">' + BILL_LI.group(1) + 'Billing</a></li>', 1)
        h = h.replace(SET_LI.group(0), '<li><a href="Settings.dc.html" class="mm-nav">' + SET_LI.group(1) + 'Settings</a></li>', 1)
    else:
        h = h.replace(SET_LI.group(0), '<li><a href="Settings.dc.html" class="mm-nav" aria-current="page">' + SET_LI.group(1) + 'Settings</a></li>', 1)
        h = h.replace(BILL_LI.group(0), '<li><a href="SettingsBilling.dc.html" class="mm-nav">' + BILL_LI.group(1) + 'Billing</a></li>', 1)
    k = h.rindex('</style>')
    return h[:k] + OCSS + RCSS + SCSS + h[k:]

def sphead(title):
    h = rphead_for(title); k = h.rindex('</style>')
    return h[:k] + SCSS + SPCSS + h[k:]

# ---------- fields ----------
def card(id_, title, body, sub='', right='', gap='16px'):
    subh = '<p class="mm-muted" style="margin: 0; font-size: 13px">%s</p>' % sub if sub else ''
    return ('<section class="mm-card" aria-labelledby="%s" style="gap: %s"><div style="display: flex; align-items: flex-start; gap: 12px"><div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px"><h2 id="%s" class="mm-ctitle">%s</h2>%s</div>%s</div>\n%s\n</section>'
            % (id_, gap, id_, title, subh, right, body))

def text(id_, label, key, hint='', optional=False, ph='', typ='text', prefix=None, suffix=None, mode=None, invalid=None, err='', p='f', area=False):
    lab = opt(label) if optional else label
    attrs = ' inputMode="%s"' % mode if mode else ''
    inv = ' aria-invalid="{{%s}}"' % invalid if invalid else ''
    if area:
        inp = '<textarea id="%s" class="mm-textarea" value="{{%s.%s.value}}" onChange="{{%s.%s.on}}" placeholder="%s" disabled="{{readOnly}}"></textarea>' % (id_, p, key, p, key, ph)
    else:
        inp = '<input id="%s" class="mm-input" type="%s"%s%s value="{{%s.%s.value}}" onChange="{{%s.%s.on}}" placeholder="%s" disabled="{{readOnly}}">' % (id_, typ, attrs, inv, p, key, p, key, ph)
    if prefix:
        inp = '<label class="mm-affix"><span aria-hidden="true" style="top: @@AFFIX@@">%s</span>%s</label>' % (prefix, inp)
    if suffix:
        inp = '<label class="mm-affix mm-affix-r">%s<span aria-hidden="true" style="top: @@AFFIX@@">%s</span></label>' % (inp, suffix)
    h = '<p class="mm-hint">%s</p>' % hint if hint else ''
    e = '<sc-if value="{{%s}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">%s</p></sc-if>' % (err[0], err[1]) if err else ''
    return '<div class="mm-field"><label class="mm-label" for="%s">%s</label>%s%s%s</div>' % (id_, lab, inp, e, h)

def sw(label, key, hint='', p='f'):
    hh = '<span>%s</span>' % hint if hint else ''
    return ('<div class="mm-swrow" style="align-items: flex-start"><span class="mm-swtext"><span>%s</span>%s</span>' % (label, hh)
            + '<button type="button" role="switch" class="mm-switch" aria-label="%s" aria-checked="{{%s.%s.aria}}" disabled="{{readOnly}}" onClick="{{%s.%s.toggle}}" style="background: {{%s.%s.bg}}; margin-top: 2px"><span class="mm-knob" style="transform: translateX({{%s.%s.x}})"></span></button></div>' % (label, p, key, p, key, p, key, p, key))

def radios(id_, label, lst, var, count=3, hint=''):
    h = '<p class="mm-hint" style="margin-top: 6px">%s</p>' % hint if hint else ''
    return '<div class="mm-field" style="gap: 0"><p id="%s" class="mm-label" style="margin: 0 0 8px">%s</p>' % (id_, label) + radio_list(lst, id_, var=var, count=count) + h + '</div>'

def segs(id_, label, lst, var, count=3, hint=''):
    h = '<p class="mm-hint">%s</p>' % hint if hint else ''
    return ('<div class="mm-field"><span class="mm-label" id="%s">%s</span><div role="radiogroup" aria-labelledby="%s" class="mm-chips"><sc-for list="{{%s}}" as="%s" hint-placeholder-count="%d"><button type="button" role="radio" class="mm-chipq" aria-checked="{{%s.aria}}" aria-pressed="{{%s.pressed}}" disabled="{{readOnly}}" onClick="{{%s.pick}}">{{%s.label}}</button></sc-for></div>%s</div>'
            % (id_, label, id_, lst, var, count, var, var, var, var, h))

def multi(id_, label, lst, var, count=4, hint=''):
    h = '<p class="mm-hint">%s</p>' % hint if hint else ''
    return ('<div class="mm-field"><span class="mm-label" id="%s">%s</span><div role="group" aria-labelledby="%s" class="mm-chips"><sc-for list="{{%s}}" as="%s" hint-placeholder-count="%d"><button type="button" class="mm-chipq" aria-pressed="{{%s.pressed}}" disabled="{{readOnly}}" onClick="{{%s.toggle}}">{{%s.label}}</button></sc-for></div>%s</div>'
            % (id_, label, id_, lst, var, count, var, var, var, h))

def checks(id_, label, lst, var, count=4, hint=''):
    h = '<p class="mm-hint">%s</p>' % hint if hint else ''
    return ('<div class="mm-field" style="gap: 8px"><span class="mm-label" id="%s">%s</span><div role="group" aria-labelledby="%s" style="display: flex; flex-direction: column; gap: 8px"><sc-for list="{{%s}}" as="%s" hint-placeholder-count="%d"><label style="display: flex; align-items: center; gap: 10px; cursor: pointer">'
            % (id_, label, id_, lst, var, count)
            + '<button type="button" role="checkbox" class="mm-check" aria-checked="{{%s.aria}}" disabled="{{readOnly}}" onClick="{{%s.toggle}}" style="background: {{%s.box}}; border-color: {{%s.edge}}"><sc-if value="{{%s.on}}" hint-placeholder-val="{{false}}">' % (var, var, var, var, var) + CHECK + '</sc-if></button>{{%s.label}}</label></sc-for></div>%s</div>' % (var, h))

def grid(*fields, cols=2):
    return '<div class="mm-grid2" style="display: grid; grid-template-columns: repeat(%d, minmax(0, 1fr)); gap: 12px 16px">' % cols + ''.join(fields) + '</div>'

DIV = '<div class="mm-sdiv" role="presentation"></div>'
READONLY = '<sc-if value="{{readOnly}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['lock']) + '<p style="margin: 0">You can see these settings but not change them.</p></div></sc-if>'

def spage(name, cur, title, intro, body_d, body_p=None, js='', extra_d='', extra_p='', actions='', bar=True, wide=False, crumbs=None):
    """A settings page: sub-nav and content on desktop; back header on phone. body_* is the content (cards)."""
    head = ('<div style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px"><div style="display: flex; flex-direction: column; gap: 4px; min-width: 0"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">%s</h1><p class="mm-muted" style="margin: 0">%s</p></div><div style="display: flex; gap: 8px">%s</div></div>' % (title, intro, actions))
    grid_style = ' style="grid-template-columns: 200px minmax(0, 1fr)"' if wide else ''
    d = '\n'.join([MAIN, '<div class="mm-sgrid"%s>' % grid_style, snav(cur), '<div class="mm-scol">', head, READONLY, body_d.replace('@@AFFIX@@', '8px'), (bar_html() if bar else ''), '</div></div>']) + DEND + extra_d.replace('@@AFFIX@@', '8px') + XEND
    bp = (body_p if body_p is not None else body_d).replace('@@AFFIX@@', '10px')
    bp = re.sub(r'grid-template-columns: repeat\(\d, minmax\(0, 1fr\)\)', 'grid-template-columns: minmax(0, 1fr)', bp)
    ph = '\n'.join([PROOT % 'var(--page)', phone_back('SettingsPhone.dc.html', 'Back to settings', title), '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
                    '<p class="mm-muted" style="margin: 0; font-size: 13px">%s</p>' % intro, READONLY, bp, '</main>', (pbar() if bar else '')])
    ph += extra_p.replace('@@AFFIX@@', '10px') + '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    jsall = RSHARED + sread('shared.js') + js
    opts = js_starts(js)
    write(name, sdhead(cur, title, crumbs), rexpand(d), jsall, props(opts, opts[0]), 'mm mm-root')
    write(name + 'Phone', sphead(title), expand(ph, True), jsall, props(opts, opts[0], True), 'mm')

def bar_html():
    return bar()

if __name__ == '__main__':
    sys.path.insert(0, 'set')
    import spages
    which = sys.argv[1:] or list(spages.ALL)
    for w in which:
        spages.ALL[w]()
        print('built', w)
