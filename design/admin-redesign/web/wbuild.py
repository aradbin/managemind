import os, sys, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'set'))
from sbuild import *
import build as B

BACK_LABEL = {'OnlineStore': 'Back to online store', 'StorePages': 'Back to pages'}
def wread(n): return open('web/' + n, encoding='utf-8').read()

ICONS.update({
    'palette': '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>',
    'sliders': '<path d="M10 5H3"></path><path d="M12 19H3"></path><path d="M14 3v4"></path><path d="M16 17v4"></path><path d="M21 12h-9"></path><path d="M21 19h-5"></path><path d="M21 5h-7"></path><path d="M8 10v4"></path><path d="M8 12H3"></path>',
    'up': '<path d="m18 15-6-6-6 6"></path>', 'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>',
    'monitor': '<rect width="20" height="14" x="2" y="3" rx="2"></rect><path d="M8 21h8"></path><path d="M12 17v4"></path>', 'smartphone': '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect><path d="M12 18h.01"></path>',
    'bold': '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"></path>', 'italic': '<line x1="19" x2="10" y1="4" y2="4"></line><line x1="14" x2="5" y1="20" y2="20"></line><line x1="15" x2="9" y1="4" y2="20"></line>',
    'heading': '<path d="M6 12h12"></path><path d="M6 20V4"></path><path d="M18 20V4"></path>', 'list': '<path d="M3 12h.01"></path><path d="M3 18h.01"></path><path d="M3 6h.01"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M8 6h13"></path>',
})

WSECTIONS = [('overview', 'Overview', 'OnlineStore'), ('theme', 'Theme', 'Theme'), ('pages', 'Pages', 'StorePages'), ('settings', 'Store settings', 'StoreSettings')]
WEB_LI = re.search(r'<li><a href="(?:#|OnlineStore.dc.html)" class="mm-nav">(<svg(?:(?!</svg>).)*</svg>)<span style="flex: 1">Online store</span><svg(?:(?!</svg>).)*</svg></a></li>', B.dhead)
assert WEB_LI

def web_group(cur):
    subs = ''.join('<li><a href="%s.dc.html" class="mm-subbtn"%s>%s</a></li>' % (f, ' aria-current="page"' if k == cur else '', lab) for k, lab, f in WSECTIONS[1:])
    return '<li><a href="OnlineStore.dc.html" class="mm-nav" aria-expanded="true"%s>' % (' aria-current="page"' if cur == 'overview' else '') + WEB_LI.group(1) + '<span style="flex: 1">Online store</span>' + B.CHEV_DOWN + '</a>\n<ul class="mm-sub">\n' + subs + '\n</ul></li>'

WCSS = '''
.mm-wcards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.mm-tool{display:flex;gap:2px;padding:4px;border:1px solid var(--input);border-bottom:0;border-radius:8px 8px 0 0;background:var(--muted)}
.mm-tool+textarea{border-radius:0 0 8px 8px}
.mm-swatch{width:36px;height:36px;flex:none;border-radius:8px;border:1px solid var(--border);box-shadow:inset 0 0 0 1px rgb(0 0 0 / .04)}
.mm-crow{display:grid;grid-template-columns:36px minmax(0,1fr) 112px;align-items:center;gap:10px}
.mm-tgrid{display:grid;grid-template-columns:400px minmax(0,1fr);gap:0;flex:1;min-height:0;border-top:1px solid var(--border)}
.mm-tedit{overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;border-right:1px solid var(--border)}
.mm-tprev{display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;background:var(--muted);overflow:auto}
.mm-acc{border:1px solid var(--border);border-radius:12px;background:var(--card)}
.mm-acc>button{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:0 14px;border:0;background:transparent;color:inherit;font:inherit;font-weight:600;text-align:left;cursor:pointer}
.mm-acc>div{display:flex;flex-direction:column;gap:14px;padding:4px 14px 16px}
.mm-secrow{display:flex;align-items:center;gap:6px;min-height:44px;padding:0 6px 0 12px;border:1px solid var(--border);border-radius:8px;background:var(--background)}
.mm-secrow[data-open=true]{border-color:var(--primary)}
.mm-shop{width:100%;border-radius:10px;overflow:hidden;box-shadow:0 10px 30px rgb(0 0 0 / .12);border:1px solid var(--border)}
.mm-up{display:flex;align-items:center;gap:12px;padding:12px;border:1px dashed var(--input);border-radius:10px}
'''
WPCSS = '''
.mm-wcards{grid-template-columns:minmax(0,1fr)}
'''

