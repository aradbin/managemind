import re, json, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)) + '/..')
P = 'canvas/project/'

def rep(s, a, b, n=1):
    assert s.count(a) == n, (a[:80], s.count(a)); return s.replace(a, b)

def svg(paths, size=16, style=''):
    st = ' style="%s"' % style if style else ''
    return ('<svg width="%d" height="%d" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"%s>%s</svg>') % (size, size, st, paths)

ICONS = {
    'search': '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
    'plus': '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
    'minus': '<path d="M5 12h14"></path>',
    'dots': '<circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle>',
    'x': '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    'check': '<path d="M20 6 9 17l-5-5"></path>',
    'updown': '<path d="m7 15 5 5 5-5"></path><path d="m7 9 5-5 5 5"></path>',
    'down': '<path d="m6 9 6 6 6-6"></path>',
    'right': '<path d="m9 18 6-6-6-6"></path>',
    'back': '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m7 10 5 5 5-5"></path><path d="M12 15V3"></path>',
    'upload': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M12 12v6"></path><path d="m15 15-3-3-3 3"></path>',
    'truck': '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle>',
    'printer': '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"></path><rect x="6" y="14" width="12" height="8" rx="1"></rect>',
    'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path>',
    'adjust': '<path d="M10 5H3"></path><path d="M12 19H3"></path><path d="M14 3v4"></path><path d="M16 17v4"></path><path d="M21 12h-9"></path><path d="M21 19h-5"></path><path d="M21 5h-7"></path><path d="M8 10v4"></path><path d="M8 12H3"></path>',
    'scan': '<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><path d="M8 7v10"></path><path d="M12 7v10"></path><path d="M17 7v10"></path>',
    'camera': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle>',
    'trash': '<path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>',
    'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path>',
    'archive': '<rect width="20" height="5" x="2" y="3" rx="1"></rect><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path><path d="M10 12h4"></path>',
    'phone': '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"></path>',
    'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"></path><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"></path>',
    'file': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
    'info': '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>',
    'alert': '<circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path>',
    'ok': '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>',
    'circleplus': '<circle cx="12" cy="12" r="10"></circle><path d="M8 12h8"></path><path d="M12 8v8"></path>',
    'package': '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"></path><path d="M12 22V12"></path><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"></path><path d="m7.5 4.27 9 5.15"></path>',
    'external': '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
    'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path>',
    'ban': '<circle cx="12" cy="12" r="10"></circle><path d="m4.9 4.9 14.2 14.2"></path>',
    'send': '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"></path><path d="m21.854 2.147-10.94 10.939"></path>',
    'calendar': '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path>',
    'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
}

def icon(m):
    parts = m.group(1).split(':', 2)
    name = parts[0]; size = int(parts[1]) if len(parts) > 1 and parts[1] else 16
    style = parts[2] if len(parts) > 2 else ''
    return svg(ICONS[name], size, style)

SECTIONS = [('stock', 'Stock', 'Inventory'), ('po', 'Purchase orders', 'PurchaseOrders'), ('receive', 'Receive stock', 'Receive'),
            ('suppliers', 'Suppliers', 'Suppliers'), ('counts', 'Counts', 'Counts'), ('adjustments', 'Adjustments', 'Adjustments')]

def sections(cur, phone=False):
    out = []
    for k, lab, f in SECTIONS:
        href = f + ('Phone' if phone else '') + '.dc.html'
        out.append('<a href="%s" class="mm-tab"%s>%s</a>' % (href, ' aria-current="page"' if k == cur else '', lab))
    if phone:
        return ('<nav aria-label="Inventory sections" style="margin: 0 -16px; padding: 0 16px; overflow-x: auto; scrollbar-width: none">\n'
                '<div class="mm-secbar">' + ''.join(out) + '</div>\n</nav>')
    return '<nav aria-label="Inventory sections" style="overflow-x: auto">\n<div class="mm-secbar">' + ''.join(out) + '</div>\n</nav>'

DTOAST = ('<sc-if value="{{hasToast}}" hint-placeholder-val="{{false}}">\n<div role="status" style="position: fixed; right: 24px; bottom: 24px; z-index: 90; display: flex; align-items: center; gap: 8px; width: 356px; max-width: calc(100% - 48px); box-sizing: border-box; padding: 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--popover); color: var(--foreground); font-size: 13px; line-height: 20px; box-shadow: 0 4px 12px rgb(0 0 0 / .1)">\n'
          + svg(ICONS['ok'], 16, 'flex: none') + '<span style="font-weight: 500">{{toastText}}</span>\n</div>\n</sc-if>')
