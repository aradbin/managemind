from wbuild import *
sys.path.insert(0, 'set')
from spages import chipsb, statusline, inp, flagsw

def overview():
    icons = ''.join('<sc-if value="{{c.is_%s}}" hint-placeholder-val="{{false}}">%s</sc-if>' % (k, svg(ICONS[k], 16)) for k in ['palette', 'file', 'sliders'])
    cards = ('<div class="mm-wcards"><sc-for list="{{cards}}" as="c" hint-placeholder-count="3"><a href="{{c.href}}" class="mm-scard" style="flex-direction: column; gap: 10px"><span class="mm-sico">' + icons + '</span>'
             '<span style="display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 600">{{c.title}}</span><span class="mm-muted" style="font-size: 13px; line-height: 18px">{{c.desc}}</span></span>'
             '<span style="font-size: 12px; font-weight: 500; color: {{c.color}}">{{c.status}}</span></a></sc-for></div>')
    store = card('mm-c-ws', 'Your store', '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px">' + svg(ICONS['globe'], 16, 'flex: none; color: var(--muted-foreground)') +
                 '<span class="mm-mono" style="flex: 1; min-width: 180px">www.nakshifashion.com.bd</span><button type="button" class="mm-btn mm-ghost" style="height: 32px" onClick="{{copy}}">' + svg(ICONS['copy'], 14) + 'Copy link</button></div>'
                 '<sc-if value="{{live}}" hint-placeholder-val="{{true}}"><p class="mm-muted" style="margin: 0; font-size: 13px; display: flex; align-items: center; gap: 6px">' + svg(ICONS['ok'], 14, 'color: var(--success)') + 'Open for orders and shown in search engines.</p></sc-if>'
                 '<sc-if value="{{notLive}}" hint-placeholder-val="{{false}}"><div class="mm-banner" style="font-size: 13px">' + svg(ICONS['alert']) + '<p style="margin: 0">Search engines don’t list your store yet. Turn it on in Store settings when you’re ready.</p></div></sc-if>', gap='12px')
    act = '<a href="#" class="mm-btn mm-outline">' + svg(ICONS['external']) + 'View store</a>'
    wpage('OnlineStore', 'overview', 'Online store', 'How your store looks to shoppers, its pages and settings.', store + cards, js=wread('overview.js'), actions=act, bar=False, crumbs=[('Online store', '')],
          phone_top='<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600">Online store</h1>' + act + '</div>')

