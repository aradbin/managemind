import os, sys, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'set'))
from sbuild import *
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'set'))
from spages import chipsb, statusline
import build as B

def mread(n): return open('misc/' + n, encoding='utf-8').read()

ICONS['monitor'] = '<rect width="20" height="14" x="2" y="3" rx="2"></rect><path d="M8 21h8"></path><path d="M12 17v4"></path>'

MCSS = '''
.mm-auth{display:flex;flex-direction:column;gap:20px;width:380px;max-width:100%;padding:28px;box-sizing:border-box;border:1px solid var(--border);border-radius:14px;background:var(--card);box-shadow:0 1px 3px rgb(0 0 0 / .06)}
.mm-otp{letter-spacing:.5em;text-align:center;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.mm-paper{width:794px;box-sizing:border-box;padding:48px 56px;background:#fff;color:#111;box-shadow:0 2px 12px rgb(0 0 0 / .12);font-size:13px;line-height:19px}
.mm-paper table{width:100%;border-collapse:collapse}
.mm-paper th{padding:6px 0;border-bottom:1px solid #111;font-weight:600;text-align:left;font-size:12px}
.mm-paper td{padding:7px 0;border-bottom:1px solid #ddd;vertical-align:top}
.mm-paper .r{text-align:right}
.mm-slip{width:794px;height:561px;box-sizing:border-box;padding:32px 40px;background:#fff;color:#111;box-shadow:0 2px 12px rgb(0 0 0 / .12);display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:16px 24px;font-size:13px;line-height:19px}
.mm-qr{display:grid;grid-template-columns:repeat(11,1fr);width:132px;height:132px;padding:6px;border:1px solid #ddd}
.mm-printbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 24px;border-bottom:1px solid var(--border);background:var(--background)}
'''

def auth_head(title):
    h = B.dhead[:B.dhead.index('</helmet>')]
    h = re.sub(r'<title>[^<]*</title>', '<title>' + title + ' — managemind admin</title>', h)
    k = h.rindex('</style>')
    return h[:k] + B.EXTRA + B.ICSS + OCSS + RCSS + SCSS + MCSS + h[k:] + '</helmet>\n'

def auth_phone_head(title):
    h = sphead(title); k = h.rindex('</style>')
    return h[:k] + MCSS + '.mm-auth{width:100%;padding:24px 20px;border:0;box-shadow:none;background:transparent}\n' + h[k:]

BRAND = ('<div style="display: flex; align-items: center; gap: 10px"><span aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; background: var(--primary); color: var(--primary-foreground); font-weight: 700">m</span>'
         '<span style="font-weight: 600; font-size: 16px">managemind</span></div>')

def auth(name, title, card_html, js, foot=''):
    footer = '<p class="mm-muted" style="margin: 0; font-size: 12px; text-align: center">%s</p>' % (foot or 'বাংলা · English')
    d = ('<div class="{{themeClass}}" style="min-height: 900px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: 24px; box-sizing: border-box; background: var(--muted); color: var(--foreground); font-family: {{fontStack}}; font-size: 14px; line-height: 20px">'
         + BRAND + '<main class="mm-auth">' + card_html + '</main>' + footer + '\n@@DTOAST@@\n</div>\n</x-dc>\n')
    ph = ('<div class="{{themeClass}}" style="position: relative; display: flex; flex-direction: column; width: 390px; height: 844px; overflow: hidden; background: var(--background); color: var(--foreground); font-family: {{fontStack}}; font-size: 14px; line-height: 20px">'
          '<div style="display: flex; flex-direction: column; gap: 8px; padding: 56px 20px 0">' + BRAND + '</div><main class="mm-auth" style="flex: 1">' + card_html + '</main><div style="padding: 0 20px 24px">' + footer + '</div>\n@@PTOAST0@@\n</div>\n</x-dc>\n')
    opts = js_starts(js)
    jsall = RSHARED + sread('shared.js') + js
    write(name, auth_head(title), expand(d), jsall, props(opts, opts[0]), 'mm')
    write(name + 'Phone', auth_phone_head(title), expand(ph, True), jsall, props(opts, opts[0], True), 'mm')

def shell_head(title, crumbs):
    h = dhead_for(None, crumbs, title)
    h = h.replace(B.inv_group(None), B.m.group(0).replace('href="#"', 'href="Inventory.dc.html"'), 1)
    k = h.rindex('</style>')
    return h[:k] + OCSS + RCSS + SCSS + MCSS + h[k:]

if __name__ == '__main__':
    sys.path.insert(0, 'misc')
    import mpages
    which = sys.argv[1:] or list(mpages.ALL)
    for w in which:
        mpages.ALL[w]()
        print('built', w)