PTOAST = ('<sc-if value="{{hasToast}}" hint-placeholder-val="{{false}}">\n<div role="status" class="mm-toast" style="bottom: @@BOTTOM@@">'
          + svg(ICONS['ok'], 16, 'flex: none') + '<span style="font-weight: 500">{{toastText}}</span></div>\n</sc-if>')

def dpanel(cond, close, title_id, title, sub, body, foot_left, cancel, save, save_dis='', save_label='Save'):
    """A side panel: header, scrolling body, footer with Cancel · Save (and an optional left action)."""
    dis = ' disabled="{{%s}}"' % save_dis if save_dis else ''
    subhtml = '<p id="%s-sub" class="mm-muted" style="margin: 0">%s</p>' % (title_id, sub) if sub else ''
    return '\n'.join([
        '<sc-if value="{{%s}}" hint-placeholder-val="{{false}}">' % cond,
        '<div style="position: fixed; inset: 0; z-index: 50">',
        '<button type="button" tabindex="-1" class="mm-scrim" aria-label="Close" onClick="{{%s}}" style="position: absolute; background: rgb(0 0 0 / .5)"></button>' % close,
        '<div role="dialog" aria-modal="true" aria-labelledby="%s" onKeyDown="{{escClose}}" class="mm-panel">' % title_id,
        '<div class="mm-phead"><h2 id="%s" style="margin: 0; font-size: 16px; font-weight: 600; line-height: 24px">%s</h2>%s</div>' % (title_id, title, subhtml),
        '<div class="mm-pbody">', body, '</div>',
        '<div class="mm-pfoot">', foot_left or '', '<span style="flex: 1"></span>',
        cancel,
        save,
        '</div>',
        '<button type="button" class="mm-btn mm-ghost mm-icon" aria-label="Close" onClick="{{%s}}" style="position: absolute; top: 12px; right: 12px; width: 28px; height: 28px; opacity: .7">%s</button>' % (close, svg(ICONS['x'])),
        '</div>', '</div>', '</sc-if>'])

def palert(cond, title, body, cancel, confirm, label, danger=True, z=80):
    color = 'background: var(--destructive); color: #fff' if danger else ''
    cls = 'mm-btn' if danger else 'mm-btn mm-primary'
    return '\n'.join([
        '<sc-if value="{{%s}}" hint-placeholder-val="{{false}}">' % cond,
        '<div style="position: fixed; inset: 0; z-index: %d">' % z,
        '<div aria-hidden="true" style="position: absolute; inset: 0; background: rgb(0 0 0 / .5)"></div>',
        '<div role="alertdialog" aria-modal="true" aria-labelledby="mm-al-title" aria-describedby="mm-al-desc" onKeyDown="{{escClose}}" class="mm-dialog" style="max-width: 460px">',
        '<div style="display: flex; flex-direction: column; gap: 8px"><h2 id="mm-al-title" style="margin: 0; font-size: 18px; line-height: 1.3; font-weight: 600">%s</h2><div id="mm-al-desc" style="display: flex; flex-direction: column; gap: 6px; color: var(--muted-foreground)">%s</div></div>' % (title, body),
        '<div style="display: flex; flex-wrap: wrap-reverse; justify-content: flex-end; gap: 8px">',
        '<button type="button" class="mm-btn mm-outline" style="height: 36px; padding: 0 16px" onClick="{{%s}}">Cancel</button>' % cancel,
        '<button type="button" class="%s" style="height: 36px; padding: 0 16px; %s" onClick="{{%s}}">%s</button>' % (cls, color, confirm, label),
        '</div>', '</div>', '</div>', '</sc-if>'])

def phalert(cond, title, body, cancel, confirm, label, danger=True):
    color = 'background: var(--destructive); color: #fff' if danger else ''
    cls = 'mm-btn' if danger else 'mm-btn mm-primary'
    return '\n'.join([
        '<sc-if value="{{%s}}" hint-placeholder-val="{{false}}">' % cond,
        '<div class="mm-layer" style="z-index: 70">',
        '<div aria-hidden="true" style="position: absolute; inset: 0; background: rgb(0 0 0 / .5)"></div>',
        '<div role="alertdialog" aria-modal="true" aria-labelledby="mm-al-title" aria-describedby="mm-al-desc" onKeyDown="{{escClose}}" class="mm-alertbox">',
        '<div style="display: flex; flex-direction: column; gap: 8px; text-align: center"><h2 id="mm-al-title" style="margin: 0; font-size: 18px; line-height: 24px; font-weight: 600">%s</h2><div id="mm-al-desc" style="display: flex; flex-direction: column; gap: 6px; color: var(--muted-foreground)">%s</div></div>' % (title, body),
        '<div style="display: flex; flex-direction: column; gap: 8px"><button type="button" class="%s" style="width: 100%%; %s" onClick="{{%s}}">%s</button><button type="button" class="mm-btn mm-outline" style="width: 100%%" onClick="{{%s}}">Cancel</button></div>' % (cls, color, confirm, label, cancel),
        '</div>', '</div>', '</sc-if>'])