def pages():
    newmenu = ('<div style="position: relative; display: flex"><button type="button" class="mm-btn mm-primary" aria-haspopup="menu" aria-expanded="{{menuAria}}" onClick="{{toggleNew}}">' + svg(ICONS['plus']) + 'New page' + svg(ICONS['down']) + '</button>'
               '<sc-if value="{{menuOpen}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close menu" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button>'
               '<div role="menu" aria-label="New page" class="mm-menu" onKeyDown="{{escClose}}" style="top: 40px; right: 0; width: 240px"><sc-for list="{{kinds}}" as="k" hint-placeholder-count="7">'
               '<sc-if value="{{k.free}}" hint-placeholder-val="{{true}}"><a href="{{k.href}}" role="menuitem" class="mm-cmd-item">{{k.label}}</a></sc-if>'
               '<sc-if value="{{k.taken}}" hint-placeholder-val="{{false}}"><span role="menuitem" aria-disabled="true" class="mm-cmd-item" style="opacity: .5; cursor: default"><span style="flex: 1">{{k.label}}</span><span style="font-size: 12px">{{k.note}}</span></span></sc-if></sc-for></div></sc-if></div>')
    menu = dmenu('r.menuOpen', 'r.toggleMenu', 'r.menuAria', [('link', 'Edit', '{{r.href}}', 'pencil'), ('View in the store', 'r.view', 'external'), ('Hide', 'r.toggle', 'eye', 'r.isPub'), ('Publish', 'r.toggle', 'check', 'r.isHidden'), 'sep', ('Delete page', 'r.del', 'trash', True)], width=190)
    rows_d = ('<div style="border: 1px solid var(--border); border-radius: 12px; background: var(--card)"><div style="display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 110px 120px 36px; align-items: center; gap: 12px; height: 38px; padding: 0 12px 0 16px; background: var(--muted); border-radius: 12px 12px 0 0; font-size: 13px; font-weight: 500; color: var(--muted-foreground)"><span>Title</span><span>Page</span><span>Status</span><span>Updated</span><span></span></div>'
              '<sc-for list="{{rows}}" as="r" hint-placeholder-count="6"><div class="mm-row" style="display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 110px 120px 36px; align-items: center; gap: 12px; min-height: 56px; padding: 0 12px 0 16px; border-top: 1px solid var(--border)">'
              '<span style="display: flex; flex-direction: column; min-width: 0"><a href="{{r.href}}" class="mm-rowlink" aria-label="{{r.aria}}">{{r.title}}</a><span class="mm-trunc mm-muted" style="font-size: 13px">{{r.titleBn}}</span></span><span class="mm-muted">{{r.kind}}</span><span>' + sbadge('r.chip') + '</span><span class="mm-muted" style="font-size: 13px">{{r.updated}}</span>' + menu + '</div></sc-for></div>'
              '<p class="mm-muted" style="margin: 0; font-size: 13px">{{count}}. A store has at most 30 pages.</p>')
    rows_p = ('<ul class="mm-plist" aria-label="Pages"><sc-for list="{{rows}}" as="r" hint-placeholder-count="6"><li><div class="mm-prow" style="gap: 10px; min-height: 64px; padding: 8px 4px 8px 12px">'
              '<a href="{{r.href}}" class="mm-rowlink" aria-label="{{r.aria}}" style="display: flex; flex-direction: column"><span class="mm-trunc">{{r.title}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; font-weight: 400">{{r.kind}} · {{r.titleBn}}</span></a>' + sbadge('r.chip') + '</div></li></sc-for></ul>')
    extra_d = '\n' + palert('dl.open', '{{dl.title}}', '<p style="margin: 0">Its address stops working.</p>', 'closeAll', 'dl.confirm', 'Delete')
    extra_p = '\n' + phalert('dl.open', '{{dl.title}}', '<p style="margin: 0">Its address stops working.</p>', 'closeAll', 'dl.confirm', 'Delete')
    wpage('StorePages', 'pages', 'Pages', 'About, contact, your policies and other pages. They’re listed in the store’s footer.', rows_d, rows_p, js=wread('pages.js'), extra_d=extra_d, extra_p=extra_p, actions=newmenu, bar=False, back='OnlineStore')

