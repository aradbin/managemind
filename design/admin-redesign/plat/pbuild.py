import os, sys, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'web'))
sys.path.insert(0, os.path.join(HERE, '..', 'rep'))
from wbuild import *
import build as B
from rpages import HCSS, HPCSS
from opages import ddialog, pbody, pfoot_danger

def pread(n): return open('plat/' + n, encoding='utf-8').read()

ICONS.update({
    'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>',
    'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path>',
    'pause': '<rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect>',
    'play': '<polygon points="6 3 20 12 6 21 6 3"></polygon>',
    'login': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" x2="3" y1="12" y2="12"></line>',
})

PSECTIONS = [('stores', 'Stores', 'PlatformStores'), ('dashboard', 'Dashboard', 'PlatformDashboard'), ('billing', 'Billing', 'PlatformBilling'),
             ('areas', 'Courier areas', 'CourierAreas'), ('terms', 'Terms', 'PlatformTerms'), ('staff', 'Platform staff', 'PlatformStaff'), ('audit', 'Audit log', 'AuditLog')]
PLINK = {k: f for k, _, f in PSECTIONS}

def plat_group(cur):
    subs = ''.join('<li><a href="%s.dc.html" class="mm-subbtn"%s>%s</a></li>' % (f, ' aria-current="page"' if k == cur else '', lab) for k, lab, f in PSECTIONS)
    return ('\n<div style="display: flex; flex-direction: column; padding-top: 16px">\n<h2 id="mm-platform-label" class="mm-navlabel">Platform</h2>\n'
            '<ul aria-labelledby="mm-platform-label" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px">\n'
            '<li><a href="PlatformStores.dc.html" class="mm-nav" aria-expanded="true">' + svg(ICONS['shield']) + '<span style="flex: 1">Platform</span>' + B.CHEV_DOWN + '</a>\n<ul class="mm-sub">\n' + subs + '\n</ul></li>\n</ul>\n</div>\n')

PCSS_PLAT = '''
.mm-plat{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:6px;background:var(--foreground);color:var(--background);font-size:11px;font-weight:600;line-height:20px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.mm-tbl{border:1px solid var(--border);border-radius:12px;background:var(--card)}
.mm-th{display:grid;align-items:center;gap:12px;height:38px;padding:0 12px 0 16px;background:var(--muted);border-radius:12px 12px 0 0;font-size:13px;font-weight:500;color:var(--muted-foreground)}
.mm-tr{display:grid;align-items:center;gap:12px;min-height:52px;padding:4px 12px 4px 16px;border-top:1px solid var(--border);border-bottom:0}
.mm-num{text-align:right;font-variant-numeric:tabular-nums}
.mm-tile{display:inline-flex;flex:none;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--muted);color:var(--foreground);font-size:12px;font-weight:600}
.mm-two{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px;align-items:start}
.mm-col{display:flex;flex-direction:column;gap:16px;min-width:0}
.mm-code6{letter-spacing:.3em;font-variant-numeric:tabular-nums}
'''
PPCSS_PLAT = '''
.mm-steps li:not([data-s=now]) .mm-trunc{display:none}
.mm-steps li:not([data-s=now]){flex:0 1 auto}
.mm-steps li:not([data-s=now])::after{width:24px}
.mm-two{grid-template-columns:minmax(0,1fr);gap:12px}
.mm-col{gap:12px}
'''

def pdhead(cur, crumbs, title):
    h = dhead_for(None, crumbs, title)
    h = h.replace(B.inv_group(None), B.m.group(0).replace('href="#"', 'href="Inventory.dc.html"'), 1)
    k = h.index('</nav>\n</aside>')
    h = h[:k] + plat_group(cur) + h[k:]
    k = h.rindex('</style>')
    return h[:k] + OCSS + RCSS + SCSS + WCSS + HCSS + PCSS_PLAT + h[k:]

def pphead(title):
    h = sphead(title); k = h.rindex('</style>')
    return h[:k] + WCSS + WPCSS + HCSS + HPCSS + PCSS_PLAT + PPCSS_PLAT + h[k:]

MARK = '<span class="mm-plat">' + svg(ICONS['shield'], 12) + 'Platform</span>'