def pdrawer(cond, close, title_id, title, sub, body, foot, tall=True, z=50):
    h = ' style="height: 92%; max-height: 92%"' if tall else ''
    subhtml = '<p class="mm-muted" style="margin: 2px 0 0; font-size: 13px">%s</p>' % sub if sub else ''
    return '\n'.join([
        '<sc-if value="{{%s}}" hint-placeholder-val="{{false}}">' % cond,
        '<div class="mm-layer"%s>' % (' style="z-index: %d"' % z if z != 50 else ''),
        '<button type="button" tabindex="-1" class="mm-scrim" aria-label="Close" onClick="{{%s}}"></button>' % close,
        '<div role="dialog" aria-modal="true" aria-labelledby="%s" class="mm-drawer" onKeyDown="{{escClose}}"%s>' % (title_id, h),
        '<div class="mm-handle" aria-hidden="true"></div>',
        '<div class="mm-dhead"><h2 id="%s" class="mm-dtitle">%s</h2>%s</div>' % (title_id, title, subhtml),
        body,
        foot or '',
        '</div>', '</div>', '</sc-if>'])

def pfoot(cancel, save, save_label, save_dis=''):
    dis = ' disabled="{{%s}}"' % save_dis if save_dis else ''
    return ('<div style="flex: none; display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border)">'
            '<button type="button" class="mm-btn mm-outline" style="flex: 1" onClick="{{%s}}">Cancel</button>'
            '<button type="button" class="mm-btn mm-primary" style="flex: 2"%s onClick="{{%s}}">%s</button></div>') % (cancel, dis, save, save_label)

def dfoot_buttons(cancel, save, save_label, save_dis=''):
    dis = ' disabled="{{%s}}"' % save_dis if save_dis else ''
    return ('<button type="button" class="mm-btn mm-outline" style="height: 36px; padding: 0 16px" onClick="{{%s}}">Cancel</button>' % cancel,
            '<button type="button" class="mm-btn mm-primary" style="height: 36px; padding: 0 16px"%s onClick="{{%s}}">%s</button>' % (dis, save, save_label))

def sbadge(p):
    return '<span class="mm-sbadge" style="background: {{%s.bg}}; color: {{%s.fg}}; box-shadow: inset 0 0 0 1px {{%s.edge}}">{{%s.label}}</span>' % (p, p, p, p)

def dmenu(cond, toggle, aria, items, width=200, ghost=True, size=16, right=True, top=36):
    """A ⋯ button with its menu. items: list of (label, handler, icon, danger) or 'sep' or ('link', label, href, icon)."""
    rows = []
    for it in items:
        if it == 'sep':
            rows.append('<div role="separator" class="mm-sep"></div>'); continue
        if it[0] == 'link':
            rows.append('<a href="%s" role="menuitem" class="mm-cmd-item">%s%s</a>' % (it[2], svg(ICONS[it[3]]), it[1])); continue
        lab, h, ic, danger = it[0], it[1], it[2], (it[3] if len(it) > 3 else False)
        cond_open = ''
        if isinstance(danger, str):
            cond_open = danger; danger = False
        btn = '<button type="button" role="menuitem" class="mm-cmd-item%s" onClick="{{%s}}">%s%s</button>' % (' mm-danger' if danger else '', h, svg(ICONS[ic]), lab)
        if cond_open:
            btn = '<sc-if value="{{%s}}" hint-placeholder-val="{{true}}">%s</sc-if>' % (cond_open, btn)
        rows.append(btn)
    cls = 'mm-btn mm-ghost mm-icon mm-above' if ghost else 'mm-btn mm-outline mm-icon'
    return '\n'.join([
        '<div style="position: relative; display: flex; justify-content: flex-end">',
        '<button type="button" class="%s" aria-label="{{%s}}" aria-haspopup="menu" onClick="{{%s}}">%s</button>' % (cls, aria, toggle, svg(ICONS['dots'], size)),
        '<sc-if value="{{%s}}" hint-placeholder-val="{{false}}">' % cond,
        '<button type="button" tabindex="-1" class="mm-scrim" aria-label="Close menu" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button>',
        '<div role="menu" aria-label="{{%s}}" class="mm-menu" onKeyDown="{{escClose}}" style="top: %dpx; %s: 0; width: %dpx">' % (aria, top, 'right' if right else 'left', width),
        '\n'.join(rows), '</div>', '</sc-if>', '</div>'])