def page():
    tool = ('<div class="mm-tool" role="toolbar" aria-label="Formatting">' + ''.join('<button type="button" class="mm-btn mm-ghost mm-icon" style="width: 30px; height: 30px" aria-label="%s" onClick="{{format}}">%s</button>' % (a, svg(ICONS[i], 15)) for a, i in [('Bold', 'bold'), ('Italic', 'italic'), ('Heading', 'heading'), ('List', 'list'), ('Link', 'link')]) + '</div>')
    content = ('<sc-if value="{{notTemplate}}" hint-placeholder-val="{{true}}"><div class="mm-field"><span class="mm-label">Content</span><div>' + tool +
               '<sc-if value="{{isBn}}" hint-placeholder-val="{{true}}"><textarea class="mm-textarea" aria-label="Content in Bangla" style="min-height: 220px" value="{{f.bodyBn.value}}" onChange="{{f.bodyBn.on}}"></textarea></sc-if>'
               '<sc-if value="{{isEn}}" hint-placeholder-val="{{false}}"><textarea class="mm-textarea" aria-label="Content in English" style="min-height: 220px" value="{{f.bodyEn.value}}" onChange="{{f.bodyEn.on}}"></textarea></sc-if></div></div></sc-if>'
               '<sc-if value="{{isTemplate}}" hint-placeholder-val="{{false}}"><div class="mm-note" style="flex-direction: column; align-items: stretch; gap: 10px"><p style="margin: 0; font-size: 13px">This page is filled from your store’s details and settings (returns, delivery zones, payment) and changes when they do. Its wording is a draft for your own legal review.</p>'
               '<ul style="margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px"><sc-for list="{{tplLines}}" as="tl" hint-placeholder-count="3"><li>{{tl.text}}</li></sc-for></ul>'
               '<button type="button" class="mm-btn mm-outline" style="align-self: flex-start; height: 32px; background: var(--background)" onClick="{{editTpl}}">' + svg(ICONS['pencil'], 14) + 'Edit the text myself</button></div></sc-if>')
    body = '\n'.join([
        card('mm-c-pg', 'Page', '\n'.join(['<div style="display: flex; align-items: center; gap: 8px">' + chipsb('langs', 'pl', 2) + '</div>',
             '<sc-if value="{{isBn}}" hint-placeholder-val="{{true}}">' + text('mm-pg-tb', 'Title in Bangla', 'titleBn') + '</sc-if><sc-if value="{{isEn}}" hint-placeholder-val="{{false}}">' + text('mm-pg-te', 'Title in English', 'titleEn') + '</sc-if>', content])),
        card('mm-c-pv', 'Visibility', '\n'.join([sw('Published', 'published', 'Shown in the store and its footer'),
             '<div class="mm-field"><label class="mm-label" for="mm-pg-sl">Web address</label><input id="mm-pg-sl" class="mm-input" value="{{f.slug.value}}" onChange="{{f.slug.on}}"><p class="mm-hint">{{url}}. Made from the title when left empty. Old addresses keep working.</p></div>'])),
        '<button type="button" class="mm-btn mm-ghost mm-danger" style="align-self: flex-start" onClick="{{askDelete}}">' + svg(ICONS['trash']) + 'Delete page</button>'])
    extra_d = '\n' + palert('dl.open', '{{dl.title}}', '<p style="margin: 0">Its address stops working.</p>', 'closeAll', 'dl.confirm', 'Delete')
    extra_p = '\n' + phalert('dl.open', '{{dl.title}}', '<p style="margin: 0">Its address stops working.</p>', 'closeAll', 'dl.confirm', 'Delete')
    wpage('StorePage', 'pages', '{{title}}', 'Changes can take a minute to appear on your store.', body, js=wread('page.js'), extra_d=extra_d, extra_p=extra_p, back='StorePages',
          actions='<a href="#" class="mm-btn mm-outline">' + svg(ICONS['external']) + 'View</a>', crumbs=[('Online store', 'OnlineStore.dc.html'), ('Pages', 'StorePages.dc.html'), ('{{title}}', '')])

def settings():
    body = '\n'.join([
        card('mm-c-se', 'Search engines', '\n'.join([sw('Let search engines show my store', 'indexing', 'Turn this on when your store is ready for shoppers. Until then Google won’t list it.'),
             '<sc-if value="{{notIndexed}}" hint-placeholder-val="{{false}}"><div class="mm-banner" style="font-size: 13px">' + svg(ICONS['alert']) + '<p style="margin: 0">Google won’t list your store while this is off.</p></div></sc-if>'])),
        card('mm-c-nu', 'Digits for prices and dates', radios('mm-l-nu', 'Show', 'numerals', 'nu', 3).replace('<p id="mm-l-nu" class="mm-label" style="margin: 0 0 8px">Show</p>', '<p id="mm-l-nu" class="mm-sr">Digits</p>')),
        card('mm-c-tr', 'Tracking', '\n'.join([grid(text('mm-tr-px', 'Meta Pixel ID', 'pixel', mode='numeric', hint='15 or 16 digits, from Meta Events Manager.'), text('mm-tr-ga', 'Google Analytics 4 measurement ID', 'ga4', hint='Looks like G-XXXXXXXXXX.')),
             text('mm-tr-cb', 'Cookie banner', 'consent', optional=True, area=True, ph='We use cookies to understand what shoppers like.', hint='Shown when you set a tracking ID. Leave empty for the standard wording.')]), sub='Tags load only after a shopper accepts cookies.'),
        card('mm-c-ch', 'Chat buttons', '\n'.join([grid(text('mm-ch-wa', 'WhatsApp number', 'whatsapp', typ='tel', mode='tel'), text('mm-ch-ms', 'Messenger page username', 'messenger', hint='As in m.me/yourpage.')),
             text('mm-ch-gr', 'Greeting', 'greeting', hint='The first line of the message. On product pages, the product’s name and link follow.'), radios('mm-l-cs', 'Show the buttons', 'shows', 'cs', 3)])),
        card('mm-c-ho', 'Holiday mode', '\n'.join([sw('Set holiday dates', 'holiday'),
             '<sc-if value="{{holidayOn}}" hint-placeholder-val="{{false}}">' + '\n'.join([grid(text('mm-ho-s', 'Starts (Dhaka time)', 'hStart', typ='datetime-local'), text('mm-ho-e', 'Ends (Dhaka time)', 'hEnd', typ='datetime-local', invalid='dateBad', err=('dateBad', 'The end must come after the start.'))),
             text('mm-ho-n', 'Notice', 'hNote', hint='Shown on every page during the holiday, in place of the announcement bar.')]) + '</sc-if>']), sub='Shows a notice during your holiday, for example Eid. Orders pause during these dates.')])
    wpage('StoreSettings', 'settings', 'Store settings', 'Search engines, tracking, cookies, chat buttons and holiday mode.', body, js=wread('settings.js'), back='OnlineStore')