def wdhead(cur, crumbs, title):
    h = dhead_for(None, crumbs, title)
    h = h.replace(B.inv_group(None), B.m.group(0).replace('href="#"', 'href="Inventory.dc.html"'), 1)
    h = h.replace(WEB_LI.group(0), web_group(cur), 1)
    k = h.rindex('</style>')
    return h[:k] + OCSS + RCSS + SCSS + WCSS + h[k:]

def wphead(title):
    h = sphead(title); k = h.rindex('</style>')
    return h[:k] + WCSS + WPCSS + h[k:]

def wpage(name, cur, title, intro, body_d, body_p=None, js='', extra_d='', extra_p='', actions='', bar=True, back=None, crumbs=None, phone_top=None):
    head = ('<div style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px"><div style="display: flex; align-items: center; gap: 12px; min-width: 0">%s<div style="display: flex; flex-direction: column; gap: 4px; min-width: 0"><h1 class="mm-trunc" style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">%s</h1><p class="mm-muted" style="margin: 0">%s</p></div></div><div style="display: flex; gap: 8px">%s</div></div>'
            % ('<a href="%s.dc.html" class="mm-btn mm-ghost mm-icon" aria-label="Back" style="margin-left: -8px">' % back + svg(ICONS['back']) + '</a>' if back else '', title, intro, actions))
    d = '\n'.join([MAIN, '<div style="display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 860px">', head, READONLY, body_d.replace('@@AFFIX@@', '8px'), (bar_html() if bar else ''), '</div>']) + DEND + extra_d.replace('@@AFFIX@@', '8px') + XEND
    bp = (body_p if body_p is not None else body_d).replace('@@AFFIX@@', '10px')
    bp = re.sub(r'grid-template-columns: repeat\(\d, minmax\(0, 1fr\)\)', 'grid-template-columns: minmax(0, 1fr)', bp)
    if phone_top:
        ph = '\n'.join([PROOT % 'var(--background)', '@@PHEADER@@', '<main class="mm-scroll" style="gap: 12px; padding: 16px">', phone_top, bp, '</main>', '@@TABBAR@@'])
    else:
        ph = '\n'.join([PROOT % 'var(--page)', phone_back((back or 'OnlineStore') + 'Phone.dc.html', BACK_LABEL[back or 'OnlineStore'], title), '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
                        '<p class="mm-muted" style="margin: 0; font-size: 13px">%s</p>' % intro, READONLY, bp, '</main>', (pbar() if bar else '')])
    ph += extra_p.replace('@@AFFIX@@', '10px') + ('\n@@PTOAST@@\n\n</div>\n</x-dc>\n' if phone_top else '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n')
    jsall = RSHARED + sread('shared.js') + js
    opts = js_starts(js)
    write(name, wdhead(cur, crumbs or [('Online store', 'OnlineStore.dc.html'), (title, '')], title), rexpand(d), jsall, props(opts, opts[0]), 'mm mm-root')
    write(name + 'Phone', wphead(title), expand(ph.replace('@@TABBAR@@', RTABBAR), True), jsall, props(opts, opts[0], True), 'mm')

if __name__ == '__main__':
    sys.path.insert(0, 'web')
    import wpages
    which = sys.argv[1:] or list(wpages.ALL)
    for w in which:
        wpages.ALL[w]()
        print('built', w)