def combo_pop(p, empty='Nothing found.', width=None, item_extra=''):
    """A searchable select's popover, bound to {{p}}: open, query, onQuery, items[label, sub, check, aria, pick], none."""
    w = ' style="width: %dpx"' % width if width else ''
    return ('<sc-if value="{{%s.open}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close list" onClick="{{closeCombo}}" style="z-index: 35; background: transparent"></button>'
            '<div class="mm-pop" role="dialog" aria-label="{{%s.title}}" onKeyDown="{{comboEsc}}"%s><div class="mm-popsearch">%s<input class="mm-cmd-input" aria-label="{{%s.ph}}" placeholder="{{%s.ph}}" autoComplete="off" autoFocus="{{true}}" value="{{%s.query}}" onChange="{{%s.onQuery}}"></div>'
            '<div role="listbox" aria-label="{{%s.title}}" class="mm-poplist" style="max-height: 280px"><sc-for list="{{%s.items}}" as="o" hint-placeholder-count="6"><button type="button" role="option" aria-selected="{{o.aria}}" class="mm-cmd-item" onClick="{{o.pick}}">'
            '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc">{{o.label}}</span><sc-if value="{{o.hasSub}}" hint-placeholder-val="{{false}}"><span class="mm-trunc" style="font-size: 12px; color: var(--muted-foreground)">{{o.sub}}</span></sc-if></span>'
            '%s</button></sc-for><sc-if value="{{%s.none}}" hint-placeholder-val="{{false}}"><p class="mm-popempty">%s</p></sc-if></div></div></sc-if>') % (
        p, p, w, svg(ICONS['search'], 16, 'flex: none; opacity: .5'), p, p, p, p, p, p,
        svg(ICONS['check'], 16, 'flex: none; opacity: {{o.check}}; color: var(--foreground)'), p, empty)

def combo_btn(p, label_id, extra=''):
    return ('<div style="position: relative"><button type="button" class="mm-combo" role="combobox" aria-haspopup="listbox" aria-expanded="{{%s.aria}}" aria-labelledby="%s" disabled="{{%s.disabled}}" onClick="{{%s.toggle}}"%s>'
            '<span class="mm-trunc" style="color: {{%s.color}}">{{%s.display}}</span>%s</button>%s</div>') % (
        p, label_id, p, p, extra, p, p, svg(ICONS['updown'], 16, 'flex: none; opacity: .5'), combo_pop(p))

def pcombo_btn(p, label_id):
    return ('<button type="button" class="mm-combo" role="combobox" aria-haspopup="dialog" aria-expanded="{{%s.aria}}" aria-labelledby="%s" disabled="{{%s.disabled}}" onClick="{{%s.toggle}}">'
            '<span class="mm-trunc" style="color: {{%s.color}}">{{%s.display}}</span>%s</button>') % (
        p, label_id, p, p, p, p, svg(ICONS['updown'], 16, 'flex: none; opacity: .5'))

PCOMBO_DRAWER = ('<sc-if value="{{comboOpen}}" hint-placeholder-val="{{false}}">\n<div class="mm-layer" style="z-index: 60">\n'
    '<button type="button" tabindex="-1" class="mm-scrim" aria-label="Close list" onClick="{{closeCombo}}"></button>\n'
    '<div role="dialog" aria-modal="true" aria-labelledby="mm-cb-title" class="mm-drawer" onKeyDown="{{comboEsc}}" style="height: 70%">\n'
    '<div class="mm-handle" aria-hidden="true"></div>\n<div class="mm-dhead"><h2 id="mm-cb-title" class="mm-dtitle">{{cbd.title}}</h2></div>\n'
    '<div style="flex: none; position: relative; padding: 0 16px 8px">\n' + svg(ICONS['search'], 16, 'position: absolute; left: 28px; top: 12px; color: var(--muted-foreground); pointer-events: none') + '\n'
    '<input type="search" class="mm-input" aria-label="{{cbd.ph}}" placeholder="{{cbd.ph}}" autoComplete="off" value="{{cbd.query}}" onChange="{{cbd.onQuery}}" style="padding-left: 36px">\n</div>\n'
    '<div role="listbox" aria-labelledby="mm-cb-title" style="flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 24px">\n'
    '<sc-for list="{{cbd.items}}" as="o" hint-placeholder-count="7"><button type="button" role="option" aria-selected="{{o.aria}}" class="mm-optrow" onClick="{{o.pick}}"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc">{{o.label}}</span><sc-if value="{{o.hasSub}}" hint-placeholder-val="{{false}}"><span class="mm-trunc mm-muted" style="font-size: 13px">{{o.sub}}</span></sc-if></span>'
    + svg(ICONS['check'], 18, 'opacity: {{o.check}}; color: var(--foreground)') + '</button></sc-for>\n'
    '<sc-if value="{{cbd.none}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; padding: 24px 0; text-align: center">Nothing found.</p></sc-if>\n'
    '</div>\n</div>\n</div>\n</sc-if>')