ALL = {'overview': overview, 'pages': pages, 'page': page, 'settings': settings}

# ======================================================================
# Theme
# ======================================================================
def acc(k, body):
    return ('<section class="mm-acc"><button type="button" aria-expanded="{{a.%s.aria}}" onClick="{{a.%s.toggle}}"><span style="flex: 1">{{a.%s.title}}</span>' % (k, k, k)
            + '<sc-if value="{{a.%s.open}}" hint-placeholder-val="{{false}}">%s</sc-if><sc-if value="{{a.%s.open}}" hint-placeholder-val="{{true}}"></sc-if>' % (k, svg(ICONS['up'], 16, 'opacity: .6'), k)
            + '</button><sc-if value="{{a.%s.open}}" hint-placeholder-val="{{false}}"><div>%s</div></sc-if></section>' % (k, body))

def swt(label, p, hint=''):
    hh = '<span>%s</span>' % hint if hint else ''
    return ('<div class="mm-swrow" style="align-items: flex-start; min-height: 0"><span class="mm-swtext"><span>%s</span>%s</span><button type="button" role="switch" class="mm-switch" aria-label="%s" aria-checked="{{%s.aria}}" onClick="{{%s.toggle}}" style="background: {{%s.bg}}; margin-top: 2px"><span class="mm-knob" style="transform: translateX({{%s.x}})"></span></button></div>'
            % (label, hh, label, p, p, p, p))

