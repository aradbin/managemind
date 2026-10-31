# One layout on every board: the Products board's (Main) header and sidebar. Run after wire.py; safe to run any time.
# - Desktop header: Search (and its phone-width icon), Create, View store, language, theme, Help, account.
# - Sidebar: Main's groups and labels, the Platform section, and no Billing (it lives in Settings).
# - No section tabs: the sidebar (desktop) and the Menu tab (phone) already list each area's pages.
import glob, re, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
P = 'canvas/project/'
SVG = r'<svg(?:(?!</svg>).)*</svg>'

main = open(P + 'Main.dc.html', encoding='utf-8').read()
mhead = main[main.index('<header'):main.index('</header>')]
SEARCH_SM = re.search(r'<button type="button" class="mm-btn mm-outline mm-icon mm-show-sm"(?:(?!</button>).)*</button>', mhead, re.S).group(0)
SEARCH_SM = SEARCH_SM.replace(' aria-haspopup="dialog" onClick="{{openSearch}}"', '')
VIEW = re.search(r'<a href="#" class="mm-btn mm-outline mm-icon" aria-label="View store"(?:(?!</a>).)*</a>', mhead, re.S).group(0)
LANG = re.search(r'<button type="button" class="mm-btn mm-outline mm-icon" aria-label="বাংলায় দেখুন(?:(?!</button>).)*</button>', mhead, re.S).group(0)
HELP = re.search(r'<button type="button" class="mm-btn mm-outline mm-icon" aria-label="Help"(?:(?!</button>).)*</button>', mhead, re.S).group(0)
SM_CSS = '.mm-show-sm{display:none !important}\n@media (max-width:767px){.mm-show-sm{display:inline-flex !important}}\n'

plat = open(P + 'PlatformStores.dc.html', encoding='utf-8').read()
PLAT_ICON = re.search(r'class="mm-nav" aria-expanded="true">(' + SVG + r')<span style="flex: 1">Platform</span>', plat, re.S).group(1)

CHEV = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
        'stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>')
THEME = '<button type="button" class="mm-btn mm-outline mm-icon" aria-label="{{themeLabel}}"'

def header(t):
    i = t.find('<header'); j = t.find('</header>', i)
    if i < 0 or THEME not in t[i:j]: return t
    h = t[i:j]
    if 'mm-show-sm' not in h:
        k = h.index('<kbd class="mm-kbd">⌘K</kbd></button>') + len('<kbd class="mm-kbd">⌘K</kbd></button>')
        h = h[:k] + '\n' + SEARCH_SM + h[k:]
    if 'aria-label="View store"' not in h:
        k = h.index(THEME); h = h[:k] + VIEW + '\n' + LANG + '\n' + h[k:]
    if 'aria-label="Help"' not in h:
        k = h.index(THEME); k = h.index('</button>', k) + len('</button>')
        h = h[:k] + '\n' + HELP + h[k:]
    t = t[:i] + h + t[j:]
    if '.mm-show-sm{display:none' not in t:
        k = t.index('</style>'); t = t[:k] + SM_CSS + t[k:]
    return t

def sidebar(t, name):
    i = t.find('<aside aria-label="Sidebar"'); j = t.find('</aside>', i)
    if i < 0: return t
    s = t[i:j]
    m = re.search(r'<li><a href="SettingsBilling\.dc\.html" class="mm-nav"( aria-current="page")?>' + SVG + r'Billing</a></li>\n?', s, re.S)
    if m:
        s = s.replace(m.group(0), '')
        if m.group(1) or name == 'SettingsBilling':
            s = s.replace('<li><a href="Settings.dc.html" class="mm-nav">', '<li><a href="Settings.dc.html" class="mm-nav" aria-current="page">')
    s = re.sub(r'(class="mm-subbtn"(?: aria-current="page")?>)Counts</a>', r'\1Stock counts</a>', s)
    if 'id="mm-platform-label"' not in s:
        chev = CHEV
        block = ('\n<div style="display: flex; flex-direction: column; padding-top: 16px">\n<h2 id="mm-platform-label" class="mm-navlabel">Platform</h2>\n'
                 '<ul aria-labelledby="mm-platform-label" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px">\n'
                 '<li><a href="PlatformStores.dc.html" class="mm-nav">' + PLAT_ICON + '<span style="flex: 1">Platform</span>' + chev + '</a></li>\n</ul>\n</div>\n')
        k = s.rindex('</nav>'); s = s[:k].rstrip('\n') + '\n' + block + s[k:]
    return t[:i] + s + t[j:]

def no_sections(t):
    return re.sub(r'<nav aria-label="[^"]* sections"[^>]*>(?:(?!</nav>).)*</nav>\n?', '', t, flags=re.S)

def phone_menu(t):
    t = re.sub(r'<a href="SettingsBillingPhone\.dc\.html" class="mm-mrow"(?:(?!</a>).)*</a>\n?', '', t, flags=re.S)
    return t.replace(", { label: 'Billing', icon: 'billing' }", '')

n = 0
for f in sorted(glob.glob(P + '*.dc.html')):
    name = os.path.basename(f)[:-8]
    t = open(f, encoding='utf-8').read(); o = t
    t = phone_menu(no_sections(sidebar(header(t), name)))
    if t != o:
        open(f, 'w', encoding='utf-8').write(t); n += 1
print('layout', n)