# ---------- desktop head ----------
def css_rules(path, classes):
    t = open(path, encoding='utf-8').read(); t = t[:t.index('</helmet>')]
    out = []
    for line in t.split('\n'):
        if '{' not in line: continue
        sel = line[:line.index('{')]
        if any(re.search(r'\.' + re.escape(c) + r'(?![\w-])', sel) for c in classes):
            if line not in out: out.append(line)
    return '\n'.join(out)

prom = open(P + 'Promotions.dc.html', encoding='utf-8').read()
dhead = prom[:prom.index('<main class="mm-scroll"')]
dhead = rep(dhead, ' class="mm-nav" aria-current="page">', ' class="mm-nav">')
INV_ICON = re.search(r'<li><a href="(?:#|Inventory.dc.html)" class="mm-nav">(<svg(?:(?!</svg>).)*</svg>)<span style="flex: 1">Inventory</span>', dhead).group(1)
CHEV_DOWN = svg('<path d="m9 18 6-6-6-6"></path>', 16, 'transform: rotate(90deg)')
m = re.search(r'<li><a href="(?:#|Inventory.dc.html)" class="mm-nav"><svg(?:(?!</svg>).)*</svg><span style="flex: 1">Inventory</span><svg(?:(?!</svg>).)*</svg></a></li>', dhead)
assert m
def inv_group(cur):
    subs = ''.join('<li><a href="%s.dc.html" class="mm-subbtn"%s>%s</a></li>' % (f, ' aria-current="page"' if k == cur else '', lab) for k, lab, f in SECTIONS)
    return ('<li><a href="Inventory.dc.html" class="mm-nav" aria-expanded="true">' + INV_ICON + '<span style="flex: 1">Inventory</span>' + CHEV_DOWN + '</a>\n<ul class="mm-sub">\n' + subs + '\n</ul></li>')
OL = '<ol style="list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 6px; color: var(--muted-foreground); white-space: nowrap">'
CRUMB_CHEV = '<li aria-hidden="true" style="display: flex">' + svg('<path d="m9 18 6-6-6-6"></path>', 14) + '</li>'