def theme_editor():
    preset = ('<p class="mm-muted" style="margin: 0; font-size: 13px">A preset replaces your draft’s colours and homepage. Your logo stays.</p><div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px"><sc-for list="{{presets}}" as="ps" hint-placeholder-count="3">'
              '<button type="button" class="mm-mode" style="flex-direction: column; align-items: flex-start; gap: 8px" aria-label="{{ps.aria}}" onClick="{{ps.pick}}"><span style="display: flex; gap: 4px"><sc-for list="{{ps.dots}}" as="dt" hint-placeholder-count="3"><span style="width: 14px; height: 14px; border-radius: 9999px; background: {{dt.bg}}; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .1)"></span></sc-for></span>{{ps.label}}</button></sc-for></div>')
    colors = ('<sc-for list="{{colors}}" as="cl" hint-placeholder-count="7"><div class="mm-crow"><span class="mm-swatch" style="background: {{cl.value}}"></span><label class="mm-label" for="{{cl.id}}" style="font-weight: 400; font-size: 13px">{{cl.label}}</label>'
              '<input id="{{cl.id}}" class="mm-input mm-mono" value="{{cl.value}}" onChange="{{cl.on}}" style="height: 32px; font-size: 13px"></div></sc-for>'
              '<sc-if value="{{lowContrast}}" hint-placeholder-val="{{false}}"><div class="mm-banner" role="alert" style="font-size: 13px">' + svg(ICONS['alert']) + '<p style="margin: 0">{{contrastText}}</p></div></sc-if>')
    typ = radios('mm-l-tf', 'Font', 'fonts', 'tf', 3) + '<div class="mm-field"><span class="mm-label" id="mm-l-tr">Corners</span>' + chipsb('radii', 'trd', 3, 'mm-l-tr') + '</div>'
    logo = ''.join('<div class="mm-up"><span class="mm-thumb2" style="width: 44px; height: 44px; font-weight: 700; font-size: %s; color: #7a1f3d; background: #f6ece6">%s</span><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span style="font-weight: 500">%s</span><span class="mm-muted" style="font-size: 12px">%s</span></span><button type="button" class="mm-btn mm-outline" style="height: 32px">Replace</button></div>'
                   % (sz, mark, lab, meta) for lab, meta, mark, sz in [('Logo', 'nakshi-logo.png · 600 × 200', 'নকশী', '12px'), ('Browser tab icon', 'favicon.png · 64 × 64', 'ন', '18px')])
    ann = swt('Show an announcement bar', 'annSw', 'A line shown on every page, such as a delivery offer. Holiday mode takes its place during its dates.') + '<sc-if value="{{annOn}}" hint-placeholder-val="{{true}}"><div class="mm-field"><label class="mm-label" for="mm-th-an">Text</label><input id="mm-th-an" class="mm-input" value="{{annText}}" onChange="{{onAnn}}"></div></sc-if>'
    hero_form = ('<sc-if value="{{sc.isHero}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-direction: column; gap: 12px; padding: 12px; border: 1px solid var(--border); border-top: 0; border-radius: 0 0 8px 8px; margin-top: -6px">'
                 '<div class="mm-field"><label class="mm-label" for="mm-hh">Heading (Bangla)</label><input id="mm-hh" class="mm-input" value="{{hero.heading}}" onChange="{{hero.onHeading}}"></div>'
                 '<div class="mm-field"><label class="mm-label" for="mm-hs">Line under the heading (Bangla)</label><input id="mm-hs" class="mm-input" value="{{hero.sub}}" onChange="{{hero.onSub}}"></div>'
                 '<div class="mm-field"><label class="mm-label" for="mm-hb">Button text (Bangla)</label><input id="mm-hb" class="mm-input" value="{{hero.button}}" onChange="{{hero.onButton}}"></div>'
                 '<div class="mm-field"><span class="mm-label" id="mm-l-hl">Goes to</span>' + chipsb('hero.links', 'hl', 5, 'mm-l-hl') + '</div>'
                 '<div class="mm-field"><span class="mm-label" id="mm-l-hz">Size</span>' + chipsb('hero.sizes', 'hz', 2, 'mm-l-hz') + '</div>'
                 '<div class="mm-up">' + svg(ICONS['image'], 20, 'flex: none; color: var(--muted-foreground)') + '<span style="flex: 1; font-size: 13px">eid-banner-2026.jpg</span><button type="button" class="mm-btn mm-outline" style="height: 30px">Replace</button></div></div></sc-if>'
                 '<sc-if value="{{sc.notHero}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: -6px 0 0; padding: 10px 12px; border: 1px solid var(--border); border-top: 0; border-radius: 0 0 8px 8px; font-size: 13px">Options for this section open here.</p></sc-if>')
    sections = ('<p class="mm-muted" style="margin: 0; font-size: 13px">Up to 12 sections, shown in this order.</p><div style="display: flex; flex-direction: column; gap: 6px"><sc-for list="{{secs}}" as="sc" hint-placeholder-count="4"><div style="display: flex; flex-direction: column">'
                '<div class="mm-secrow" data-open="{{sc.open}}"><button type="button" aria-expanded="{{sc.open}}" onClick="{{sc.toggle}}" style="flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 500; text-align: left; cursor: pointer">{{sc.name}}</button>'
                '<button type="button" class="mm-btn mm-ghost mm-icon" style="width: 28px; height: 28px" aria-label="{{sc.upAria}}" disabled="{{sc.upDis}}" onClick="{{sc.up}}">' + svg(ICONS['up'], 14) + '</button>'
                '<button type="button" class="mm-btn mm-ghost mm-icon" style="width: 28px; height: 28px" aria-label="{{sc.downAria}}" disabled="{{sc.downDis}}" onClick="{{sc.down}}">' + svg(ICONS['down'], 14) + '</button>'
                '<button type="button" class="mm-btn mm-ghost mm-icon" style="width: 28px; height: 28px" aria-label="{{sc.removeAria}}" onClick="{{sc.remove}}">' + svg(ICONS['x'], 14) + '</button></div>' + hero_form + '</div></sc-for></div>'
                '<div style="position: relative"><button type="button" class="mm-addrow" aria-haspopup="menu" aria-expanded="{{addAria}}" disabled="{{atLimit}}" onClick="{{toggleAdd}}">' + svg(ICONS['plus']) + 'Add a section</button>'
                '<sc-if value="{{addOpen}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close menu" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button><div role="menu" aria-label="Add a section" class="mm-menu" onKeyDown="{{escClose}}" style="top: 44px; left: 0; width: 220px"><sc-for list="{{addTypes}}" as="at" hint-placeholder-count="7"><button type="button" role="menuitem" class="mm-cmd-item" onClick="{{at.pick}}">{{at.label}}</button></sc-for></div></sc-if></div>')
    cards = '<div class="mm-field"><span class="mm-label" id="mm-l-cs">Image shape</span>' + chipsb('shapes', 'csh', 2, 'mm-l-cs') + '</div>' + swt('Show the regular price next to a sale price', 'compare') + swt('Show the brand', 'brand')
    prod = swt('Show related products', 'related') + radios('mm-l-sp3', 'Specifications', 'specs', 'spx', 2)
    return '\n'.join([acc('preset', preset), acc('colors', colors), acc('type', typ), acc('logo', logo), acc('ann', ann), acc('sections', sections), acc('cards', cards), acc('product', prod)])