def ppage(name, cur, title, intro, body_d, body_p=None, js='', extra_d='', extra_p='', actions='', actions_p='', back=None, crumbs=None, width=1080, bar=False, title_extra=''):
    """A platform page. back: (board, label) for a detail page; top-level pages go back to the phone menu."""
    bk = ('<a href="%s.dc.html" class="mm-btn mm-ghost mm-icon" aria-label="%s" style="margin-left: -8px">' % back + svg(ICONS['back']) + '</a>') if back else ''
    intro_h = '<p class="mm-muted" style="margin: 0">%s</p>' % intro if intro else ''
    head = ('<div style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px"><div style="display: flex; align-items: flex-start; gap: 12px; min-width: 0; flex: 1 1 420px">%s<div style="display: flex; flex-direction: column; gap: 6px; min-width: 0">'
            '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">%s<h1 class="mm-trunc" style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">%s</h1>%s</div>%s</div></div><div style="display: flex; flex-wrap: wrap; gap: 8px">%s</div></div>'
            % (bk, MARK, title, title_extra, intro_h, actions))
    d = '\n'.join([MAIN, '<div style="display: flex; flex-direction: column; gap: 16px; width: 100%%; max-width: %dpx">' % width, head, body_d.replace('@@AFFIX@@', '8px'), (bar_html() if bar else ''), '</div>']) + DEND + extra_d.replace('@@AFFIX@@', '8px') + XEND
    bp = (body_p if body_p is not None else body_d).replace('@@AFFIX@@', '10px')
    bp = re.sub(r'grid-template-columns: repeat\(\d, minmax\(0, 1fr\)\)', 'grid-template-columns: minmax(0, 1fr)', bp)
    pb = ('%sPhone.dc.html' % back[0], back[1]) if back else ('Phone.dc.html', 'Back to menu')
    pt = re.sub(r'<[^>]+>', '', title) if '{{' not in title else title
    ph = '\n'.join([PROOT % 'var(--background)', phone_back(pb[0], pb[1], pt, '<span class="mm-plat" style="margin-right: 8px" title="Platform">' + svg(ICONS['shield'], 12) + 'Platform</span>'),
                    '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
                    ('<p class="mm-muted" style="margin: 0; font-size: 13px">%s</p>' % intro if intro else ''), title_extra and '<div style="display: flex; flex-wrap: wrap; gap: 6px">%s</div>' % title_extra or '',
                    actions_p, bp, '</main>', (pbar() if bar else '')])
    ph += re.sub(r'grid-template-columns: repeat\(\d, minmax\(0, 1fr\)\)', 'grid-template-columns: minmax(0, 1fr)', extra_p.replace('@@AFFIX@@', '10px')) + '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    jsall = RSHARED + sread('shared.js') + pread('shared.js') + js
    opts = js_starts(js)
    write(name, pdhead(cur, crumbs or [('Platform', 'PlatformStores.dc.html'), (title, '')], pt), rexpand(d), jsall, props(opts, opts[0]), 'mm mm-root')
    write(name + 'Phone', pphead(pt), expand(ph, True), jsall, props(opts, opts[0], True), 'mm')

# ---------- shared pieces ----------
def table(cols, head, rows_list, var, cells, count=6, label='', link=None):
    """A bordered table: header row and one grid row per item."""
    th = '<div class="mm-th" style="grid-template-columns: %s" aria-hidden="true">' % cols + ''.join('<span%s>%s</span>' % (' class="mm-num"' if h.startswith('>') else '', h.lstrip('>')) for h in head) + '</div>'
    return ('<div class="mm-tbl">' + th + '<ul aria-label="%s" style="list-style: none; margin: 0; padding: 0"><sc-for list="{{%s}}" as="%s" hint-placeholder-count="%d"><li class="mm-row mm-tr" style="grid-template-columns: %s">' % (label, rows_list, var, count, cols)
            + cells + '</li></sc-for></ul></div>')

def plist(rows_list, var, cells, count=6, label=''):
    return '<ul class="mm-plist" aria-label="%s"><sc-for list="{{%s}}" as="%s" hint-placeholder-count="%d"><li><div class="mm-prow" style="gap: 10px; min-height: 64px; padding: 8px 12px">%s</div></li></sc-for></ul>' % (label, rows_list, var, count, cells)

def panel(cond, close, tid, title, sub, body, save, label, phone=False, danger=False, left=''):
    if phone:
        foot = pfoot_danger(close, save, label, 'Cancel') if danger else pfoot(close, save, label)
        return pdrawer(cond, close, tid, title, sub, pbody(body), foot)
    c, s2 = dfoot_buttons(close, save, label)
    if danger:
        s2 = s2.replace('class="mm-btn mm-primary"', 'class="mm-btn" style="background: var(--destructive); color: #fff;"').replace('style="background: var(--destructive); color: #fff;" style="', 'style="background: var(--destructive); color: #fff; ')
    return dpanel(cond, close, tid, title, sub, body, left, c, s2)

def dialog(cond, tid, title, body, close, confirm, label, phone=False, danger=False):
    if phone:
        foot = pfoot_danger(close, confirm, label, 'Cancel') if danger else pfoot(close, confirm, label)
        return pdrawer(cond, close, tid, title, '', pbody(body), foot, tall=False, z=70)
    return ddialog(cond, tid, title, body, close, confirm, label, danger=danger, width=500)

def both(fn, *a, **k):
    return '\n' + fn(*a, **k), '\n' + fn(*a, phone=True, **k)

if __name__ == '__main__':
    sys.path.insert(0, 'plat')
    import ppages
    which = sys.argv[1:] or list(ppages.ALL)
    for w in which:
        ppages.ALL[w]()
        print('built', w)