EXTRA = '\n'.join([
    css_rules(P + 'Customer.dc.html', ['mm-panel', 'mm-pbody', 'mm-pfoot', 'mm-phead', 'mm-cols', 'mm-sbad', 'mm-radio-row']),
    css_rules(P + 'Expenses.dc.html', ['mm-paygrid', 'mm-paybtn', 'mm-note', 'mm-needed']),
    css_rules(P + 'Main.dc.html', ['mm-check']),
])
ICSS = '''
.mm{--warn:oklch(.666 .179 58.318);--info:oklch(.546 .245 262.881)}
.mm.dark{--warn:oklch(.769 .188 70.08);--info:oklch(.707 .165 254.624)}
.mm-secbar{display:inline-flex;align-items:center;height:36px;padding:3px;box-sizing:border-box;border-radius:10px;background:var(--muted)}
.mm-secbar .mm-tab{height:30px;font-size:14px}
.mm-tab[aria-current=page]{background:var(--background);color:var(--foreground);box-shadow:0 1px 3px 0 rgb(0 0 0 / .1),0 1px 2px -1px rgb(0 0 0 / .1)}
.mm.dark .mm-tab[aria-current=page]{background:var(--input);border-color:var(--input)}
.mm.dark .mm-tab[aria-selected=true]{background:var(--input);border-color:var(--input)}
.mm-tab:hover{color:var(--foreground)}
.mm-ttabs .mm-tab{height:30px;gap:6px}
.mm-sgrid{display:grid;grid-template-columns:minmax(0,2.4fr) minmax(0,1fr) 84px 84px 120px 132px;align-items:center;column-gap:12px}
.mm-agrid{display:grid;grid-template-columns:150px minmax(0,2fr) minmax(0,1.6fr) 84px 110px;align-items:center;column-gap:12px}
.mm-pogrid{display:grid;grid-template-columns:96px minmax(0,1.6fr) 130px minmax(0,1.2fr) 120px 110px 40px;align-items:center;column-gap:12px}
.mm-supgrid{display:grid;grid-template-columns:minmax(0,1.8fr) 150px minmax(0,1fr) 110px 150px 40px;align-items:center;column-gap:12px}
.mm-cntgrid{display:grid;grid-template-columns:90px minmax(0,1.6fr) 110px minmax(0,1.3fr) minmax(0,1.2fr) 90px 40px;align-items:center;column-gap:12px}
.mm-lgrid{display:grid;grid-template-columns:minmax(0,1fr) 84px 120px 104px 32px;align-items:center;column-gap:10px}
.mm-rvgrid{display:grid;grid-template-columns:minmax(0,1fr) 84px 120px 32px;align-items:center;column-gap:10px}
.mm-ledgrid{display:grid;grid-template-columns:110px minmax(0,1fr) 110px 110px 36px;align-items:center;column-gap:12px}
.mm-revgrid{display:grid;grid-template-columns:minmax(0,1fr) 72px 96px 84px 96px;align-items:center;column-gap:12px}
.mm-cntline{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:12px}
.mm-prog{display:block;height:6px;overflow:hidden;border-radius:9999px;background:var(--muted)}
.mm-prog>span{display:block;height:100%;border-radius:9999px;background:var(--primary)}
.mm-prog.mm-done>span{background:var(--success)}
.mm-progcell{display:flex;flex-direction:column;gap:6px;min-width:0}
.mm-sm{height:32px}
.mm-qty{width:100%;height:32px;padding:0 8px;text-align:right;font-variant-numeric:tabular-nums}
.mm-bad{color:var(--destructive)}
.mm-good{color:var(--success)}
.mm-mlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.mm-mlist>li{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-bottom:1px solid var(--border)}
.mm-mlist>li:last-child{border-bottom:0}
.mm-chg{display:flex;justify-content:space-between;gap:8px}
.mm-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.mm-mode{display:flex;align-items:center;gap:10px;min-height:40px;padding:8px 10px;box-sizing:border-box;border:1px solid var(--input);border-radius:8px;background:var(--background);color:var(--foreground);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}
.mm-mode[aria-checked=true]{border-color:var(--primary);background:color-mix(in oklch,var(--muted) 60%,transparent);font-weight:500}
.mm-mode[aria-checked=true] .mm-radio{border-color:var(--primary)}
.mm-mgroup{margin:0 0 6px;font-size:12px;font-weight:500;color:var(--muted-foreground)}
.mm-dl{display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px 16px;margin:0}
.mm-dl dt{color:var(--muted-foreground)}
.mm-dl dd{margin:0;white-space:pre-line}
.mm-big{font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.mm-scanbox{display:flex;gap:8px}
.mm-addrow{display:flex;align-items:center;gap:8px;width:100%;height:40px;padding:0 12px;box-sizing:border-box;border:1px dashed var(--input);border-radius:10px;background:transparent;color:var(--muted-foreground);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.mm-addrow:hover{background:var(--accent);color:var(--foreground)}
.mm-emptybox{display:flex;flex-direction:column;align-items:center;gap:10px;padding:24px 16px;border:1px dashed var(--border);border-radius:10px;text-align:center;color:var(--muted-foreground)}
.mm-readonly{display:flex;align-items:center;gap:8px;height:36px;padding:0 10px 0 12px;box-sizing:border-box;border:1px solid var(--input);border-radius:8px;background:var(--muted);color:var(--foreground)}
.mm-input[aria-invalid=true],.mm-combo[aria-invalid=true]{border-color:var(--destructive)}
.mm-warn{color:var(--warn)}
.mm-step{display:inline-flex;flex:none;align-items:center;height:32px;border:1px solid var(--input);border-radius:8px;overflow:hidden;background:var(--background)}
.mm-step button{width:32px;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.mm-step button:hover{background:var(--accent)}
.mm-step button:disabled{opacity:.4;cursor:default}
.mm-step input{width:52px;height:100%;padding:0;border:0;border-left:1px solid var(--input);border-right:1px solid var(--input);background:transparent;color:var(--foreground);font:inherit;font-weight:500;text-align:center;font-variant-numeric:tabular-nums;outline:none}
.mm-step input:focus-visible{box-shadow:inset 0 0 0 2px var(--ring)}
.mm-camera{display:flex;align-items:center;justify-content:center;height:180px;border-radius:10px;background:#111;color:#ddd;font-size:13px}
.mm-statlink{padding:0;border:0;background:transparent;color:var(--destructive);font:inherit;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px;cursor:pointer}
.mm-statlink:hover,.mm-statlink[aria-pressed=true]{text-decoration-color:currentColor}
.mm-statbtn{display:flex;flex-direction:column;gap:6px;padding:16px 20px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mm-statbtn:hover{background:color-mix(in oklch,var(--muted) 50%,transparent)}
.mm-chipq{display:inline-flex;align-items:center;height:28px;padding:0 10px;border:0;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.mm-chipq[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground)}
'''