def shop_preview():
    T = 'th'
    return ('<div class="mm-shop" style="width: {{pv.width}}; max-width: 100%; background: {{th.bg}}; color: {{th.text}}; font-family: {{th.font}}; font-size: 14px; line-height: 20px">'
            '<sc-if value="{{annOn}}" hint-placeholder-val="{{true}}"><div style="padding: 6px 12px; background: {{th.primary}}; color: {{th.onPrimary}}; text-align: center; font-size: 12px">{{annText}}</div></sc-if>'
            '<div style="display: flex; align-items: center; gap: 16px; padding: 14px 20px; border-bottom: 1px solid {{th.border}}"><span style="font-weight: 700; font-size: 20px; color: {{th.primary}}">নকশী</span>'
            '<sc-if value="{{pv.nav}}" hint-placeholder-val="{{true}}"><span style="display: flex; gap: 16px; font-size: 13px; color: {{th.muted}}"><span>পাঞ্জাবি</span><span>কুর্তি</span><span>শাড়ি</span><span>থ্রি-পিস</span></span></sc-if><span style="flex: 1"></span>' + svg(ICONS['search'], 18) + svg(ICONS['cart'], 18) + '</div>'
            '<sc-for list="{{blocks}}" as="bl" hint-placeholder-count="4">'
            '<sc-if value="{{bl.hero}}" hint-placeholder-val="{{true}}"><div style="display: flex; flex-direction: column; justify-content: center; gap: 10px; min-height: {{pv.heroH}}; padding: 24px 28px; background: linear-gradient(120deg, {{th.surface}}, color-mix(in oklch, {{th.accent}} 35%, {{th.surface}}))">'
            '<span style="font-size: {{pv.heroSize}}; line-height: 1.2; font-weight: 700">{{heroH.heading}}</span><span style="max-width: 420px; color: {{th.muted}}">{{heroH.sub}}</span>'
            '<sc-if value="{{heroH.hasButton}}" hint-placeholder-val="{{true}}"><span style="align-self: flex-start; padding: 8px 18px; border-radius: {{th.radius}}; background: {{th.primary}}; color: {{th.onPrimary}}; font-weight: 600">{{heroH.button}}</span></sc-if></div></sc-if>'
            '<sc-if value="{{bl.cats}}" hint-placeholder-val="{{false}}"><div style="display: grid; grid-template-columns: {{pv.cols}}; gap: 10px; padding: 20px"><sc-for list="{{cats}}" as="ct2" hint-placeholder-count="4"><div style="display: flex; align-items: flex-end; height: 90px; padding: 10px; border-radius: {{th.radius}}; background: {{ct2.bg}}; font-weight: 600">{{ct2.label}}</div></sc-for></div></sc-if>'
            '<sc-if value="{{bl.prods}}" hint-placeholder-val="{{true}}"><div style="display: flex; flex-direction: column; gap: 12px; padding: 8px 20px 20px"><span style="font-size: 17px; font-weight: 700">{{bl.title}}</span><div style="display: grid; grid-template-columns: {{pv.cols}}; gap: 12px"><sc-for list="{{products}}" as="pp2" hint-placeholder-count="4">'
            '<div style="display: flex; flex-direction: column; gap: 6px"><div style="position: relative; height: {{pv.imgH}}; border-radius: {{th.radius}}; background: {{pp2.bg}}"><sc-if value="{{pp2.sale}}" hint-placeholder-val="{{false}}"><span style="position: absolute; top: 8px; left: 8px; padding: 2px 6px; border-radius: 4px; background: {{th.sale}}; color: #fff; font-size: 11px; font-weight: 600">Sale</span></sc-if></div>'
            '<sc-if value="{{pp2.brand}}" hint-placeholder-val="{{false}}"><span style="font-size: 11px; color: {{th.muted}}">Nakshi</span></sc-if><span style="font-size: 13px">{{pp2.name}}</span><span style="display: flex; gap: 6px; font-size: 13px"><span style="font-weight: 700">{{pp2.price}}</span><sc-if value="{{pp2.sale}}" hint-placeholder-val="{{false}}"><span style="text-decoration: line-through; color: {{th.muted}}">{{pp2.was}}</span></sc-if></span></div></sc-for></div></div></sc-if>'
            '<sc-if value="{{bl.trust}}" hint-placeholder-val="{{false}}"><div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 16px 20px; background: {{th.surface}}"><sc-for list="{{trust}}" as="tt2" hint-placeholder-count="3"><div style="display: flex; flex-direction: column; gap: 2px; text-align: center"><span style="font-weight: 600; font-size: 13px; color: {{th.primary}}">{{tt2.title}}</span><span style="font-size: 12px; color: {{th.muted}}">{{tt2.text}}</span></div></sc-for></div></sc-if>'
            '<sc-if value="{{bl.text}}" hint-placeholder-val="{{false}}"><div style="padding: 20px; color: {{th.muted}}">আমাদের তাঁতিদের গল্প এখানে লিখুন।</div></sc-if></sc-for>'
            '<div style="padding: 16px 20px; background: {{th.surface}}; color: {{th.muted}}; font-size: 12px; border-top: 1px solid {{th.border}}">আমাদের কথা · যোগাযোগ · রিটার্ন · ডেলিভারি · গোপনীয়তা নীতি</div></div>')