def dhead_for(cur, crumbs, title):
    h = dhead.replace(m.group(0), inv_group(cur))
    i = h.index(OL); i = h.index('>', i) + 1; j = h.index('</ol>', i)
    parts = []
    for k, (lab, href) in enumerate(crumbs):
        last = k == len(crumbs) - 1
        if last:
            parts.append('<li aria-current="page" style="overflow: hidden; text-overflow: ellipsis; color: var(--foreground)">%s</li>' % lab)
        else:
            parts.append('<li><a href="%s">%s</a></li>' % (href, lab)); parts.append(CRUMB_CHEV)
    h = h[:i] + '\n' + ''.join(parts) + '\n' + h[j:]
    h = re.sub(r'<title>[^<]*</title>', '<title>' + title + ' — managemind admin</title>', h)
    k = h.rindex('</style>')
    return h[:k] + EXTRA + ICSS + h[k:]

# ---------- phone head ----------
ep = open(P + 'ExpensesPhone.dc.html', encoding='utf-8').read()
phead = ep[:ep.index('</style>\n</helmet>')]
IPCSS = '''
.mm-badge-sec{display:inline-flex;align-items:center;padding:2px 6px;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font-size:12px;font-weight:500;line-height:16px;white-space:nowrap}
.mm-camera{display:flex;align-items:center;justify-content:center;height:200px;border-radius:10px;background:#111;color:#ddd;font-size:13px}
.mm-step button:disabled{opacity:.4}
.mm-input[aria-invalid=true],.mm-combo[aria-invalid=true]{border-color:var(--destructive)}
.mm-warn{color:var(--warn)}
.mm{--warn:oklch(.666 .179 58.318)}
.mm.dark{--warn:oklch(.769 .188 70.08)}
.mm-readonly{display:flex;align-items:center;gap:8px;height:40px;padding:0 10px 0 12px;box-sizing:border-box;border:1px solid var(--input);border-radius:8px;background:var(--muted);color:var(--foreground)}
.mm{--info:oklch(.546 .245 262.881)}
.mm.dark{--info:oklch(.707 .165 254.624)}
.mm-secbar{display:inline-flex;align-items:center;height:40px;padding:3px;box-sizing:border-box;border-radius:10px;background:var(--muted)}
.mm-secbar .mm-tab{height:34px;padding:0 12px;font-size:14px}
.mm-tab[aria-current=page]{background:var(--background);color:var(--foreground);box-shadow:0 1px 3px 0 rgb(0 0 0 / .1),0 1px 2px -1px rgb(0 0 0 / .1)}
.mm.dark .mm-tab[aria-current=page]{background:var(--input);border-color:var(--input)}
.mm-ttabs .mm-tab{height:34px;gap:6px;padding:0 12px}
.mm-tabcount{font-size:12px;font-weight:500;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.mm-prog{display:block;height:6px;overflow:hidden;border-radius:9999px;background:var(--muted)}
.mm-prog>span{display:block;height:100%;border-radius:9999px;background:var(--primary)}
.mm-prog.mm-done>span{background:var(--success)}
.mm-bad{color:var(--destructive)}
.mm-good{color:var(--success)}
.mm-mlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.mm-mlist>li{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-bottom:1px solid var(--border)}
.mm-mlist>li:last-child{border-bottom:0}
.mm-chg{display:flex;justify-content:space-between;gap:8px}
.mm-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.mm-mode{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 10px;box-sizing:border-box;border:1px solid var(--input);border-radius:8px;background:var(--background);color:var(--foreground);font:inherit;font-size:14px;line-height:18px;text-align:left;cursor:pointer}
.mm-mode[aria-checked=true]{border-color:var(--primary);background:color-mix(in oklch,var(--muted) 60%,transparent);font-weight:500}
.mm-mode[aria-checked=true] .mm-radio{border-color:var(--primary)}
.mm-mgroup{margin:0 0 6px;font-size:12px;font-weight:500;color:var(--muted-foreground)}
.mm-dl{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px 12px;margin:0;font-size:14px}
.mm-dl dt{color:var(--muted-foreground)}
.mm-dl dd{margin:0;white-space:pre-line}
.mm-big{font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.mm-addrow{display:flex;align-items:center;gap:8px;width:100%;height:44px;padding:0 12px;box-sizing:border-box;border:1px dashed var(--input);border-radius:10px;background:transparent;color:var(--muted-foreground);font:inherit;font-size:15px;text-align:left;cursor:pointer}
.mm-emptybox{display:flex;flex-direction:column;align-items:center;gap:10px;padding:24px 16px;border:1px dashed var(--border);border-radius:10px;text-align:center;color:var(--muted-foreground)}
.mm-qty{width:72px;height:40px;padding:0 8px;text-align:right;font-variant-numeric:tabular-nums}
.mm-step{display:inline-flex;flex:none;align-items:center;height:40px;border:1px solid var(--input);border-radius:8px;overflow:hidden}
.mm-step button{width:40px;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.mm-step input{width:52px;height:100%;padding:0;border:0;border-left:1px solid var(--input);border-right:1px solid var(--input);background:transparent;color:var(--foreground);font:inherit;font-size:16px;font-weight:500;text-align:center;font-variant-numeric:tabular-nums;outline:none}
.mm-chipq{display:inline-flex;align-items:center;height:32px;padding:0 12px;border:0;border-radius:6px;background:var(--secondary);color:var(--secondary-foreground);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.mm-chipq[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground)}
.mm-stats2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:0;border:1px solid var(--border);border-radius:12px;background:var(--card);overflow:hidden}
.mm-stats2>div{display:flex;flex-direction:column;gap:4px;padding:12px 16px}
.mm-stats2>div:nth-child(even){border-left:1px solid var(--border)}
.mm-stats2>div:nth-child(n+3){border-top:1px solid var(--border)}
.mm-stats2 dt{font-size:12px;font-weight:500;color:var(--muted-foreground)}
.mm-stats2 dd{margin:0;font-size:18px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums}
'''
def phead_for(title):
    h = re.sub(r'<title>[^<]*</title>', '<title>' + title + ' — phone</title>', phead)
    return h + IPCSS + '</style>\n</helmet>\n'