def theme():
    sizes = ('<div role="radiogroup" aria-label="Preview size" class="mm-tabs"><sc-for list="{{sizes}}" as="sz" hint-placeholder-count="2"><button type="button" role="radio" class="mm-tab" aria-checked="{{sz.aria}}" aria-pressed="{{sz.pressed}}" aria-label="{{sz.label}}" onClick="{{sz.pick}}">'
             '<sc-if value="{{sz.isMonitor}}" hint-placeholder-val="{{true}}">' + svg(ICONS['monitor'], 15) + '</sc-if><sc-if value="{{sz.isPhone}}" hint-placeholder-val="{{false}}">' + svg(ICONS['smartphone'], 15) + '</sc-if></button></sc-for></div>')
    top = ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px 20px">'
           '<a href="OnlineStore.dc.html" class="mm-btn mm-ghost mm-icon" aria-label="Back to online store" style="margin-left: -8px">' + svg(ICONS['back']) + '</a>'
           '<div style="display: flex; flex-direction: column; min-width: 0"><h1 style="margin: 0; font-size: 18px; line-height: 24px; font-weight: 600">Theme</h1>'
           '<span style="display: flex; align-items: center; gap: 6px; font-size: 12px"><sc-if value="{{dirty}}" hint-placeholder-val="{{true}}"><span class="mm-warn" style="font-weight: 500">{{status}}</span><span class="mm-muted">· {{saved}}</span></sc-if><sc-if value="{{clean}}" hint-placeholder-val="{{false}}"><span class="mm-muted">{{status}}</span></sc-if></span></div>'
           '<span style="flex: 1"></span>' + sizes + '<a href="#" class="mm-btn mm-outline">' + svg(ICONS['external']) + 'View store</a><button type="button" class="mm-btn mm-primary" disabled="{{clean}}" onClick="{{askPublish}}">Publish</button></div>')
    d = '\n'.join(['<main style="flex: 1; min-height: 0; display: flex; flex-direction: column; min-width: 0">', top,
                   '<div class="mm-tgrid"><div class="mm-tedit">' + theme_editor() + '</div><div class="mm-tprev" aria-label="Preview of your store">' + shop_preview() + '</div></div></main>', '</div>'])
    dialogs_d = ('\n' + palert('pd.open', '{{pd.title}}', '<p style="margin: 0">This replaces your draft’s colours, fonts and homepage sections. Published changes stay until you publish again.</p>', 'closeAll', 'pd.confirm', 'Use this preset', danger=False)
                 + '\n' + palert('pub.open', 'Publish these changes?', '<p style="margin: 0">Shoppers will see the new look within a minute.</p>', 'closeAll', 'pub.confirm', 'Publish', danger=False))
    d += dialogs_d + XEND
    right = '<button type="button" class="mm-btn mm-primary" style="height: 32px; margin-right: 4px" disabled="{{clean}}" onClick="{{askPublish}}">Publish</button>'
    ph = '\n'.join([PROOT % 'var(--page)', phone_back('OnlineStorePhone.dc.html', 'Back to online store', 'Theme', right), '<main class="mm-scroll" style="gap: 10px; padding: 12px">',
                    '<sc-if value="{{dirty}}" hint-placeholder-val="{{true}}"><p class="mm-warn" style="margin: 0; font-size: 13px; font-weight: 500">{{status}}</p></sc-if><sc-if value="{{clean}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; font-size: 13px">{{status}}</p></sc-if>',
                    theme_editor(), '</main>',
                    '<div style="flex: none; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--background)"><button type="button" class="mm-btn mm-outline" style="width: 100%" aria-haspopup="dialog" onClick="{{openPreview}}">' + svg(ICONS['eye']) + 'Preview</button></div>'])
    ph += '\n<sc-if value="{{previewOpen}}" hint-placeholder-val="{{false}}"><div class="mm-layer" style="z-index: 60; background: var(--page); display: flex; flex-direction: column"><div role="dialog" aria-modal="true" aria-label="Preview of your store" style="display: flex; flex-direction: column; height: 100%">' + phone_back('#', 'Close preview', 'Preview').replace('<a href="#" class="mm-btn mm-ghost mm-icon" aria-label="Close preview">', '<button type="button" class="mm-btn mm-ghost mm-icon" aria-label="Close preview" onClick="{{closePreview}}">').replace(svg(ICONS['back'], 20) + '</a>', svg(ICONS['x'], 20) + '</button>') + '<div style="flex: 1; min-height: 0; overflow-y: auto">' + shop_preview().replace('class="mm-shop"', 'class="mm-shop" data-p="1"').replace('box-shadow', 'x') + '</div></div></div></sc-if>'
    ph += '\n' + phalert('pd.open', '{{pd.title}}', '<p style="margin: 0">This replaces your draft’s colours, fonts and homepage sections. Published changes stay until you publish again.</p>', 'closeAll', 'pd.confirm', 'Use this preset', danger=False)
    ph += '\n' + phalert('pub.open', 'Publish these changes?', '<p style="margin: 0">Shoppers will see the new look within a minute.</p>', 'closeAll', 'pub.confirm', 'Publish', danger=False)
    ph += '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    js = wread('theme.js'); opts = js_starts(js)
    jsall = RSHARED + sread('shared.js') + js
    head = wdhead('theme', [('Online store', 'OnlineStore.dc.html'), ('Theme', '')], 'Theme')
    write('Theme', head, rexpand(d), jsall, props(opts, opts[0]), 'mm mm-root')
    write('ThemePhone', wphead('Theme'), expand(ph, True), jsall, props(opts, opts[0], True), 'mm')

ALL['theme'] = theme