TABBAR = open('inv/_tabbar.html', encoding='utf-8').read()
PHEADER = open('inv/_phead.html', encoding='utf-8').read()

def phone_back(href, aria, title, right=''):
    return ('<header style="display: flex; flex: none; align-items: center; gap: 4px; height: 56px; padding: 0 8px; border-bottom: 1px solid var(--border); background: var(--background)">\n'
            '<a href="%s" class="mm-btn mm-ghost mm-icon" aria-label="%s">%s</a>\n'
            '<h1 class="mm-trunc" style="flex: 1; margin: 0 4px; font-size: 16px; line-height: 24px; font-weight: 600">%s</h1>\n%s\n</header>') % (
        href, aria, svg(ICONS['back'], 20), title, right)

def expand(t, phone=False):
    t = re.sub(r'@@I:([^@]+?)@@', icon, t)
    t = re.sub(r'@@SECTIONS:(\w+)@@', lambda mm: sections(mm.group(1), phone), t)
    t = t.replace('@@DTOAST@@', DTOAST).replace('@@TABBAR@@', TABBAR).replace('@@PHEADER@@', PHEADER)
    t = t.replace('@@PTOAST@@', PTOAST.replace('@@BOTTOM@@', '76px')).replace('@@PTOAST0@@', PTOAST.replace('@@BOTTOM@@', '84px'))
    t = t.replace('@@PCOMBO@@', PCOMBO_DRAWER)
    assert '@@' not in t, re.findall(r'@@[^@]*@@', t)[:3]
    return t

SHARED = open('inv/shared.js', encoding='utf-8').read()

def write(name, head, body, js, props, root):
    out = head + body + "\n<script type=\"text/x-dc\" data-dc-script data-props='" + json.dumps(props, ensure_ascii=False, separators=(',', ':')).replace("'", '\\u0027') + "'>\nvar ROOT = '" + root + "';\n" + SHARED + js + "</script>\n</body>\n</html>\n"
    open(P + name + '.dc.html', 'w', encoding='utf-8').write(out)

def props(options, default, phone=False):
    p = {"startOn": {"editor": "enum", "options": options, "default": default}, "dark": {"editor": "boolean", "default": False},
         "font": {"editor": "enum", "options": ["Inter", "Geist"], "default": "Inter"}}
    p["$preview"] = {"width": 390, "height": 844} if phone else {"width": 1440, "height": 900}
    return p

PAGES = {}
def page(fn):
    PAGES[fn.__name__] = fn; return fn

if __name__ == '__main__':
    sys.path.insert(0, 'inv')
    import pages
    which = sys.argv[1:] or list(pages.ALL)
    for w in which:
        pages.ALL[w]()
        print('built', w)
