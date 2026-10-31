from build import *

def read(n): return open('inv/' + n, encoding='utf-8').read()

PROOT = '<div class="{{themeClass}}" style="position: relative; display: flex; flex-direction: column; width: 390px; height: 844px; overflow: hidden; background: %s; color: var(--foreground); font-family: {{fontStack}}; font-size: 14px; line-height: 20px">'
MAIN = '<main class="mm-scroll" style="flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 16px; min-width: 0">'

def dtop(title, actions, sec):
    return '\n'.join([MAIN, '',
        '<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px">',
        '<h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">%s</h1>' % title,
        '<div style="display: flex; flex-wrap: wrap; gap: 8px">', actions, '</div>', '</div>', '', '@@SECTIONS:%s@@' % sec, ''])

DEND = '\n</main>\n</div>\n'
XEND = '\n@@DTOAST@@\n\n</div>\n</x-dc>\n'

def ptop(title, action, sec):
    return '\n'.join([PROOT % 'var(--background)', '', '@@PHEADER@@', '', '<main class="mm-scroll" style="gap: 12px; padding: 16px">',
        '<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">',
        '<h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">%s</h1>' % title,
        action, '</div>', '@@SECTIONS:%s@@' % sec, ''])

PEND = '\n</main>\n\n@@TABBAR@@\n'
PXEND = '\n@@PTOAST@@\n\n</div>\n</x-dc>\n'

def search(ph, val='q', on='onQ', width=280, phone=False):
    inp = '<input type="search" class="mm-input" aria-label="%s" placeholder="%s" value="{{%s}}" onChange="{{%s}}" style="%s">' % (
        ph, ph, val, on, 'padding-left: 36px' if phone else 'height: 32px; padding-left: 32px')
    if phone:
        return '<div style="position: relative; flex: 1; min-width: 0">' + svg(ICONS['search'], 16, 'position: absolute; left: 12px; top: 12px; color: var(--muted-foreground); pointer-events: none') + inp + '</div>'
    return ('<div style="position: relative; width: %dpx; max-width: 100%%">' % width) + svg(ICONS['search'], 16, 'position: absolute; left: 10px; top: 8px; color: var(--muted-foreground); pointer-events: none') + inp + '</div>'

RESET = '<sc-if value="{{hasFilters}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-ghost" onClick="{{clearAll}}" style="padding: 0 8px">Reset' + svg(ICONS['x']) + '</button></sc-if>'

def empty_block(text, button, cond='hasFilters', fn='clearAll', pad='40px 16px'):
    btn = '<sc-if value="{{%s}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" onClick="{{%s}}">%s</button></sc-if>' % (cond, fn, button) if button else ''
    return '<div style="display: flex; flex-direction: column; align-items: center; gap: 12px; padding: %s; text-align: center"><p class="mm-muted" style="margin: 0">%s</p>%s</div>' % (pad, text, btn)

def radio(on):
    return '<span class="mm-radio" aria-hidden="true"><sc-if value="{{%s}}" hint-placeholder-val="{{false}}"><span class="mm-dot"></span></sc-if></span>' % on

# ======================================================================
# Stock
# ======================================================================
def stock_adjust_body(phone):
    gap = '16px'
    modes = ('<div role="radiogroup" aria-labelledby="mm-aj-what" style="display: flex; flex-direction: column; gap: 12px"><sc-for list="{{aj.groups}}" as="g" hint-placeholder-count="3"><div>'
             '<p class="mm-mgroup">{{g.label}}</p><div class="mm-modes"><sc-for list="{{g.modes}}" as="m" hint-placeholder-count="3"><button type="button" role="radio" class="mm-mode" aria-checked="{{m.aria}}" onClick="{{m.pick}}">'
             + radio('m.on') + '<span>{{m.label}}</span></button></sc-for></div></div></sc-for></div>')
    return '\n'.join([
        '<div class="mm-note" style="font-size: 13px">' + svg(ICONS['package']) + '<p style="margin: 0">{{aj.now}}</p></div>',
        '<div class="mm-field" style="gap: 0"><p id="mm-aj-what" class="mm-label" style="margin: 0 0 10px">What happened</p>' + modes + '</div>',
        '<sc-if value="{{aj.isReceived}}" hint-placeholder-val="{{true}}"><div class="mm-note" style="font-size: 13px">' + svg(ICONS['truck']) + '<p style="margin: 0">Bought new stock? <a href="Receive%s.dc.html" style="font-weight: 500; color: var(--foreground); text-decoration: underline; text-underline-offset: 2px">Use Receive stock instead</a>, so its cost and supplier are kept.</p></div></sc-if>' % ('Phone' if phone else ''),
        '<div class="mm-field"><label class="mm-label" for="mm-aj-qty">{{aj.qtyLabel}}</label><input id="mm-aj-qty" class="mm-input" inputMode="numeric" autoComplete="off" value="{{aj.qty}}" onChange="{{aj.onQty}}" style="font-variant-numeric: tabular-nums">'
        '<sc-if value="{{aj.showPreview}}" hint-placeholder-val="{{false}}"><p class="mm-hint" style="font-weight: 500; color: {{aj.previewColor}}">{{aj.preview}}</p></sc-if>'
        '<sc-if value="{{aj.negative}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">{{aj.negText}}</p></sc-if></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-aj-note">Note <span class="mm-muted" style="font-weight: 400">(optional)</span></label><input id="mm-aj-note" class="mm-input" maxLength="500" value="{{aj.note}}" onChange="{{aj.onNote}}"></div>'])

def stock_history_body():
    return '\n'.join([
        '<section aria-labelledby="mm-hs-cost" style="display: flex; flex-direction: column; gap: 4px">',
        '<h3 id="mm-hs-cost" style="margin: 0; font-size: 14px; font-weight: 600">Cost history</h3>',
        '<sc-if value="{{hs.hasCosts}}" hint-placeholder-val="{{true}}"><ol class="mm-mlist"><sc-for list="{{hs.costs}}" as="c" hint-placeholder-count="2"><li><span class="mm-chg"><span style="font-weight: 500">{{c.source}}</span><span style="font-variant-numeric: tabular-nums">{{c.change}}</span></span><span class="mm-muted" style="font-size: 13px">{{c.meta}}</span></li></sc-for></ol></sc-if>',
        '<sc-if value="{{hs.noCosts}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">No cost changes yet.</p></sc-if>',
        '</section>',
        '<section aria-labelledby="mm-hs-moves" style="display: flex; flex-direction: column; gap: 4px">',
        '<h3 id="mm-hs-moves" style="margin: 0; font-size: 14px; font-weight: 600">Changes</h3>',
        '<ol class="mm-mlist"><sc-for list="{{hs.moves}}" as="mv" hint-placeholder-count="6"><li><span class="mm-chg"><span style="font-weight: 500">{{mv.type}}</span><span style="font-weight: 500; font-variant-numeric: tabular-nums; color: {{mv.color}}">{{mv.qty}}</span></span><span class="mm-muted" style="font-size: 13px">{{mv.meta}}</span><sc-if value="{{mv.hasNote}}" hint-placeholder-val="{{false}}"><span style="font-size: 13px">{{mv.note}}</span></sc-if></li></sc-for></ol>',
        '</section>'])

def stock():
    acts = ('<button type="button" class="mm-btn mm-outline" onClick="{{exportStock}}">@@I:download@@Export</button>\n'
            '<a href="Receive.dc.html" class="mm-btn mm-primary">@@I:truck@@Receive stock</a>')
    d = dtop('Inventory', acts, 'stock') + '\n'.join([
        '<dl class="mm-statrow"><sc-for list="{{stats}}" as="x" hint-placeholder-count="3"><div><dt>{{x.label}}</dt><dd>{{x.value}}</dd></div></sc-for>',
        '<div><dt>Low stock</dt><dd><button type="button" class="mm-statlink" aria-pressed="{{lowPressed}}" aria-label="{{lowStatAria}}" onClick="{{toggleLow}}">{{lowCount}}</button></dd></div></dl>',
        '',
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">',
        search('Search titles and SKUs'),
        '<label style="display: inline-flex; align-items: center; gap: 8px; margin-left: 8px; font-weight: 500; cursor: pointer"><button type="button" role="checkbox" class="mm-check" aria-checked="{{lowAria}}" onClick="{{toggleLow}}" style="background: {{lowBox}}; border-color: {{lowEdge}}"><sc-if value="{{lowOnly}}" hint-placeholder-val="{{false}}">' + svg(ICONS['check'], 14, 'color: var(--primary-foreground)').replace('stroke-width="2"', 'stroke-width="3"') + '</sc-if></button>Low stock only</label>',
        RESET,
        '<span class="mm-muted" style="margin-left: auto; font-size: 13px">{{countText}}</span>',
        '</div>',
        '',
        '<div style="border: 1px solid var(--border); border-radius: 10px">',
        '<div class="mm-sgrid mm-thead" aria-hidden="true"><span>Item</span><span>SKU</span><span class="mm-num">On hand</span><span class="mm-num">Reserved</span><span class="mm-num">Available</span><span></span></div>',
        '<ul aria-label="Stock" style="list-style: none; margin: 0; padding: 0">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="12"><li><div class="mm-sgrid mm-row" style="min-height: 52px">',
        '<span style="display: flex; flex-direction: column; min-width: 0"><button type="button" class="mm-rowlink" aria-haspopup="dialog" aria-label="{{r.histAria}}" onClick="{{r.history}}">{{r.title}}</button><sc-if value="{{r.hasOpts}}" hint-placeholder-val="{{true}}"><span class="mm-trunc mm-muted" style="font-size: 13px">{{r.opts}}</span></sc-if></span>',
        '<span class="mm-trunc mm-muted mm-code">{{r.sku}}</span>',
        '<span class="mm-num">{{r.onHand}}</span>',
        '<span class="mm-num mm-muted">{{r.reserved}}</span>',
        '<span style="display: flex; align-items: center; justify-content: flex-end; gap: 6px"><sc-if value="{{r.isLow}}" hint-placeholder-val="{{false}}"><span class="mm-sbadge mm-sbad">Low</span></sc-if><span style="font-weight: {{r.availWeight}}; color: {{r.availColor}}; font-variant-numeric: tabular-nums">{{r.avail}}</span></span>',
        '<span style="display: flex; align-items: center; justify-content: flex-end; gap: 4px"><sc-if value="{{r.tracked}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline mm-above" aria-haspopup="dialog" aria-label="{{r.adjustAria}}" onClick="{{r.adjust}}" style="height: 28px; padding: 0 10px">Adjust</button></sc-if>',
        dmenu('r.menuOpen', 'r.toggleMenu', 'r.menuAria', [('Adjust stock', 'r.adjust', 'adjust', 'r.tracked'), ('Stock history', 'r.history', 'history'), ('link', 'Open product', 'ProductView.dc.html', 'external')], width=190),
        '</span>',
        '</div></li></sc-for>',
        '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Reset filters') + '</sc-if>',
        '</div>']) + DEND
    adj_save = dfoot_buttons('closeAdj', 'aj.save', 'Save', 'aj.cantSave')
    d += dpanel('aj.open', 'closeAdj', 'mm-aj-title', 'Adjust stock', '{{aj.sub}}', stock_adjust_body(False), '', adj_save[0], adj_save[1])
    d += '\n' + dpanel('hs.open', 'closeHist', 'mm-hs-title', 'Stock history', '{{hs.sub}}', stock_history_body(), '',
                       '<button type="button" class="mm-btn mm-outline" style="height: 36px; padding: 0 16px" onClick="{{closeHist}}">Close</button>',
                       '<button type="button" class="mm-btn mm-primary" style="height: 36px; padding: 0 16px" onClick="{{hs.adjust}}">' + svg(ICONS['adjust']) + 'Adjust stock</button>')
    d += XEND

    ph = ptop('Inventory', '<a href="ReceivePhone.dc.html" class="mm-btn mm-primary">@@I:truck@@Receive</a>', 'stock') + '\n'.join([
        '<dl class="mm-stats2"><sc-for list="{{stats}}" as="x" hint-placeholder-count="3"><div><dt>{{x.label}}</dt><dd>{{x.value}}</dd></div></sc-for><div><dt>Low stock</dt><dd style="color: var(--destructive)">{{lowCount}}</dd></div></dl>',
        '<div style="display: flex; gap: 8px">' + search('Search titles and SKUs', phone=True) +
        '<button type="button" class="mm-btn mm-outline" aria-pressed="{{lowAria}}" onClick="{{toggleLow}}" style="height: 40px; background: {{lowBox}}; border-color: {{lowEdge}}"><sc-if value="{{lowOnly}}" hint-placeholder-val="{{false}}">' + svg(ICONS['check'], 16, 'color: var(--primary-foreground)') + '</sc-if><span style="color: {{lowText}}">Low stock</span></button></div>',
        '<sc-if value="{{hasFilters}}" hint-placeholder-val="{{false}}"><div style="display: flex; align-items: center; justify-content: space-between; margin: -4px 0"><span class="mm-muted" style="font-size: 13px">{{countText}}</span><button type="button" class="mm-btn mm-ghost" style="height: 32px; margin-right: -12px" onClick="{{clearAll}}">Reset</button></div></sc-if>',
        '<ul class="mm-plist" aria-label="Stock">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="10"><li><div class="mm-prow" style="gap: 10px; min-height: 64px; padding: 8px 4px 8px 12px">',
        '<button type="button" class="mm-rowlink" aria-haspopup="dialog" aria-label="{{r.histAria}}" onClick="{{r.history}}"><span class="mm-trunc" style="font-weight: 500">{{r.title}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; line-height: 18px">{{r.sub}}</span></button>',
        '<span style="display: flex; flex-direction: column; align-items: flex-end; flex: none"><span style="font-size: 16px; font-weight: {{r.availWeight}}; color: {{r.availColor}}; font-variant-numeric: tabular-nums">{{r.avail}}</span><sc-if value="{{r.tracked}}" hint-placeholder-val="{{true}}"><span class="mm-muted" style="font-size: 12px; line-height: 16px">available</span></sc-if></span>',
        '<button type="button" class="mm-btn mm-ghost mm-icon mm-above" aria-label="{{r.menuAria}}" aria-haspopup="dialog" onClick="{{r.toggleMenu}}">' + svg(ICONS['dots'], 18) + '</button>',
        '</div></li></sc-for>',
        '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Reset filters', pad='32px 16px') + '</sc-if>',
        '<p class="mm-muted" style="margin: 0; font-size: 13px">Available is on hand less what open orders have reserved.</p>']) + PEND
    ph += pdrawer('menuOpen', 'closeAll', 'mm-mx-title', '{{mxTitle}}', '', '\n'.join([
        '<div role="menu" aria-labelledby="mm-mx-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<sc-if value="{{mx.tracked}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.adjust}}">' + svg(ICONS['adjust'], 18) + 'Adjust stock</button></sc-if>',
        '<button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.history}}">' + svg(ICONS['history'], 18) + 'Stock history</button>',
        '<a href="ProductViewPhone.dc.html" role="menuitem" class="mm-optrow">' + svg(ICONS['external'], 18) + 'Open product</a>',
        '</div>']), '', tall=False)
    ph += '\n' + pdrawer('aj.open', 'closeAdj', 'mm-aj-title', 'Adjust stock', '{{aj.sub}}',
        '<div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 8px 16px 16px">\n' + stock_adjust_body(True) + '\n</div>',
        pfoot('closeAdj', 'aj.save', 'Save', 'aj.cantSave'))
    ph += '\n' + pdrawer('hs.open', 'closeHist', 'mm-hs-title', 'Stock history', '{{hs.sub}}',
        '<div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 8px 16px 16px">\n' + stock_history_body() + '\n</div>',
        '<div style="flex: none; display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border)"><button type="button" class="mm-btn mm-outline" style="flex: 1" onClick="{{closeHist}}">Close</button><button type="button" class="mm-btn mm-primary" style="flex: 2" onClick="{{hs.adjust}}">Adjust stock</button></div>')
    ph += PXEND
    js = read('stock.js')
    opts = ['Stock', 'Low stock only', 'Row menu', 'Adjust stock', 'Adjust: damaged', 'Adjust: counted', 'Stock history']
    write('Inventory', dhead_for('stock', [('Inventory', 'Inventory.dc.html'), ('Stock', '')], 'Inventory'), expand(d), js, props(opts, 'Stock'), 'mm mm-root')
    write('InventoryPhone', phead_for('Inventory'), expand(ph, True), js, props(opts, 'Stock', True), 'mm')

def dfilter(p, name, pop_html, width=240):
    """A dashed '+ Name' filter button; once set, it shows the value."""
    return '\n'.join([
        '<div style="position: relative">',
        '<button type="button" class="mm-btn mm-outline" aria-haspopup="dialog" aria-expanded="{{%s.aria}}" onClick="{{%s.toggle}}" style="border-style: dashed">%s%s<sc-if value="{{%s.has}}" hint-placeholder-val="{{false}}"><span aria-hidden="true" style="width: 1px; height: 16px; margin: 0 2px; background: var(--border)"></span><span class="mm-badge-sec">{{%s.label}}</span></sc-if></button>' % (p, p, svg(ICONS['circleplus']), name, p, p),
        '<sc-if value="{{%s.open}}" hint-placeholder-val="{{false}}">' % p,
        '<button type="button" tabindex="-1" class="mm-scrim" aria-label="Close filter" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button>',
        '<div class="mm-pop" role="dialog" aria-label="Filter by %s" onKeyDown="{{escClose}}" style="top: 36px; width: %dpx">' % (name.lower(), width),
        pop_html, '</div>', '</sc-if>', '</div>'])

def list_pop(p, name, empty, single=True, count=True, clear='Clear filter'):
    cnt = '<span class="mm-code mm-muted">{{o.count}}</span>' if count else ''
    return ('<div class="mm-popsearch">' + svg(ICONS['search'], 16, 'flex: none; opacity: .5') +
            '<input class="mm-cmd-input" aria-label="Find a %s" placeholder="%s" autoComplete="off" autoFocus="{{true}}" value="{{%s.query}}" onChange="{{%s.onQuery}}"></div>' % (name.lower(), name, p, p) +
            '<div role="listbox" aria-label="%s" class="mm-poplist" style="max-height: 300px"><sc-for list="{{%s.items}}" as="o" hint-placeholder-count="6"><button type="button" role="option" aria-selected="{{o.aria}}" class="mm-cmd-item" onClick="{{o.pick}}">' % (name, p) +
            svg(ICONS['check'], 16, 'flex: none; opacity: {{o.check}}; color: var(--foreground)') + '<span class="mm-trunc" style="flex: 1">{{o.label}}</span>' + cnt + '</button></sc-for>' +
            '<sc-if value="{{%s.none}}" hint-placeholder-val="{{false}}"><p class="mm-popempty">%s</p></sc-if></div>' % (p, empty) +
            '<sc-if value="{{%s.has}}" hint-placeholder-val="{{false}}"><div role="separator" class="mm-sep" style="margin: 0"></div><div style="padding: 4px"><button type="button" class="mm-cmd-item" style="justify-content: center" onClick="{{%s.clear}}">%s</button></div></sc-if>' % (p, p, clear))

def date_fields(p, ids, phone=False):
    chips = '<div style="display: flex; flex-wrap: wrap; gap: 6px"><sc-for list="{{%s.presets}}" as="pr" hint-placeholder-count="3"><button type="button" class="mm-chipq" aria-pressed="{{pr.on}}" onClick="{{pr.pick}}">{{pr.label}}</button></sc-for></div>' % p
    return '\n'.join([chips,
        '<div class="mm-grid2"%s>' % ('' if not phone else ' style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px"'),
        '<div class="mm-field"><label class="mm-label" for="%s-from">From</label><input id="%s-from" class="mm-input" type="date" value="{{%s.from}}" onChange="{{%s.onFrom}}"></div>' % (ids, ids, p, p),
        '<div class="mm-field"><label class="mm-label" for="%s-to">To</label><input id="%s-to" class="mm-input" type="date" value="{{%s.to}}" onChange="{{%s.onTo}}"></div>' % (ids, ids, p, p),
        '</div>'])

# ======================================================================
# Adjustments
# ======================================================================
def adjustments():
    acts = '<sc-if value="{{hasRows}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" onClick="{{exportAdj}}">@@I:download@@Export</button></sc-if>'
    datepop = ('<div style="display: flex; flex-direction: column; gap: 12px; padding: 12px">' + date_fields('df', 'mm-df') + '</div>'
               '<sc-if value="{{df.has}}" hint-placeholder-val="{{false}}"><div role="separator" class="mm-sep" style="margin: 0"></div><div style="padding: 4px"><button type="button" class="mm-cmd-item" style="justify-content: center" onClick="{{df.clear}}">Clear filter</button></div></sc-if>')
    d = dtop('Adjustments', acts, 'adjustments') + '\n'.join([
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">',
        dfilter('rf', 'Reason', list_pop('rf', 'Reason', 'No reason found.'), 230),
        dfilter('df', 'Date', datepop, 300),
        RESET,
        '<sc-if value="{{hasRows}}" hint-placeholder-val="{{true}}"><span style="margin-left: auto; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums">{{totals}}</span></sc-if>',
        '</div>',
        '',
        '<div style="border: 1px solid var(--border); border-radius: 10px">',
        '<div class="mm-agrid mm-thead" aria-hidden="true"><span>When</span><span>Item</span><span>Reason</span><span class="mm-num">Quantity</span><span class="mm-num">Value</span></div>',
        '<ul aria-label="Adjustments" style="list-style: none; margin: 0; padding: 0">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="12"><li><div class="mm-agrid mm-row" style="min-height: 52px">',
        '<span class="mm-muted" style="font-variant-numeric: tabular-nums">{{r.when}}</span>',
        '<span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{r.item}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{r.opts}}</span></span>',
        '<span style="display: flex; align-items: center; gap: 8px; min-width: 0"><span class="mm-badge">{{r.reason}}</span><sc-if value="{{r.hasNote}}" hint-placeholder-val="{{true}}"><span class="mm-trunc mm-muted">{{r.note}}</span></sc-if></span>',
        '<span class="mm-num" style="font-weight: 500; color: {{r.qtyColor}}">{{r.qty}}</span>',
        '<span class="mm-num" style="color: {{r.valueColor}}">{{r.value}}</span>',
        '</div></li></sc-for>',
        '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Reset filters') + '</sc-if>',
        '</div>',
        '<p class="mm-muted" style="margin: 0; font-size: 13px">Value is each change at the item’s cost then. Sales and receiving aren’t adjustments: see each item’s stock history.</p>']) + DEND + XEND

    filt_body = '\n'.join([
        '<div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; padding: 8px 16px 16px">',
        '<div style="display: flex; flex-direction: column; gap: 10px"><p class="mm-label" style="margin: 0">Dates</p>' + date_fields('df', 'mm-pdf', True) + '</div>',
        '<div style="display: flex; flex-direction: column; gap: 4px"><p class="mm-label" style="margin: 0 0 4px">Reason</p>',
        '<div role="radiogroup" aria-label="Reason" style="display: flex; flex-direction: column">',
        '<button type="button" role="radio" class="mm-optrow" aria-checked="{{allReasonsOn}}" onClick="{{pickAllReasons}}" style="padding: 0 4px"><span style="flex: 1">All reasons</span>' + svg(ICONS['check'], 18, 'opacity: {{allCheck}}; color: var(--foreground)') + '</button>',
        '<sc-for list="{{rf.items}}" as="o" hint-placeholder-count="10"><button type="button" role="radio" class="mm-optrow" aria-checked="{{o.aria}}" onClick="{{o.pick}}" style="padding: 0 4px"><span style="flex: 1">{{o.label}}</span><span class="mm-muted" style="font-size: 13px; font-variant-numeric: tabular-nums">{{o.count}}</span>' + svg(ICONS['check'], 18, 'opacity: {{o.check}}; color: var(--foreground)') + '</button></sc-for>',
        '</div></div>',
        '</div>'])
    ph = ptop('Adjustments', '<sc-if value="{{hasRows}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" onClick="{{exportAdj}}">@@I:download@@Export</button></sc-if>', 'adjustments') + '\n'.join([
        '<div style="display: flex; align-items: center; gap: 8px">',
        '<button type="button" class="mm-btn mm-outline" aria-haspopup="dialog" onClick="{{openFilters}}" style="height: 40px">' + svg(ICONS['adjust']) + 'Filters<sc-if value="{{hasCount}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec" style="margin-left: 2px">{{filterCount}}</span></sc-if></button>',
        '<sc-if value="{{hasFilters}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-ghost" style="height: 40px" onClick="{{clearAll}}">Reset</button></sc-if>',
        '</div>',
        '<sc-if value="{{hasRows}}" hint-placeholder-val="{{true}}"><p style="margin: 0; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums">{{totals}}</p></sc-if>',
        '<ul class="mm-plist" aria-label="Adjustments">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="10"><li><div class="mm-prow" style="align-items: flex-start; gap: 12px; padding: 10px 12px">',
        '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px"><span class="mm-trunc" style="font-weight: 500">{{r.item}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; line-height: 18px">{{r.opts}}</span><span class="mm-trunc" style="font-size: 13px; line-height: 18px">{{r.reasonText}}</span><span class="mm-muted" style="font-size: 12px; line-height: 16px">{{r.when}}</span></span>',
        '<span style="display: flex; flex-direction: column; align-items: flex-end; flex: none"><span style="font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; color: {{r.qtyColor}}">{{r.qty}}</span><span style="font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; color: {{r.valueColor}}">{{r.value}}</span></span>',
        '</div></li></sc-for>',
        '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Reset filters', pad='32px 16px') + '</sc-if>']) + PEND
    ph += pdrawer('filtersOpen', 'closeAll', 'mm-pf-title', 'Filters', '', filt_body,
        '<div style="flex: none; display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border)"><button type="button" class="mm-btn mm-outline" style="flex: 1" disabled="{{noFilters}}" onClick="{{clearAll}}">Clear</button><button type="button" class="mm-btn mm-primary" style="flex: 2" onClick="{{closeAll}}">{{showText}}</button></div>')
    ph += PXEND
    js = read('adjust.js')
    opts = ['Adjustments', 'Reason filter', 'Date filter', 'Damaged only', 'This month', 'Nothing found', 'Filters']
    write('Adjustments', dhead_for('adjustments', [('Inventory', 'Inventory.dc.html'), ('Adjustments', '')], 'Adjustments'), expand(d), js, props(opts, 'Adjustments'), 'mm mm-root')
    write('AdjustmentsPhone', phead_for('Adjustments'), expand(ph, True), js, props(opts, 'Adjustments', True), 'mm')

def ttabs(cond_list='tabs', count=6, phone=False):
    style = '' 
    tabs = '<div role="tablist" aria-label="Status" class="mm-tabs mm-ttabs" style="align-self: flex-start; height: %s"><sc-for list="{{%s}}" as="t" hint-placeholder-count="%d"><button type="button" role="tab" class="mm-tab" aria-selected="{{t.on}}" onClick="{{t.pick}}">{{t.label}}<span class="mm-tabcount">{{t.count}}</span></button></sc-for></div>' % ('40px' if phone else '36px', cond_list, count)
    if phone:
        return '<nav aria-label="Status" style="margin: 0 -16px; padding: 0 16px; overflow-x: auto; scrollbar-width: none">' + tabs + '</nav>'
    return tabs

def prog(p):
    return '<span class="mm-progcell"><span style="font-size: 13px; font-variant-numeric: tabular-nums">{{%s.progress}}</span><span class="mm-prog"><span style="width: {{%s.pct}}; background: {{%s.progColor}}"></span></span></span>' % (p, p, p)

# ======================================================================
# Purchase orders
# ======================================================================
def pos():
    acts = ('<button type="button" class="mm-btn mm-outline" onClick="{{exportPos}}">@@I:download@@Export</button>\n'
            '<a href="PurchaseOrder.dc.html" class="mm-btn mm-primary">@@I:plus@@New purchase order</a>')
    menu = dmenu('r.menuOpen', 'r.toggleMenu', 'r.menuAria', [('link', 'Open', 'PurchaseOrder.dc.html', 'file'), ('Receive', 'r.canReceiveGo', 'truck', 'r.canReceive'), ('Print or share', 'r.print', 'printer'), 'sep', ('Cancel order', 'r.ask', 'ban', 'r.canCancel'), ('Delete draft', 'r.ask', 'trash', 'r.isDraft')], width=180)
    menu = menu.replace('<sc-if value="{{r.canReceive}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-cmd-item" onClick="{{r.canReceiveGo}}">', '<sc-if value="{{r.canReceive}}" hint-placeholder-val="{{true}}"><a href="Receive.dc.html" role="menuitem" class="mm-cmd-item">')
    menu = menu.replace(svg(ICONS['truck']) + 'Receive</button></sc-if>', svg(ICONS['truck']) + 'Receive</a></sc-if>')
    menu = menu.replace('class="mm-cmd-item" onClick="{{r.ask}}">' + svg(ICONS['ban']), 'class="mm-cmd-item mm-danger" onClick="{{r.ask}}">' + svg(ICONS['ban'])).replace('class="mm-cmd-item" onClick="{{r.ask}}">' + svg(ICONS['trash']), 'class="mm-cmd-item mm-danger" onClick="{{r.ask}}">' + svg(ICONS['trash']))
    d = dtop('Purchase orders', acts, 'po') + '\n'.join([
        ttabs(),
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">',
        search('Search PO number or supplier'),
        dfilter('sf', 'Supplier', list_pop('sf', 'Supplier', 'No supplier found.'), 260),
        RESET,
        '<sc-if value="{{hasOpen}}" hint-placeholder-val="{{true}}"><span class="mm-muted" style="margin-left: auto; font-size: 13px">{{openText}}</span></sc-if>',
        '</div>',
        '<div style="border: 1px solid var(--border); border-radius: 10px">',
        '<div class="mm-pogrid mm-thead" aria-hidden="true"><span>PO</span><span>Supplier</span><span>Status</span><span>Received</span><span>Expected on</span><span class="mm-num">Total</span><span></span></div>',
        '<ul aria-label="Purchase orders" style="list-style: none; margin: 0; padding: 0">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="6"><li><div class="mm-pogrid mm-row" style="min-height: 56px">',
        '<a href="PurchaseOrder.dc.html" class="mm-rowlink mm-mono" aria-label="{{r.aria}}">{{r.ref}}</a>',
        '<span class="mm-trunc">{{r.supplier}}</span>',
        '<span>' + sbadge('r.badge') + '</span>',
        '<sc-if value="{{r.showProg}}" hint-placeholder-val="{{true}}">' + prog('r') + '</sc-if><sc-if value="{{r.noProg}}" hint-placeholder-val="{{false}}"><span class="mm-muted">—</span></sc-if>',
        '<span style="color: {{r.expColor}}; font-variant-numeric: tabular-nums">{{r.expected}}</span>',
        '<span class="mm-num" style="font-weight: 500">{{r.total}}</span>',
        menu,
        '</div></li></sc-for>',
        '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Reset filters', 'emptyCanReset', 'emptyReset') + '</sc-if>',
        '</div>']) + DEND
    d += palert('cancelOpen', '{{cfTitle}}', '<p style="margin: 0">Nothing was received, so nothing changes in stock.</p>', 'closeAll', 'doCancel', 'Cancel order')
    d += '\n' + palert('deleteOpen', '{{cfTitle}}', '<p style="margin: 0">The draft and its items go. Nothing was ordered yet.</p>', 'closeAll', 'doDelete', 'Delete')
    d += XEND

    ph = ptop('Purchase orders', '<a href="PurchaseOrderPhone.dc.html" class="mm-btn mm-primary">@@I:plus@@New</a>', 'po') + '\n'.join([
        ttabs(phone=True),
        '<div style="display: flex; gap: 8px">' + search('Search PO or supplier', phone=True) +
        '<button type="button" class="mm-btn mm-outline" aria-haspopup="dialog" onClick="{{sf.toggle}}" style="height: 40px; max-width: 150px">' + svg(ICONS['adjust']) + '<span class="mm-trunc">{{supButton}}</span></button></div>',
        '<sc-if value="{{hasFilters}}" hint-placeholder-val="{{false}}"><div style="display: flex; justify-content: flex-end; margin: -4px 0"><button type="button" class="mm-btn mm-ghost" style="height: 32px; margin-right: -12px" onClick="{{clearAll}}">Reset</button></div></sc-if>',
        '<ul class="mm-plist" aria-label="Purchase orders">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="6"><li><div class="mm-prow" style="align-items: flex-start; gap: 10px; padding: 12px 4px 12px 12px">',
        '<a href="PurchaseOrderPhone.dc.html" class="mm-rowlink" aria-label="{{r.aria}}" style="gap: 4px"><span style="display: flex; align-items: center; gap: 8px"><span class="mm-mono" style="font-weight: 600">{{r.ref}}</span>' + sbadge('r.badge') + '</span><span class="mm-trunc mm-muted" style="font-size: 13px; line-height: 18px">{{r.meta}}</span><sc-if value="{{r.showProg}}" hint-placeholder-val="{{true}}"><span style="display: flex; align-items: center; gap: 8px; margin-top: 2px"><span class="mm-prog" style="flex: 1"><span style="width: {{r.pct}}; background: {{r.progColor}}"></span></span><span class="mm-muted" style="flex: none; font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums">{{r.progress}}</span></span></sc-if></a>',
        '<span style="display: flex; flex-direction: column; align-items: flex-end; flex: none"><span style="font-weight: 600; font-variant-numeric: tabular-nums">{{r.total}}</span><span style="font-size: 12px; line-height: 16px; color: {{r.expColor}}">{{r.expected}}</span></span>',
        '<button type="button" class="mm-btn mm-ghost mm-icon mm-above" aria-label="{{r.menuAria}}" aria-haspopup="dialog" onClick="{{r.toggleMenu}}" style="margin-top: -6px">' + svg(ICONS['dots'], 18) + '</button>',
        '</div></li></sc-for>',
        '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Reset filters', 'emptyCanReset', 'emptyReset', pad='32px 16px') + '</sc-if>']) + PEND
    ph += pdrawer('menuOpen', 'closeAll', 'mm-mx-title', '{{mx.ref}}', '{{mx.supplier}}', '\n'.join([
        '<div role="menu" aria-labelledby="mm-mx-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<a href="PurchaseOrderPhone.dc.html" role="menuitem" class="mm-optrow">' + svg(ICONS['file'], 18) + 'Open</a>',
        '<sc-if value="{{mx.canReceive}}" hint-placeholder-val="{{true}}"><a href="ReceivePhone.dc.html" role="menuitem" class="mm-optrow">' + svg(ICONS['truck'], 18) + 'Receive</a></sc-if>',
        '<button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.print}}">' + svg(ICONS['printer'], 18) + 'Print or share</button>',
        '<sc-if value="{{mx.canCancel}}" hint-placeholder-val="{{true}}"><div role="separator" class="mm-sep"></div><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{mx.ask}}">' + svg(ICONS['ban'], 18) + 'Cancel order</button></sc-if>',
        '<sc-if value="{{mx.isDraft}}" hint-placeholder-val="{{false}}"><div role="separator" class="mm-sep"></div><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{mx.ask}}">' + svg(ICONS['trash'], 18) + 'Delete draft</button></sc-if>',
        '</div>']), '', tall=False)
    ph += '\n' + pdrawer('sf.open', 'closeAll', 'mm-sf-title', 'Supplier', '', '\n'.join([
        '<div role="listbox" aria-labelledby="mm-sf-title" style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<button type="button" role="option" aria-selected="{{allSupAria}}" class="mm-optrow" onClick="{{sf.clear}}"><span style="flex: 1">All suppliers</span>' + svg(ICONS['check'], 18, 'opacity: {{allSupCheck}}; color: var(--foreground)') + '</button>',
        '<sc-for list="{{sf.items}}" as="o" hint-placeholder-count="4"><button type="button" role="option" aria-selected="{{o.aria}}" class="mm-optrow" onClick="{{o.pick}}"><span class="mm-trunc" style="flex: 1">{{o.label}}</span><span class="mm-muted" style="font-size: 13px">{{o.count}}</span>' + svg(ICONS['check'], 18, 'opacity: {{o.check}}; color: var(--foreground)') + '</button></sc-for>',
        '</div>']), '', tall=False)
    ph += '\n' + phalert('cancelOpen', '{{cfTitle}}', '<p style="margin: 0">Nothing was received, so nothing changes in stock.</p>', 'closeAll', 'doCancel', 'Cancel order')
    ph += '\n' + phalert('deleteOpen', '{{cfTitle}}', '<p style="margin: 0">The draft and its items go. Nothing was ordered yet.</p>', 'closeAll', 'doDelete', 'Delete')
    ph += PXEND
    js = read('pos.js')
    opts = ['Purchase orders', 'To receive', 'Supplier filter', 'Row menu', 'Cancel order', 'Delete draft']
    write('PurchaseOrders', dhead_for('po', [('Inventory', 'Inventory.dc.html'), ('Purchase orders', '')], 'Purchase orders'), expand(d), js, props(opts, 'Purchase orders'), 'mm mm-root')
    write('PurchaseOrdersPhone', phead_for('Purchase orders'), expand(ph, True), js, props(opts, 'Purchase orders', True), 'mm')

def opt(lbl):
    return lbl + ' <span class="mm-muted" style="font-weight: 400">(optional)</span>'

def bar():
    return ('<sc-if value="{{bar.show}}" hint-placeholder-val="{{false}}">\n<div role="region" aria-label="{{bar.label}}" class="mm-bar">\n'
            '<span role="status" style="font-weight: 500; white-space: nowrap">{{bar.label}}</span>\n<span aria-hidden="true" class="mm-bar-sep"></span>\n'
            '<button type="button" class="mm-btn mm-inv" onClick="{{discard}}">{{bar.cancel}}</button>\n'
            '<button type="button" class="mm-btn mm-invsolid" onClick="{{save}}">{{bar.save}}</button>\n</div>\n</sc-if>')

def pbar():
    return ('<sc-if value="{{bar.show}}" hint-placeholder-val="{{false}}">\n<div role="region" aria-label="{{bar.label}}" style="display: flex; flex: none; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--background)">\n'
            '<button type="button" class="mm-btn mm-outline" style="flex: 1" onClick="{{discard}}">{{bar.cancel}}</button>\n'
            '<button type="button" class="mm-btn mm-primary" style="flex: 2" onClick="{{save}}">{{bar.save}}</button>\n</div>\n</sc-if>')

ALERT_PROBLEMS = '<sc-if value="{{showProblems}}" hint-placeholder-val="{{false}}"><div role="alert" class="mm-alert mm-alert-bad">' + svg(ICONS['alert']) + '<p style="margin: 0">{{problemsText}}</p></div></sc-if>'

def back_title(href, aria, title_hole, badge_cond, badge):
    return ('<div style="display: flex; align-items: center; gap: 12px">\n'
            '<a href="%s" class="mm-btn mm-ghost mm-icon" aria-label="%s" style="margin-left: -8px">%s</a>\n'
            '<h1 class="mm-trunc" style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">%s</h1>\n'
            '<sc-if value="{{%s}}" hint-placeholder-val="{{true}}">%s</sc-if>\n'
            '<span style="flex: 1"></span>\n') % (href, aria, svg(ICONS['back']), title_hole, badge_cond, badge)

# ======================================================================
# Purchase order
# ======================================================================
def po_items(phone):
    if phone:
        rows = ('<ul class="mm-plist" aria-label="Items"><sc-for list="{{lines}}" as="l" hint-placeholder-count="3"><li><div class="mm-prow" style="flex-direction: column; align-items: stretch; gap: 10px; padding: 12px">'
                '<div style="display: flex; align-items: flex-start; gap: 8px"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{l.title}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; line-height: 18px">{{l.opts}}</span><span class="mm-trunc mm-muted" style="font-size: 12px; line-height: 16px">{{l.sub}}</span></span>'
                '<sc-if value="{{l.canRemove}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{l.removeAria}}" onClick="{{l.remove}}" style="margin: -6px -6px 0 0">' + svg(ICONS['x'], 18) + '</button></sc-if></div>'
                '<div style="display: grid; grid-template-columns: 88px minmax(0, 1fr) auto; align-items: end; gap: 10px">'
                '<div class="mm-field"><span class="mm-label" style="font-size: 12px">Ordered</span><input class="mm-input" inputMode="numeric" aria-label="{{l.qtyAria}}" aria-invalid="{{l.qBad}}" disabled="{{locked}}" value="{{l.qty}}" onChange="{{l.onQty}}" style="text-align: right; font-variant-numeric: tabular-nums"></div>'
                '<div class="mm-field"><span class="mm-label" style="font-size: 12px">Cost each</span><label class="mm-affix"><span aria-hidden="true" style="top: 10px">৳</span><input class="mm-input" inputMode="decimal" aria-label="{{l.costAria}}" aria-invalid="{{l.cBad}}" disabled="{{locked}}" value="{{l.cost}}" onChange="{{l.onCost}}" style="font-variant-numeric: tabular-nums"></label></div>'
                '<span style="height: 40px; display: flex; align-items: center; font-weight: 600; font-variant-numeric: tabular-nums">{{l.total}}</span></div>'
                '<sc-if value="{{l.showErr}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err" style="margin: -4px 0 0">{{l.err}}</p></sc-if>'
                '</div></li></sc-for></ul>')
        add = '<sc-if value="{{hasEdit}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-addrow" aria-haspopup="dialog" onClick="{{item.toggle}}">' + svg(ICONS['plus']) + 'Add an item</button></sc-if>'
    else:
        rows = ('<div style="border: 1px solid var(--border); border-radius: 10px"><div class="mm-lgrid mm-thead" aria-hidden="true" style="padding-right: 8px"><span>Item</span><span class="mm-num">Ordered</span><span class="mm-num">Cost each</span><span class="mm-num">Total</span><span></span></div>'
                '<ul aria-label="Items" style="list-style: none; margin: 0; padding: 0"><sc-for list="{{lines}}" as="l" hint-placeholder-count="3"><li style="border-top: 1px solid var(--border)"><div class="mm-lgrid" style="min-height: 56px; padding: 8px 8px 8px 16px">'
                '<span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{l.title}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{l.opts}}</span><span class="mm-trunc mm-muted" style="font-size: 12px">{{l.sub}}</span></span>'
                '<input class="mm-input mm-qty" inputMode="numeric" aria-label="{{l.qtyAria}}" aria-invalid="{{l.qBad}}" disabled="{{locked}}" value="{{l.qty}}" onChange="{{l.onQty}}">'
                '<label class="mm-affix"><span aria-hidden="true" style="top: 6px">৳</span><input class="mm-input mm-qty" inputMode="decimal" aria-label="{{l.costAria}}" aria-invalid="{{l.cBad}}" disabled="{{locked}}" value="{{l.cost}}" onChange="{{l.onCost}}"></label>'
                '<span class="mm-num" style="font-weight: 500">{{l.total}}</span>'
                '<sc-if value="{{l.canRemove}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{l.removeAria}}" onClick="{{l.remove}}" style="width: 32px; height: 32px">' + svg(ICONS['x']) + '</button></sc-if><sc-if value="{{l.cantRemove}}" hint-placeholder-val="{{false}}"><span></span></sc-if>'
                '</div><sc-if value="{{l.showErr}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err" style="margin: -6px 0 0; padding: 0 16px 10px; text-align: right">{{l.err}}</p></sc-if></li></sc-for></ul></div>')
        add = ('<sc-if value="{{hasEdit}}" hint-placeholder-val="{{true}}"><div style="position: relative"><button type="button" class="mm-addrow" aria-haspopup="listbox" aria-expanded="{{item.aria}}" onClick="{{item.toggle}}">' + svg(ICONS['plus']) + 'Add an item</button>'
               + combo_pop('item', 'No item found.') + '</div></sc-if>')
    return '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-items"%s>' % (' style="gap: 14px"' if phone else ''),
        '<div class="mm-chead"><h2 id="mm-c-items" class="mm-ctitle">Items <span class="mm-muted" style="font-weight: 400">· {{lineCount}}</span></h2>'
        '<sc-if value="{{canReorder}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost" onClick="{{reorder}}" style="height: 28px; margin-right: -8px; padding: 0 8px">' + svg(ICONS['refresh']) + ('Add low stock' if phone else 'Add low stock from this supplier') + '</button></sc-if></div>',
        '<sc-if value="{{hasLines}}" hint-placeholder-val="{{true}}">' + rows + '</sc-if>',
        '<sc-if value="{{noLines}}" hint-placeholder-val="{{false}}"><div class="mm-emptybox" style="padding: 16px; border-color: {{linesEdge}}"><p style="margin: 0">Add the items you are ordering.</p></div></sc-if>',
        add,
        '</section>'])

def po_costs(phone):
    if phone:
        row = ('<sc-for list="{{costs}}" as="c" hint-placeholder-count="1"><div style="display: grid; grid-template-columns: minmax(0, 1fr) 112px 40px; gap: 8px; align-items: center">'
               '<input class="mm-input" aria-label="What for" placeholder="What for" maxLength="100" aria-invalid="{{c.bad}}" disabled="{{locked}}" value="{{c.label}}" onChange="{{c.onLabel}}">'
               '<label class="mm-affix"><span aria-hidden="true" style="top: 10px">৳</span><input class="mm-input" inputMode="decimal" aria-label="Amount" aria-invalid="{{c.bad}}" disabled="{{locked}}" value="{{c.amount}}" onChange="{{c.onAmount}}"></label>'
               '<sc-if value="{{hasEdit}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{c.removeAria}}" onClick="{{c.remove}}">' + svg(ICONS['x'], 18) + '</button></sc-if></div></sc-for>')
    else:
        row = ('<sc-if value="{{hasCosts}}" hint-placeholder-val="{{true}}"><div style="display: grid; grid-template-columns: minmax(0, 1fr) 140px 32px; gap: 8px; font-size: 13px; font-weight: 500"><span>What for</span><span>Amount</span><span></span></div></sc-if>'
               '<sc-for list="{{costs}}" as="c" hint-placeholder-count="1"><div style="display: grid; grid-template-columns: minmax(0, 1fr) 140px 32px; gap: 8px; align-items: center">'
               '<input class="mm-input" aria-label="What for" placeholder="Transport, labour or an agent’s fee" maxLength="100" aria-invalid="{{c.bad}}" disabled="{{locked}}" value="{{c.label}}" onChange="{{c.onLabel}}">'
               '<label class="mm-affix"><span aria-hidden="true">৳</span><input class="mm-input" inputMode="decimal" aria-label="Amount" aria-invalid="{{c.bad}}" disabled="{{locked}}" value="{{c.amount}}" onChange="{{c.onAmount}}" style="text-align: right; font-variant-numeric: tabular-nums"></label>'
               '<sc-if value="{{hasEdit}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{c.removeAria}}" onClick="{{c.remove}}" style="width: 32px; height: 32px">' + svg(ICONS['x']) + '</button></sc-if></div></sc-for>')
    return '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-costs"%s>' % (' style="gap: 14px"' if phone else ''),
        '<div style="display: flex; flex-direction: column; gap: 4px"><h2 id="mm-c-costs" class="mm-ctitle">Other costs</h2><p class="mm-muted" style="margin: 0; font-size: 13px">Transport, labour or an agent’s fee: spread over the goods by value as they arrive.</p></div>',
        row,
        '<sc-if value="{{canAddCost}}" hint-placeholder-val="{{true}}"><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px"><button type="button" class="mm-btn mm-outline" onClick="{{addCost}}" style="height: 32px">' + svg(ICONS['plus']) + 'Add a cost</button><sc-if value="{{noCosts}}" hint-placeholder-val="{{true}}"><sc-for list="{{costQuick}}" as="k" hint-placeholder-count="3"><button type="button" class="mm-chipq" onClick="{{k.add}}">{{k.label}}</button></sc-for></sc-if></div></sc-if>',
        '<dl class="mm-totals"%s><div><dt>Goods</dt><dd>{{goods}}</dd></div><div><dt>Other costs</dt><dd>{{other}}</dd></div><div class="mm-total"><dt>Total</dt><dd>{{total}}</dd></div></dl>' % ('' if phone else ' style="align-self: flex-end; width: 280px"'),
        '</section>'])

def po_details(phone):
    sup = ('<div class="mm-field"><span class="mm-label" id="mm-l-sup">Supplier</span>'
           '<sc-if value="{{supEditable}}" hint-placeholder-val="{{true}}">' + (pcombo_btn('sup', 'mm-l-sup') if phone else combo_btn('sup', 'mm-l-sup', ' aria-invalid="{{supErrAria}}"')) + '<sc-if value="{{supErr}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Choose a supplier.</p></sc-if></sc-if>'
           '<sc-if value="{{supFixed}}" hint-placeholder-val="{{false}}"><a href="Supplier%s.dc.html" class="mm-readonly" style="text-decoration: none; color: var(--foreground)"><span class="mm-trunc" style="flex: 1">{{supName}}</span>%s</a></sc-if></div>') % ('Phone' if phone else '', svg(ICONS['right'], 16, 'opacity: .5'))
    grid = '<div class="mm-grid2">' if not phone else '<div style="display: flex; flex-direction: column; gap: 16px">'
    return '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-det"%s>' % (' style="gap: 14px"' if phone else ''),
        '<h2 id="mm-c-det" class="mm-ctitle">Supplier and dates</h2>',
        grid,
        sup,
        '<div class="mm-field"><label class="mm-label" for="mm-exp">' + opt('Expected on') + '</label><input id="mm-exp" class="mm-input" type="date" disabled="{{locked}}" value="{{expected}}" onChange="{{onExpected}}"></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-sref">' + opt('Supplier’s reference') + '</label><input id="mm-sref" class="mm-input" maxLength="100" disabled="{{locked}}" value="{{supRef}}" onChange="{{onSupRef}}" placeholder="Their invoice or order number"></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-pnote">' + opt('Note') + '</label><input id="mm-pnote" class="mm-input" maxLength="1000" disabled="{{locked}}" value="{{note}}" onChange="{{onNote}}"></div>',
        '</div>',
        '</section>'])

def po_receipts():
    return ('<sc-if value="{{hasReceipts}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-labelledby="mm-c-del" style="gap: 8px"><h2 id="mm-c-del" class="mm-ctitle">Deliveries</h2>'
            '<ul class="mm-mlist"><sc-for list="{{receipts}}" as="g" hint-placeholder-count="2"><li style="flex-direction: row; align-items: center; gap: 12px">' + svg(ICONS['truck'], 16, 'flex: none; color: var(--muted-foreground)') +
            '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-mono" style="font-weight: 500">{{g.ref}}</span><span class="mm-muted" style="font-size: 13px">{{g.date}} · {{g.units}}</span></span><span style="font-variant-numeric: tabular-nums">{{g.value}}</span></li></sc-for></ul></section></sc-if>')

def po():
    more = ('<sc-if value="{{hasMore}}" hint-placeholder-val="{{true}}"><div style="position: relative; display: flex">'
            '<button type="button" class="mm-btn mm-outline mm-icon" aria-label="More actions" aria-haspopup="menu" aria-expanded="{{moreAria}}" onClick="{{toggleMore}}">' + svg(ICONS['dots']) + '</button>'
            '<sc-if value="{{moreOpen}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close menu" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button>'
            '<div role="menu" aria-label="More actions" class="mm-menu" onKeyDown="{{escClose}}" style="top: 40px; right: 0; width: 200px">'
            '<sc-if value="{{hd.canClose}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-cmd-item" onClick="{{askClose}}">' + svg(ICONS['lock']) + 'Close order</button></sc-if>'
            '<sc-if value="{{hd.canCancel}}" hint-placeholder-val="{{false}}"><button type="button" role="menuitem" class="mm-cmd-item mm-danger" onClick="{{askCancel}}">' + svg(ICONS['ban']) + 'Cancel order</button></sc-if>'
            '<sc-if value="{{hd.canDelete}}" hint-placeholder-val="{{false}}"><button type="button" role="menuitem" class="mm-cmd-item mm-danger" onClick="{{askDelete}}">' + svg(ICONS['trash']) + 'Delete draft</button></sc-if>'
            '</div></sc-if></div></sc-if>')
    head = back_title('PurchaseOrders.dc.html', 'Back to purchase orders', '{{hd.title}}', 'hd.isExisting', sbadge('hd.badge')) + '\n'.join([
        '<sc-if value="{{hd.isExisting}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" onClick="{{print}}">' + svg(ICONS['printer']) + 'Print or share</button></sc-if>',
        '<sc-if value="{{hd.canPlace}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" onClick="{{place}}">' + svg(ICONS['send']) + 'Mark as ordered</button></sc-if>',
        '<sc-if value="{{hd.canReceive}}" hint-placeholder-val="{{true}}"><a href="Receive.dc.html" class="mm-btn mm-primary">' + svg(ICONS['truck']) + 'Receive</a></sc-if>',
        more, '</div>',
        '<p class="mm-muted" style="margin: -8px 0 0">{{hd.sub}}</p>'])
    d = '\n'.join([MAIN, '<div class="mm-col">', head,
        '<sc-if value="{{hasStats}}" hint-placeholder-val="{{true}}"><dl class="mm-statrow"><sc-for list="{{stats}}" as="x" hint-placeholder-count="4"><div><dt>{{x.label}}</dt><dd>{{x.value}}</dd></div></sc-for></dl></sc-if>',
        '<sc-if value="{{hd.readOnly}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['lock']) + '<p style="margin: 0">{{hd.readOnlyText}}</p></div></sc-if>',
        ALERT_PROBLEMS,
        po_details(False), po_items(False), po_costs(False), po_receipts(),
        bar(),
        '</div>']) + DEND
    d += palert('closeOpen', '{{closeTitle}}', '<p style="margin: 0">{{closeBody}}</p>', 'cancelConfirm', 'doClose', 'Close order', danger=False)
    d += '\n' + palert('cancelOpen', '{{cancelTitle}}', '<p style="margin: 0">Nothing was received, so nothing changes in stock.</p>', 'cancelConfirm', 'doCancel', 'Cancel order')
    d += '\n' + palert('deleteOpen', '{{deleteTitle}}', '<p style="margin: 0">The draft and its items go. Nothing was ordered yet.</p>', 'cancelConfirm', 'doDelete', 'Delete')
    d += XEND

    right = '<sc-if value="{{hd.isExisting}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="More actions" aria-haspopup="dialog" onClick="{{toggleMore}}">' + svg(ICONS['dots'], 18) + '</button></sc-if>'
    ph = '\n'.join([PROOT % 'var(--page)', phone_back('PurchaseOrdersPhone.dc.html', 'Back to purchase orders', '{{hd.title}}', right),
        '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
        '<div style="display: flex; flex-direction: column; gap: 6px; padding: 4px 4px 0"><sc-if value="{{hd.isExisting}}" hint-placeholder-val="{{true}}"><span>' + sbadge('hd.badge') + '</span></sc-if><p class="mm-muted" style="margin: 0; font-size: 13px">{{hd.sub}}</p></div>',
        '<sc-if value="{{hasStats}}" hint-placeholder-val="{{true}}"><dl class="mm-stats2"><sc-for list="{{stats}}" as="x" hint-placeholder-count="4"><div><dt>{{x.label}}</dt><dd>{{x.value}}</dd></div></sc-for></dl></sc-if>',
        '<sc-if value="{{hd.canReceive}}" hint-placeholder-val="{{true}}"><a href="ReceivePhone.dc.html" class="mm-btn mm-primary" style="height: 44px">' + svg(ICONS['truck']) + 'Receive what arrived</a></sc-if>',
        '<sc-if value="{{hd.canPlace}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" style="height: 44px" onClick="{{place}}">' + svg(ICONS['send']) + 'Mark as ordered</button></sc-if>',
        '<sc-if value="{{hd.readOnly}}" hint-placeholder-val="{{false}}"><div class="mm-note" style="font-size: 13px; line-height: 18px">' + svg(ICONS['lock']) + '<p style="margin: 0">{{hd.readOnlyText}}</p></div></sc-if>',
        ALERT_PROBLEMS,
        po_details(True), po_items(True), po_costs(True), po_receipts(),
        '</main>', pbar(), ''])
    ph += pdrawer('moreOpen', 'closeAll', 'mm-more-title', '{{hd.title}}', '', '\n'.join([
        '<div role="menu" aria-labelledby="mm-more-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<button type="button" role="menuitem" class="mm-optrow" onClick="{{print}}">' + svg(ICONS['printer'], 18) + 'Print or share</button>',
        '<sc-if value="{{hd.canClose}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{askClose}}">' + svg(ICONS['lock'], 18) + 'Close order</button></sc-if>',
        '<sc-if value="{{hasDanger}}" hint-placeholder-val="{{false}}"><div role="separator" class="mm-sep"></div></sc-if>',
        '<sc-if value="{{hd.canCancel}}" hint-placeholder-val="{{false}}"><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{askCancel}}">' + svg(ICONS['ban'], 18) + 'Cancel order</button></sc-if>',
        '<sc-if value="{{hd.canDelete}}" hint-placeholder-val="{{false}}"><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{askDelete}}">' + svg(ICONS['trash'], 18) + 'Delete draft</button></sc-if>',
        '</div>']), '', tall=False)
    ph += '\n@@PCOMBO@@\n'
    ph += phalert('closeOpen', '{{closeTitle}}', '<p style="margin: 0">{{closeBody}}</p>', 'cancelConfirm', 'doClose', 'Close order', danger=False)
    ph += '\n' + phalert('cancelOpen', '{{cancelTitle}}', '<p style="margin: 0">Nothing was received, so nothing changes in stock.</p>', 'cancelConfirm', 'doCancel', 'Cancel order')
    ph += '\n' + phalert('deleteOpen', '{{deleteTitle}}', '<p style="margin: 0">The draft and its items go. Nothing was ordered yet.</p>', 'cancelConfirm', 'doDelete', 'Delete')
    ph += '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    js = read('po.js')
    opts = ['Partly received', 'Ordered', 'Draft', 'New purchase order', 'Add an item', 'Unsaved changes', 'Missing details', 'More menu', 'Close order', 'Received']
    write('PurchaseOrder', dhead_for('po', [('Inventory', 'Inventory.dc.html'), ('Purchase orders', 'PurchaseOrders.dc.html'), ('{{hd.title}}', '')], 'Purchase order'), expand(d), js, props(opts, 'Partly received'), 'mm mm-root')
    write('PurchaseOrderPhone', phead_for('Purchase order'), expand(ph, True), js, props(opts, 'Partly received', True), 'mm')

# ======================================================================
# Receive stock
# ======================================================================
def switch(aria, bg, x, toggle):
    return '<button type="button" role="switch" class="mm-switch" aria-checked="{{%s}}" onClick="{{%s}}" style="background: {{%s}}"><span class="mm-knob" style="transform: translateX({{%s}})"></span></button>' % (aria, toggle, bg, x)

def rc_source(phone):
    seg = ('<div role="tablist" aria-label="What arrived" class="mm-tabs" style="display: flex; height: %s"><sc-for list="{{modes}}" as="m" hint-placeholder-count="2"><button type="button" role="tab" class="mm-tab" aria-selected="{{m.on}}" onClick="{{m.pick}}" style="flex: 1; justify-content: center; height: %s">{{m.label}}</button></sc-for></div>') % (('40px', '34px') if phone else ('36px', '30px'))
    pocombo = pcombo_btn('poc', 'mm-l-po') if phone else combo_btn('poc', 'mm-l-po')
    supcombo = pcombo_btn('supc', 'mm-l-rsup') if phone else combo_btn('supc', 'mm-l-rsup')
    grid = '<div class="mm-grid2">' if not phone else '<div style="display: flex; flex-direction: column; gap: 16px">'
    return '\n'.join([
        '<section class="mm-card" aria-label="Where it came from"%s>' % (' style="gap: 14px"' if phone else ''),
        seg,
        '<sc-if value="{{isPo}}" hint-placeholder-val="{{true}}"><div class="mm-field"><span class="mm-label" id="mm-l-po">Purchase order</span>' + pocombo +
        '<sc-if value="{{hasPo}}" hint-placeholder-val="{{true}}"><p class="mm-hint">{{poSub}} · <a href="PurchaseOrder%s.dc.html" style="color: var(--foreground); text-decoration: underline; text-underline-offset: 2px">Open {{poRef}}</a></p></sc-if></div></sc-if>' % ('Phone' if phone else ''),
        '<sc-if value="{{isDirect}}" hint-placeholder-val="{{false}}"><div class="mm-field"><span class="mm-label" id="mm-l-rsup">Supplier</span>' + supcombo + '<p class="mm-hint">A market purchase can have none. With one, it goes on their ledger.</p></div></sc-if>',
        grid,
        '<div class="mm-field"><label class="mm-label" for="mm-rdate">Received on</label><div style="display: flex; gap: 8px"><input id="mm-rdate" class="mm-input" type="date" value="{{date}}" onChange="{{onDate}}" style="flex: 1; min-width: 0"><button type="button" class="mm-chipq" aria-pressed="{{todayOn}}" onClick="{{pickToday}}" style="height: %s">Today</button></div></div>' % ('40px' if phone else '36px'),
        '<div class="mm-field"><label class="mm-label" for="mm-rinv">' + opt('Supplier’s invoice number') + '</label><input id="mm-rinv" class="mm-input" maxLength="100" value="{{invoice}}" onChange="{{onInvoice}}"></div>',
        '</div>',
        '</section>'])

def rc_items(phone):
    hints = ('<sc-if value="{{l.over}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-warn" style="margin: 0">{{l.overText}}</p></sc-if>'
             '<sc-if value="{{l.hasLanded}}" hint-placeholder-val="{{false}}"><p class="mm-hint" style="margin: 0">{{l.landedText}}</p></sc-if>'
             '<sc-if value="{{l.showErr}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err" style="margin: 0">{{l.errText}}</p></sc-if>')
    if phone:
        rows = ('<ul class="mm-plist" aria-label="Items"><sc-for list="{{lines}}" as="l" hint-placeholder-count="3"><li><div class="mm-prow" style="flex-direction: column; align-items: stretch; gap: 10px; padding: 12px">'
                '<div style="display: flex; align-items: flex-start; gap: 8px"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{l.title}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; line-height: 18px">{{l.opts}}</span><span class="mm-trunc mm-muted" style="font-size: 12px; line-height: 16px">{{l.sub}}</span></span>'
                '<sc-if value="{{l.canRemove}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{l.removeAria}}" onClick="{{l.remove}}" style="margin: -6px -6px 0 0">' + svg(ICONS['x'], 18) + '</button></sc-if></div>'
                '<div style="display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px">'
                '<div class="mm-field"><span class="mm-label" style="font-size: 12px">Received</span><input class="mm-input" inputMode="numeric" aria-label="{{l.qtyAria}}" aria-invalid="{{l.qBad}}" value="{{l.qty}}" onChange="{{l.onQty}}" style="text-align: right; font-variant-numeric: tabular-nums"></div>'
                '<div class="mm-field"><span class="mm-label" style="font-size: 12px">Cost each</span><label class="mm-affix"><span aria-hidden="true" style="top: 10px">৳</span><input class="mm-input" inputMode="decimal" aria-label="{{l.costAria}}" aria-invalid="{{l.cBad}}" placeholder="{{l.costPh}}" value="{{l.cost}}" onChange="{{l.onCost}}" style="font-variant-numeric: tabular-nums"></label></div></div>'
                + hints + '</div></li></sc-for></ul>')
        add = '<sc-if value="{{canAdd}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-addrow" aria-haspopup="dialog" onClick="{{item.toggle}}">' + svg(ICONS['plus']) + 'Add an item</button></sc-if>'
    else:
        rows = ('<div style="border: 1px solid var(--border); border-radius: 10px"><div class="mm-rvgrid mm-thead" aria-hidden="true" style="padding-right: 8px"><span>Item</span><span class="mm-num">Received</span><span class="mm-num">Cost each</span><span></span></div>'
                '<ul aria-label="Items" style="list-style: none; margin: 0; padding: 0"><sc-for list="{{lines}}" as="l" hint-placeholder-count="3"><li style="border-top: 1px solid var(--border); padding: 8px 8px 8px 16px"><div class="mm-rvgrid" style="min-height: 40px">'
                '<span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{l.title}}<span class="mm-muted" style="font-weight: 400"> · {{l.opts}}</span></span><span class="mm-trunc mm-muted" style="font-size: 12px">{{l.sub}}</span></span>'
                '<input class="mm-input mm-qty" inputMode="numeric" aria-label="{{l.qtyAria}}" aria-invalid="{{l.qBad}}" value="{{l.qty}}" onChange="{{l.onQty}}">'
                '<label class="mm-affix"><span aria-hidden="true" style="top: 6px">৳</span><input class="mm-input mm-qty" inputMode="decimal" aria-label="{{l.costAria}}" aria-invalid="{{l.cBad}}" placeholder="{{l.costPh}}" value="{{l.cost}}" onChange="{{l.onCost}}"></label>'
                '<sc-if value="{{l.canRemove}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{l.removeAria}}" onClick="{{l.remove}}" style="width: 32px; height: 32px">' + svg(ICONS['x']) + '</button></sc-if>'
                '</div><div style="display: flex; flex-direction: column; align-items: flex-end; padding-right: 42px">' + hints + '</div></li></sc-for></ul></div>')
        add = ('<sc-if value="{{canAdd}}" hint-placeholder-val="{{false}}"><div style="position: relative"><button type="button" class="mm-addrow" aria-haspopup="listbox" aria-expanded="{{item.aria}}" onClick="{{item.toggle}}">' + svg(ICONS['plus']) + 'Add an item</button>'
               + combo_pop('item', 'No item found.') + '</div></sc-if>')
    return '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-ritems"%s>' % (' style="gap: 14px"' if phone else ''),
        '<div style="display: flex; flex-direction: column; gap: 4px"><h2 id="mm-c-ritems" class="mm-ctitle">Items</h2><sc-if value="{{hasCostHint}}" hint-placeholder-val="{{true}}"><p class="mm-muted" style="margin: 0; font-size: 13px">{{costHint}}</p></sc-if></div>',
        '<sc-if value="{{hasLines}}" hint-placeholder-val="{{true}}">' + rows + '</sc-if>',
        '<sc-if value="{{noLines}}" hint-placeholder-val="{{false}}"><div class="mm-emptybox" style="padding: 16px"><p style="margin: 0">{{emptyText}}</p></div></sc-if>',
        add,
        '</section>'])

def rc_costs(phone):
    cols = 'minmax(0, 1fr) 112px' if phone else 'minmax(0, 1fr) 160px'
    return '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-rcost"%s>' % (' style="gap: 14px"' if phone else ''),
        '<div style="display: flex; flex-direction: column; gap: 4px"><h2 id="mm-c-rcost" class="mm-ctitle">' + opt('Other costs') + '</h2><p class="mm-muted" style="margin: 0; font-size: 13px">Transport, labour or an agent’s fee: spread over the goods by value.</p></div>',
        '<div style="display: grid; grid-template-columns: %s; gap: 8px">' % cols,
        '<input class="mm-input" aria-label="What for" placeholder="What for" maxLength="100" value="{{costLabel}}" onChange="{{onCostLabel}}">',
        '<label class="mm-affix"><span aria-hidden="true"%s>৳</span><input class="mm-input" inputMode="decimal" aria-label="Amount" placeholder="0" value="{{costAmount}}" onChange="{{onCostAmount}}" style="text-align: right; font-variant-numeric: tabular-nums"></label>' % (' style="top: 10px"' if phone else ''),
        '</div>',
        '<dl class="mm-totals"%s><div><dt>Goods</dt><dd>{{goods}}</dd></div><div><dt>Other costs</dt><dd>{{other}}</dd></div><div class="mm-total"><dt>Total</dt><dd>{{total}}</dd></div></dl>' % ('' if phone else ' style="align-self: flex-end; width: 280px"'),
        '</section>'])

def rc_pay(phone):
    return '\n'.join([
        '<sc-if value="{{canPay}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-label="Pay now"%s>' % (' style="gap: 14px"' if phone else ''),
        '<label class="mm-swrow"><span><span style="display: block; font-weight: 500">{{payTitle}}</span><span class="mm-muted" style="display: block; font-size: 13px">{{payBal}}</span></span>' + switch('payAria', 'payBg', 'payX', 'togglePay') + '</label>',
        '<sc-if value="{{pay}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-direction: column; gap: 16px">',
        '<div class="mm-field"><label class="mm-label" for="mm-pamt">Amount paid</label><div style="display: flex; gap: 8px"><label class="mm-affix" style="flex: 1"><span aria-hidden="true"%s>৳</span><input id="mm-pamt" class="mm-input" inputMode="decimal" aria-invalid="{{payErrAria}}" value="{{payAmt}}" onChange="{{onPayAmt}}" style="font-variant-numeric: tabular-nums"></label><button type="button" class="mm-chipq" onClick="{{payAll}}" style="height: %s">{{payAllText}}</button></div><sc-if value="{{payErr}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter the amount paid.</p></sc-if></div>' % (' style="top: 10px"' if phone else '', '40px' if phone else '36px'),
        '<div class="mm-field"><span class="mm-label" id="mm-l-pmeth">Paid by</span><div role="radiogroup" aria-labelledby="mm-l-pmeth" class="mm-paygrid"><sc-for list="{{methods}}" as="m" hint-placeholder-count="6"><button type="button" role="radio" class="mm-paybtn" aria-checked="{{m.on}}" onClick="{{m.pick}}">{{m.label}}</button></sc-for></div></div>',
        '</div></sc-if>',
        '</section></sc-if>'])

def receive():
    d = '\n'.join([MAIN, '<div class="mm-col">',
        '<h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">Receive stock</h1>',
        '@@SECTIONS:receive@@',
        '<p class="mm-muted" style="margin: 0">What arrived and what it cost. Receiving adds the stock and updates each item’s average cost.</p>',
        ALERT_PROBLEMS,
        rc_source(False), rc_items(False), rc_costs(False), rc_pay(False),
        bar(), '</div>']) + DEND + XEND
    ph = ptop('Receive stock', '', 'receive') + '\n'.join([
        ALERT_PROBLEMS, rc_source(True), rc_items(True), rc_costs(True), rc_pay(True),
        '</main>', pbar(), '', '@@TABBAR@@', '', '@@PCOMBO@@', '@@PTOAST@@', '', '</div>', '</x-dc>', ''])
    js = read('receive.js').replace("vals.payErr = tried && payBad;", "vals.payErr = tried && payBad;\n    vals.payErrAria = tried && payBad ? 'true' : 'false';")
    opts = ['For PO-0016', 'For PO-0017', 'Choose a purchase order', 'Without a purchase order', 'Item picker', 'Pay now', 'More than ordered', 'Missing costs']
    write('Receive', dhead_for('receive', [('Inventory', 'Inventory.dc.html'), ('Receive stock', '')], 'Receive stock'), expand(d), js, props(opts, 'For PO-0016'), 'mm mm-root')
    write('ReceivePhone', phead_for('Receive stock'), expand(ph, True), js, props(opts, 'For PO-0016', True), 'mm')

# ======================================================================
# Suppliers
# ======================================================================
def sup_form_body():
    return '\n'.join([
        '<div class="mm-field"><label class="mm-label" for="mm-sf-name">Name</label><input id="mm-sf-name" class="mm-input" maxLength="200" aria-invalid="{{sf.nameErrAria}}" value="{{sf.name}}" onChange="{{sf.onName}}" placeholder="The shop or company"><sc-if value="{{sf.nameErr}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter the supplier’s name.</p></sc-if></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-sf-contact">' + opt('Contact person') + '</label><input id="mm-sf-contact" class="mm-input" maxLength="200" value="{{sf.contact}}" onChange="{{sf.onContact}}"></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-sf-phone">' + opt('Phone') + '</label><input id="mm-sf-phone" class="mm-input" type="tel" inputMode="tel" value="{{sf.phones}}" onChange="{{sf.onPhones}}" placeholder="01712-345678"><p class="mm-hint">More than one? Separate them with commas.</p></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-sf-email">' + opt('Email') + '</label><input id="mm-sf-email" class="mm-input" type="email" value="{{sf.email}}" onChange="{{sf.onEmail}}"></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-sf-addr">' + opt('Address') + '</label><input id="mm-sf-addr" class="mm-input" maxLength="200" value="{{sf.address}}" onChange="{{sf.onAddress}}"></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-sf-note">' + opt('Note') + '</label><textarea id="mm-sf-note" class="mm-textarea" maxLength="1000" value="{{sf.note}}" onChange="{{sf.onNote}}" placeholder="Only staff see this."></textarea></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-sf-ob">' + opt('Opening balance') + '</label><label class="mm-affix"><span aria-hidden="true" style="top: {{affixTop}}">৳</span><input id="mm-sf-ob" class="mm-input" inputMode="decimal" aria-invalid="{{sf.obErrAria}}" value="{{sf.opening}}" onChange="{{sf.onOpening}}"></label><sc-if value="{{sf.obErr}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter an amount in taka.</p></sc-if><p class="mm-hint">What you already owed them on the day you started here. Leave empty for nothing.</p></div>'])

def sup_panel():
    btns = dfoot_buttons('closeForm', 'sf.save', '{{sf.saveText}}')
    left = '<sc-if value="{{sf.canArchive}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-ghost mm-danger" onClick="{{sf.archive}}" style="margin-left: -8px; padding: 0 8px">Archive</button></sc-if>'
    return dpanel('sf.open', 'closeForm', 'mm-sf-title', '{{sf.title}}', '{{sf.sub}}', sup_form_body().replace('{{affixTop}}', '8px'), left, btns[0], btns[1])

def sup_drawer():
    body = ('<div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 8px 16px 16px">\n' + sup_form_body().replace('{{affixTop}}', '10px') +
            '\n<sc-if value="{{sf.canArchive}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-ghost mm-danger" onClick="{{sf.archive}}" style="align-self: flex-start; margin-left: -12px">Archive supplier</button></sc-if>\n</div>')
    return pdrawer('sf.open', 'closeForm', 'mm-sf-title', '{{sf.title}}', '{{sf.sub}}', body, pfoot('closeForm', 'sf.save', '{{sf.saveText}}'))

def suppliers():
    acts = ('<button type="button" class="mm-btn mm-outline" onClick="{{exportSups}}">@@I:download@@Export</button>\n'
            '<a href="#" class="mm-btn mm-outline">@@I:upload@@Import</a>\n'
            '<button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{newSupplier}}">@@I:plus@@New supplier</button>')
    menu = dmenu('r.menuOpen', 'r.toggleMenu', 'r.menuAria', [('link', 'Open', 'Supplier.dc.html', 'file'), ('link', 'New purchase order', 'PurchaseOrder.dc.html', 'plus'), ('Edit', 'r.edit', 'pencil'), 'sep', ('Archive', 'r.archive', 'archive', 'r.notArchived'), ('Restore', 'r.archive', 'refresh', 'r.archived')], width=200)
    d = dtop('Suppliers', acts, 'suppliers') + '\n'.join([
        '<dl class="mm-statrow"><sc-for list="{{stats}}" as="x" hint-placeholder-count="4"><div><dt>{{x.label}}</dt><dd>{{x.value}}</dd></div></sc-for></dl>',
        ttabs(count=2),
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">', search('Search by name or phone'), RESET, '</div>',
        '<div style="border: 1px solid var(--border); border-radius: 10px">',
        '<div class="mm-supgrid mm-thead" aria-hidden="true"><span>Name</span><span>Phone</span><span>Contact person</span><span class="mm-num">Open orders</span><span class="mm-num">Balance</span><span></span></div>',
        '<ul aria-label="Suppliers" style="list-style: none; margin: 0; padding: 0">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="5"><li><div class="mm-supgrid mm-row" style="min-height: 52px">',
        '<a href="Supplier.dc.html" class="mm-rowlink" aria-label="{{r.aria}}">{{r.name}}</a>',
        '<span class="mm-muted" style="font-variant-numeric: tabular-nums">{{r.phone}}<sc-if value="{{r.hasMorePhones}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec" style="margin-left: 6px">{{r.morePhones}}</span></sc-if></span>',
        '<span class="mm-trunc">{{r.contact}}</span>',
        '<span class="mm-num">{{r.open}}</span>',
        '<span class="mm-num" style="color: {{r.balColor}}; font-weight: {{r.balWeight}}">{{r.balance}}</span>',
        menu.replace("('Archive'", ''),
        '</div></li></sc-for>', '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Clear search', 'emptyCanReset', 'emptyReset') + '</sc-if>',
        '</div>']) + DEND + sup_panel() + XEND

    ph = ptop('Suppliers', '<button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{newSupplier}}">@@I:plus@@New</button>', 'suppliers') + '\n'.join([
        '<dl class="mm-stats2"><sc-for list="{{stats}}" as="x" hint-placeholder-count="4"><div><dt>{{x.label}}</dt><dd>{{x.value}}</dd></div></sc-for></dl>',
        ttabs(count=2, phone=True),
        '<div style="display: flex; gap: 8px">' + search('Search by name or phone', phone=True) + '</div>',
        '<ul class="mm-plist" aria-label="Suppliers">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="5"><li><div class="mm-prow" style="gap: 10px; min-height: 64px; padding: 8px 4px 8px 12px">',
        '<a href="SupplierPhone.dc.html" class="mm-rowlink" aria-label="{{r.aria}}"><span class="mm-trunc" style="font-weight: 500">{{r.name}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; line-height: 18px">{{r.sub}}</span></a>',
        '<span style="flex: none; font-size: 13px; text-align: right; color: {{r.balColor}}; font-weight: {{r.balWeight}}">{{r.balance}}</span>',
        '<button type="button" class="mm-btn mm-ghost mm-icon mm-above" aria-label="{{r.menuAria}}" aria-haspopup="dialog" onClick="{{r.toggleMenu}}">' + svg(ICONS['dots'], 18) + '</button>',
        '</div></li></sc-for>', '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Clear search', 'emptyCanReset', 'emptyReset', pad='32px 16px') + '</sc-if>']) + PEND
    ph += pdrawer('menuOpen', 'closeAll', 'mm-mx-title', '{{mx.name}}', '{{mx.balance}}', '\n'.join([
        '<div role="menu" aria-labelledby="mm-mx-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<a href="SupplierPhone.dc.html" role="menuitem" class="mm-optrow">' + svg(ICONS['file'], 18) + 'Open</a>',
        '<a href="PurchaseOrderPhone.dc.html" role="menuitem" class="mm-optrow">' + svg(ICONS['plus'], 18) + 'New purchase order</a>',
        '<button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.edit}}">' + svg(ICONS['pencil'], 18) + 'Edit</button>',
        '<div role="separator" class="mm-sep"></div>',
        '<sc-if value="{{mx.notArchived}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{mx.archive}}">' + svg(ICONS['archive'], 18) + 'Archive</button></sc-if>',
        '<sc-if value="{{mx.archived}}" hint-placeholder-val="{{false}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.archive}}">' + svg(ICONS['refresh'], 18) + 'Restore</button></sc-if>',
        '</div>']), '', tall=False)
    ph += '\n' + sup_drawer() + PXEND
    js = read('supform.js') + read('suppliers.js')
    opts = ['Suppliers', 'Archived', 'Row menu', 'New supplier', 'Edit supplier', 'Missing name']
    write('Suppliers', dhead_for('suppliers', [('Inventory', 'Inventory.dc.html'), ('Suppliers', '')], 'Suppliers'), expand(d), js, props(opts, 'Suppliers'), 'mm mm-root')
    write('SuppliersPhone', phead_for('Suppliers'), expand(ph, True), js, props(opts, 'Suppliers', True), 'mm')

# ======================================================================
# Supplier
# ======================================================================
def pay_body(phone):
    top = '10px' if phone else '8px'
    h = '40px' if phone else '36px'
    return '\n'.join([
        '<div class="mm-field"><label class="mm-label" for="mm-pf-date">Date</label><div style="display: flex; gap: 8px"><input id="mm-pf-date" class="mm-input" type="date" value="{{pf.date}}" onChange="{{pf.onDate}}" style="flex: 1; min-width: 0"><button type="button" class="mm-chipq" aria-pressed="{{pf.todayOn}}" onClick="{{pf.pickToday}}" style="height: %s">Today</button></div></div>' % h,
        '<div class="mm-field"><label class="mm-label" for="mm-pf-amt">Amount</label><div style="display: flex; gap: 8px"><label class="mm-affix" style="flex: 1"><span aria-hidden="true" style="top: %s">৳</span><input id="mm-pf-amt" class="mm-input" inputMode="decimal" aria-invalid="{{pf.amtAria}}" value="{{pf.amount}}" onChange="{{pf.onAmount}}" style="font-variant-numeric: tabular-nums"></label><sc-if value="{{pf.canAll}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-chipq" onClick="{{pf.payAll}}" style="height: %s">{{pf.allText}}</button></sc-if></div>' % (top, h)
        + '<sc-if value="{{pf.amtBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter the amount paid.</p></sc-if><sc-if value="{{pf.over}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-warn">{{pf.overText}}</p></sc-if></div>',
        '<div class="mm-field"><span class="mm-label" id="mm-l-pfm">Paid by</span><div role="radiogroup" aria-labelledby="mm-l-pfm" class="mm-paygrid"><sc-for list="{{pf.methods}}" as="m" hint-placeholder-count="6"><button type="button" role="radio" class="mm-paybtn" aria-checked="{{m.on}}" onClick="{{m.pick}}">{{m.label}}</button></sc-for></div></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-pf-ref">' + opt('Reference') + '</label><input id="mm-pf-ref" class="mm-input" maxLength="100" value="{{pf.ref}}" onChange="{{pf.onRef}}"><p class="mm-hint">A bKash transaction ID or cheque number.</p></div>'])

def supplier():
    more = ('<div style="position: relative; display: flex">'
            '<button type="button" class="mm-btn mm-outline mm-icon" aria-label="More actions" aria-haspopup="menu" aria-expanded="{{moreAria}}" onClick="{{toggleMore}}">' + svg(ICONS['dots']) + '</button>'
            '<sc-if value="{{moreOpen}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close menu" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button>'
            '<div role="menu" aria-label="More actions" class="mm-menu" onKeyDown="{{escClose}}" style="top: 40px; right: 0; width: 190px">'
            '<button type="button" role="menuitem" class="mm-cmd-item" onClick="{{edit}}">' + svg(ICONS['pencil']) + 'Edit</button>'
            '<a href="{{sp.tel}}" role="menuitem" class="mm-cmd-item">' + svg(ICONS['phone']) + 'Call</a>'
            '<div role="separator" class="mm-sep"></div>'
            '<sc-if value="{{sp.notArchived}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-cmd-item" onClick="{{toggleArchive}}">' + svg(ICONS['archive']) + 'Archive</button></sc-if>'
            '<sc-if value="{{sp.archived}}" hint-placeholder-val="{{false}}"><button type="button" role="menuitem" class="mm-cmd-item" onClick="{{toggleArchive}}">' + svg(ICONS['refresh']) + 'Restore</button></sc-if>'
            '</div></sc-if></div>')
    ledger_d = '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-led" style="gap: 12px; padding: 20px 0 8px">',
        '<div class="mm-chead" style="padding: 0 20px"><h2 id="mm-c-led" class="mm-ctitle">Ledger</h2><span class="mm-muted" style="font-size: 13px">Receipts add to what you owe. Payments take it down.</span></div>',
        '<sc-if value="{{hasLedger}}" hint-placeholder-val="{{true}}"><div><div class="mm-ledgrid" aria-hidden="true" style="height: 36px; padding: 0 12px 0 20px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--muted); font-weight: 500"><span>Date</span><span>Entry</span><span class="mm-num">Amount</span><span class="mm-num">Balance</span><span></span></div>',
        '<ul aria-label="Ledger" style="list-style: none; margin: 0; padding: 0"><sc-for list="{{ledger}}" as="e" hint-placeholder-count="6"><li><div class="mm-ledgrid" style="min-height: 48px; padding: 0 12px 0 20px; border-bottom: 1px solid var(--border)">',
        '<span class="mm-muted" style="font-variant-numeric: tabular-nums">{{e.date}}</span><span class="mm-trunc">{{e.text}}</span><span class="mm-num" style="color: {{e.amtColor}}">{{e.amount}}</span><span class="mm-num" style="font-weight: 500">{{e.after}}</span>',
        '<sc-if value="{{e.isPay}}" hint-placeholder-val="{{false}}">' + dmenu('e.menuOpen', 'e.toggleMenu', 'e.menuAria', [('Delete payment', 'e.askDelete', 'trash', True)], width=180) + '</sc-if>',
        '</div></li></sc-for></ul></div></sc-if>',
        '<sc-if value="{{noLedger}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; padding: 12px 20px 16px">No receipts or payments yet.</p></sc-if>',
        '</section>'])
    orders_d = '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-pos" style="gap: 8px; padding: 20px 0 8px">',
        '<div class="mm-chead" style="padding: 0 20px"><h2 id="mm-c-pos" class="mm-ctitle">Purchase orders</h2><sc-if value="{{sp.notArchived}}" hint-placeholder-val="{{true}}"><a href="PurchaseOrder.dc.html" class="mm-btn mm-ghost" style="height: 28px; margin-right: -8px; padding: 0 8px">' + svg(ICONS['plus']) + 'New</a></sc-if></div>',
        '<sc-if value="{{hasOrders}}" hint-placeholder-val="{{true}}"><ul style="list-style: none; margin: 0; padding: 0"><sc-for list="{{orders}}" as="o" hint-placeholder-count="2"><li><div class="mm-row" style="display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 20px; border-top: 1px solid var(--border)">',
        '<a href="PurchaseOrder.dc.html" class="mm-rowlink mm-mono">{{o.ref}}</a>' + sbadge('o.badge') + '<span class="mm-muted" style="flex: 1; font-size: 13px">{{o.progress}}</span><span style="font-weight: 500; font-variant-numeric: tabular-nums">{{o.total}}</span>',
        '</div></li></sc-for></ul></sc-if>',
        '<sc-if value="{{noOrders}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; padding: 4px 20px 16px">No purchase orders yet.</p></sc-if>',
        '</section>'])
    details = ('<section class="mm-card" aria-labelledby="mm-c-sd" style="gap: 14px"><div class="mm-chead"><h2 id="mm-c-sd" class="mm-ctitle">Details</h2><button type="button" class="mm-btn mm-ghost" onClick="{{edit}}" style="height: 28px; margin-right: -8px; padding: 0 8px">Edit</button></div>'
               '<dl class="mm-dl"><sc-for list="{{details}}" as="x" hint-placeholder-count="3"><dt>{{x.label}}</dt><dd>{{x.value}}</dd></sc-for></dl></section>')
    head = back_title('Suppliers.dc.html', 'Back to suppliers', '{{sp.name}}', 'sp.archived', sbadge('archBadge')) + '\n'.join([
        '<sc-if value="{{sp.notArchived}}" hint-placeholder-val="{{true}}"><a href="PurchaseOrder.dc.html" class="mm-btn mm-outline">' + svg(ICONS['plus']) + 'New purchase order</a>',
        '<button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{openPay}}">' + svg(ICONS['wallet']) + 'Record payment</button></sc-if>',
        more, '</div>', '<p class="mm-muted" style="margin: -8px 0 0">{{sp.sub}}</p>'])
    d = '\n'.join([MAIN, head,
        '<sc-if value="{{sp.archived}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['archive']) + '<p style="margin: 0">Archived. Their orders and ledger stay; they don’t show when you start an order.</p></div></sc-if>',
        '<dl class="mm-statrow"><sc-for list="{{stats}}" as="x" hint-placeholder-count="4"><div><dt>{{x.label}}</dt><dd>{{x.value}}</dd></div></sc-for></dl>',
        '<div class="mm-cols"><div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">', ledger_d, orders_d, '</div>', details, '</div>']) + DEND
    btns = dfoot_buttons('closePay', 'pf.save', 'Record payment')
    d += dpanel('pf.open', 'closePay', 'mm-pf-title', 'Record a payment', '{{pf.sub}}', pay_body(False), '', btns[0], btns[1])
    d += '\n' + sup_panel()
    d += '\n' + palert('confirmOpen', 'Delete payment?', '<p style="margin: 0">{{confirmBody}}</p>', 'cancelConfirm', 'doDelete', 'Delete')
    d += XEND

    right = '<button type="button" class="mm-btn mm-ghost mm-icon" aria-label="More actions" aria-haspopup="dialog" onClick="{{toggleMore}}">' + svg(ICONS['dots'], 18) + '</button>'
    ph = '\n'.join([PROOT % 'var(--page)', phone_back('SuppliersPhone.dc.html', 'Back to suppliers', 'Supplier', right),
        '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
        '<section class="mm-card" style="gap: 12px"><div style="display: flex; flex-direction: column; gap: 2px"><div style="display: flex; align-items: center; gap: 8px"><h1 class="mm-trunc" style="margin: 0; font-size: 18px; line-height: 24px; font-weight: 600">{{sp.name}}</h1><sc-if value="{{sp.archived}}" hint-placeholder-val="{{false}}">' + sbadge('archBadge') + '</sc-if></div><p class="mm-muted" style="margin: 0; font-size: 13px">{{sp.sub}}</p></div>',
        '<p class="mm-big" style="margin: 0">{{sp.balance}}</p>',
        '<sc-if value="{{sp.notArchived}}" hint-placeholder-val="{{true}}"><div style="display: flex; gap: 8px"><a href="{{sp.tel}}" class="mm-btn mm-outline" style="flex: 1">' + svg(ICONS['phone']) + 'Call</a><button type="button" class="mm-btn mm-primary" style="flex: 2" onClick="{{openPay}}">' + svg(ICONS['wallet']) + 'Record payment</button></div></sc-if></section>',
        '<dl class="mm-stats2"><sc-for list="{{pstats}}" as="x" hint-placeholder-count="2"><div><dt>{{x.label}}</dt><dd style="font-size: 16px">{{x.value}}</dd></div></sc-for></dl>',
        '<section class="mm-card" aria-labelledby="mm-c-led" style="gap: 4px"><h2 id="mm-c-led" class="mm-ctitle" style="margin-bottom: 4px">Ledger</h2>',
        '<sc-if value="{{hasLedger}}" hint-placeholder-val="{{true}}"><ul class="mm-mlist"><sc-for list="{{ledger}}" as="e" hint-placeholder-count="6"><li style="flex-direction: row; align-items: center; gap: 8px"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{e.text}}</span><span class="mm-muted" style="font-size: 12px">{{e.date}} · balance {{e.after}}</span></span><span style="font-weight: 500; font-variant-numeric: tabular-nums; color: {{e.amtColor}}">{{e.amount}}</span>'
        '<sc-if value="{{e.isPay}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{e.menuAria}}" aria-haspopup="dialog" onClick="{{e.toggleMenu}}" style="margin-right: -8px">' + svg(ICONS['dots'], 18) + '</button></sc-if></li></sc-for></ul></sc-if>',
        '<sc-if value="{{noLedger}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">No receipts or payments yet.</p></sc-if></section>',
        '<section class="mm-card" aria-labelledby="mm-c-pos" style="gap: 4px"><h2 id="mm-c-pos" class="mm-ctitle" style="margin-bottom: 4px">Purchase orders</h2>',
        '<sc-if value="{{hasOrders}}" hint-placeholder-val="{{true}}"><ul class="mm-mlist"><sc-for list="{{orders}}" as="o" hint-placeholder-count="2"><li style="position: relative; flex-direction: row; align-items: center; gap: 8px"><a href="PurchaseOrderPhone.dc.html" class="mm-rowlink" style="gap: 2px"><span style="display: flex; align-items: center; gap: 8px"><span class="mm-mono" style="font-weight: 600">{{o.ref}}</span>' + sbadge('o.badge') + '</span><span class="mm-muted" style="font-size: 12px">{{o.progress}}</span></a><span style="font-weight: 500; font-variant-numeric: tabular-nums">{{o.total}}</span></li></sc-for></ul></sc-if>',
        '<sc-if value="{{noOrders}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">No purchase orders yet.</p></sc-if>',
        '<sc-if value="{{sp.notArchived}}" hint-placeholder-val="{{true}}"><a href="PurchaseOrderPhone.dc.html" class="mm-btn mm-outline" style="margin-top: 8px">' + svg(ICONS['plus']) + 'New purchase order</a></sc-if></section>',
        '<section class="mm-card" aria-labelledby="mm-c-sd" style="gap: 12px"><h2 id="mm-c-sd" class="mm-ctitle">Details</h2><dl class="mm-dl"><sc-for list="{{details}}" as="x" hint-placeholder-count="3"><dt>{{x.label}}</dt><dd>{{x.value}}</dd></sc-for></dl></section>',
        '</main>', ''])
    ph += pdrawer('moreOpen', 'closeAll', 'mm-more-title', '{{sp.name}}', '', '\n'.join([
        '<div role="menu" aria-labelledby="mm-more-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<button type="button" role="menuitem" class="mm-optrow" onClick="{{edit}}">' + svg(ICONS['pencil'], 18) + 'Edit</button>',
        '<div role="separator" class="mm-sep"></div>',
        '<sc-if value="{{sp.notArchived}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{toggleArchive}}">' + svg(ICONS['archive'], 18) + 'Archive</button></sc-if>',
        '<sc-if value="{{sp.archived}}" hint-placeholder-val="{{false}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{toggleArchive}}">' + svg(ICONS['refresh'], 18) + 'Restore</button></sc-if>',
        '</div>']), '', tall=False)
    ph += '\n' + pdrawer('menuOpen', 'closeAll', 'mm-lm-title', '{{lm.text}}', '{{lm.date}}', '<div role="menu" aria-labelledby="mm-lm-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px"><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{lm.askDelete}}">' + svg(ICONS['trash'], 18) + 'Delete payment</button></div>', '', tall=False)
    ph += '\n' + pdrawer('pf.open', 'closePay', 'mm-pf-title', 'Record a payment', '{{pf.sub}}', '<div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 8px 16px 16px">\n' + pay_body(True) + '\n</div>', pfoot('closePay', 'pf.save', 'Record payment'))
    ph += '\n' + sup_drawer()
    ph += '\n' + phalert('confirmOpen', 'Delete payment?', '<p style="margin: 0">{{confirmBody}}</p>', 'cancelConfirm', 'doDelete', 'Delete')
    ph += '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    js = read('supform.js') + read('supplier.js').replace("    vals.hasLedger = ledger.length > 0;", "    var lmRow = s.menu ? vals.ledger[rows.map(function (r) { return r.e[0]; }).indexOf(s.menu)] : null;\n    vals.menuOpen = Boolean(lmRow);\n    vals.lm = lmRow || { text: '', date: '', askDelete: function () {} };\n    vals.hasLedger = ledger.length > 0;")
    opts = ['Supplier', 'With an advance', 'Record payment', 'Paying more than owed', 'Edit supplier', 'Delete payment', 'More menu', 'Archived']
    write('Supplier', dhead_for('suppliers', [('Inventory', 'Inventory.dc.html'), ('Suppliers', 'Suppliers.dc.html'), ('{{sp.name}}', '')], 'Supplier'), expand(d), js, props(opts, 'Supplier'), 'mm mm-root')
    write('SupplierPhone', phead_for('Supplier'), expand(ph, True), js, props(opts, 'Supplier', True), 'mm')

# ======================================================================
# Counts
# ======================================================================
def nc_body(phone):
    cards = ('<div role="radiogroup" aria-labelledby="mm-l-what" style="display: flex; flex-direction: column; gap: 8px"><sc-for list="{{nf.kinds}}" as="k" hint-placeholder-count="4"><button type="button" role="radio" class="mm-rcard" aria-checked="{{k.aria}}" onClick="{{k.pick}}">'
             + radio('k.on').replace('class="mm-radio"', 'class="mm-radio" style="margin-top: 2px"') + '<span style="display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 500">{{k.label}}</span><span class="mm-muted" style="font-size: 13px; line-height: 18px">{{k.sub}}</span></span></button></sc-for></div>')
    cat = pcombo_btn('nf.cat', 'mm-l-ncat') if phone else combo_btn('nf.cat', 'mm-l-ncat')
    tag = pcombo_btn('nf.tag', 'mm-l-ntag') if phone else combo_btn('nf.tag', 'mm-l-ntag')
    if phone:
        add = '<button type="button" class="mm-addrow" aria-haspopup="dialog" onClick="{{nf.item.toggle}}">' + svg(ICONS['plus']) + 'Add an item</button>'
    else:
        add = '<div style="position: relative"><button type="button" class="mm-addrow" aria-haspopup="listbox" aria-expanded="{{nf.item.aria}}" onClick="{{nf.item.toggle}}">' + svg(ICONS['plus']) + 'Add an item</button>' + combo_pop('nf.item', 'No item found.') + '</div>'
    return '\n'.join([
        '<div class="mm-field" style="gap: 0"><p id="mm-l-what" class="mm-label" style="margin: 0 0 10px">What to count</p>' + cards + '</div>',
        '<sc-if value="{{nf.isCat}}" hint-placeholder-val="{{false}}"><div class="mm-field"><span class="mm-label" id="mm-l-ncat">Category</span>' + cat + '</div></sc-if>',
        '<sc-if value="{{nf.isTag}}" hint-placeholder-val="{{false}}"><div class="mm-field"><span class="mm-label" id="mm-l-ntag">Tag</span>' + tag + '</div></sc-if>',
        '<sc-if value="{{nf.isItems}}" hint-placeholder-val="{{false}}"><div class="mm-field"><span class="mm-label">Items</span><sc-if value="{{nf.hasChips}}" hint-placeholder-val="{{true}}"><div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px"><sc-for list="{{nf.chips}}" as="ch" hint-placeholder-count="2"><span class="mm-chip">{{ch.label}}<button type="button" aria-label="{{ch.removeAria}}" onClick="{{ch.remove}}">' + svg(ICONS['x'], 12) + '</button></span></sc-for></div></sc-if>' + add + '</div></sc-if>',
        '<div class="mm-field"><label class="mm-label" for="mm-nc-note">' + opt('Note') + '</label><input id="mm-nc-note" class="mm-input" maxLength="500" value="{{nf.note}}" onChange="{{nf.onNote}}" placeholder="Where to look, who counts"></div>',
        '<sc-if value="{{nf.hasSummary}}" hint-placeholder-val="{{true}}"><div class="mm-note" style="font-size: 13px">' + svg(ICONS['scan']) + '<p style="margin: 0">{{nf.summary}}</p></div></sc-if>'])

def counts():
    acts = '<button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{newCount}}">@@I:plus@@New count</button>'
    menu = dmenu('r.menuOpen', 'r.toggleMenu', 'r.menuAria', [('link', 'Open', 'Count.dc.html', 'file'), ('Cancel count', 'r.ask', 'ban', 'r.canCancel')], width=180)
    menu = menu.replace('<sc-if value="{{r.canCancel}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-cmd-item"', '<sc-if value="{{r.canCancel}}" hint-placeholder-val="{{true}}"><div role="separator" class="mm-sep"></div><button type="button" role="menuitem" class="mm-cmd-item mm-danger"')
    d = dtop('Stock counts', acts, 'counts') + '\n'.join([
        '<p class="mm-muted" style="margin: 0">Count what is on the shelf while you keep selling, then apply only the real differences.</p>',
        ttabs(count=5),
        '<div style="border: 1px solid var(--border); border-radius: 10px">',
        '<div class="mm-cntgrid mm-thead" aria-hidden="true"><span>Count</span><span>What</span><span>Status</span><span>Counted</span><span>Differences</span><span>Started</span><span></span></div>',
        '<ul aria-label="Stock counts" style="list-style: none; margin: 0; padding: 0">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="4"><li><div class="mm-cntgrid mm-row" style="min-height: 56px">',
        '<a href="Count.dc.html" class="mm-rowlink mm-mono" aria-label="{{r.aria}}">{{r.ref}}</a>',
        '<span class="mm-trunc">{{r.what}}</span>',
        '<span>' + sbadge('r.badge') + '</span>',
        prog('r'),
        '<span class="mm-trunc" style="color: {{r.diffColor}}">{{r.diff}}</span>',
        '<span class="mm-muted">{{r.started}}</span>',
        menu,
        '</div></li></sc-for>', '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Show all counts', 'emptyCanReset', 'emptyReset') + '</sc-if>',
        '</div>']) + DEND
    btns = dfoot_buttons('closeForm', 'nf.start', 'Start counting', 'nf.cant')
    d += dpanel('nf.open', 'closeForm', 'mm-nf-title', 'New count', 'Choose what to count. Selling goes on while you count.', nc_body(False), '', btns[0], btns[1])
    d += '\n' + palert('confirmOpen', '{{confirmTitle}}', '<p style="margin: 0">Nothing changes in stock. The numbers counted so far are kept with the count.</p>', 'cancelConfirm', 'doCancel', 'Cancel count')
    d += XEND

    ph = ptop('Stock counts', '<button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{newCount}}">@@I:plus@@New</button>', 'counts') + '\n'.join([
        ttabs(count=5, phone=True),
        '<ul class="mm-plist" aria-label="Stock counts">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="4"><li><div class="mm-prow" style="align-items: flex-start; gap: 10px; padding: 12px 4px 12px 12px">',
        '<a href="CountPhone.dc.html" class="mm-rowlink" aria-label="{{r.aria}}" style="gap: 3px"><span style="display: flex; align-items: center; gap: 8px"><span class="mm-mono" style="font-weight: 600">{{r.ref}}</span>' + sbadge('r.badge') + '</span><span class="mm-trunc mm-muted" style="font-size: 13px; line-height: 18px">{{r.meta}}</span>'
        '<span style="display: flex; align-items: center; gap: 8px; margin-top: 2px"><span class="mm-prog" style="flex: 1"><span style="width: {{r.pct}}; background: {{r.progColor}}"></span></span><span class="mm-muted" style="flex: none; font-size: 12px; line-height: 16px">{{r.progress}}</span></span>'
        '<sc-if value="{{r.hasDiff}}" hint-placeholder-val="{{true}}"><span style="font-size: 13px; line-height: 18px; color: {{r.diffColor}}">{{r.diff}}</span></sc-if></a>',
        '<button type="button" class="mm-btn mm-ghost mm-icon mm-above" aria-label="{{r.menuAria}}" aria-haspopup="dialog" onClick="{{r.toggleMenu}}" style="margin-top: -6px">' + svg(ICONS['dots'], 18) + '</button>',
        '</div></li></sc-for>', '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Show all counts', 'emptyCanReset', 'emptyReset', pad='32px 16px') + '</sc-if>']) + PEND
    ph += pdrawer('menuOpen', 'closeAll', 'mm-mx-title', '{{mx.ref}}', '{{mx.what}}', '\n'.join([
        '<div role="menu" aria-labelledby="mm-mx-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<a href="CountPhone.dc.html" role="menuitem" class="mm-optrow">' + svg(ICONS['file'], 18) + 'Open</a>',
        '<sc-if value="{{mx.canCancel}}" hint-placeholder-val="{{true}}"><div role="separator" class="mm-sep"></div><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{mx.ask}}">' + svg(ICONS['ban'], 18) + 'Cancel count</button></sc-if>',
        '</div>']), '', tall=False)
    ph += '\n' + pdrawer('nf.open', 'closeForm', 'mm-nf-title', 'New count', '', '<div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 8px 16px 16px">\n' + nc_body(True) + '\n</div>', pfoot('closeForm', 'nf.start', 'Start counting', 'nf.cant'))
    ph += '\n@@PCOMBO@@\n' + phalert('confirmOpen', '{{confirmTitle}}', '<p style="margin: 0">Nothing changes in stock. The numbers counted so far are kept with the count.</p>', 'cancelConfirm', 'doCancel', 'Cancel count')
    ph += PXEND
    js = read('countdata.js') + read('counts.js')
    opts = ['Counts', 'In review', 'Row menu', 'New count', 'New count: a category', 'New count: items I choose', 'Cancel count']
    write('Counts', dhead_for('counts', [('Inventory', 'Inventory.dc.html'), ('Counts', '')], 'Stock counts'), expand(d), js, props(opts, 'Counts'), 'mm mm-root')
    write('CountsPhone', phead_for('Stock counts'), expand(ph, True), js, props(opts, 'Counts', True), 'mm')

# ======================================================================
# A count
# ======================================================================
def stepper(phone):
    sz = 18 if phone else 14
    return ('<div class="mm-step"><button type="button" aria-label="One less" disabled="{{l.minusOff}}" onClick="{{l.minus}}">' + svg(ICONS['minus'], sz) + '</button>'
            '<input inputMode="numeric" aria-label="{{l.aria}}" placeholder="—" value="{{l.counted}}" onChange="{{l.onCount}}">'
            '<button type="button" aria-label="One more" onClick="{{l.plus}}">' + svg(ICONS['plus'], sz) + '</button></div>')

def count_body(phone):
    pad = '12px' if phone else '16px'
    h = '40px' if phone else '36px'
    scan = '\n'.join([
        '<sc-if value="{{hd.counting}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-label="Scan"%s>' % (' style="gap: 12px"' if phone else ' style="gap: 12px"'),
        '<div style="display: flex; gap: 8px"><div style="position: relative; flex: 1; min-width: 0">' + svg(ICONS['scan'], 16, 'position: absolute; left: 12px; top: %s; color: var(--muted-foreground); pointer-events: none' % ('12px' if phone else '10px')) +
        '<input class="mm-input" aria-label="Scan or type a barcode or SKU" placeholder="Scan or type a barcode or SKU" autoComplete="off" autoFocus="{{true}}" value="{{code}}" onChange="{{onCode}}" onKeyDown="{{codeKey}}" style="padding-left: 36px"></div>'
        '<button type="button" class="mm-btn mm-outline" onClick="{{addCode}}" style="height: %s">Add</button>' % h +
        ('' if phone else '<button type="button" class="mm-btn mm-outline" aria-pressed="{{cameraAria}}" onClick="{{toggleCamera}}" style="height: 36px">' + svg(ICONS['camera']) + '{{cameraText}}</button>') + '</div>',
        ('<button type="button" class="mm-btn mm-outline" aria-pressed="{{cameraAria}}" onClick="{{toggleCamera}}" style="height: 40px">' + svg(ICONS['camera']) + '{{cameraText}}</button>' if phone else ''),
        '<sc-if value="{{camera}}" hint-placeholder-val="{{false}}"><div class="mm-camera" role="img" aria-label="Camera">Point the camera at a barcode</div></sc-if>',
        '<sc-if value="{{hasLast}}" hint-placeholder-val="{{false}}"><p role="status" style="display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 500; color: var(--success)">' + svg(ICONS['ok']) + '{{lastText}}</p></sc-if>',
        '<sc-if value="{{hasNotFound}}" hint-placeholder-val="{{false}}"><p role="alert" style="display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 500; color: var(--destructive)">' + svg(ICONS['alert']) + '{{notFoundText}}</p></sc-if>',
        '<p class="mm-muted" style="margin: 0; font-size: 13px">A scanner types into this box. Scanning an item again adds one.</p>',
        '</section></sc-if>'])
    if phone:
        cline = ('<ul class="mm-plist" aria-label="Items"><sc-for list="{{lines}}" as="l" hint-placeholder-count="5"><li><div class="mm-prow" style="gap: 10px; padding: 10px 12px; background: {{l.rowBg}}">'
                 '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{l.title}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; line-height: 18px">{{l.opts}}</span><span class="mm-trunc mm-muted" style="font-size: 12px; line-height: 16px">{{l.sub}}</span></span>'
                 + stepper(True) + '</div></li></sc-for></ul>')
        rline = ('<ul class="mm-plist" aria-label="Items"><sc-for list="{{lines}}" as="l" hint-placeholder-count="5"><li><div class="mm-prow" style="flex-direction: column; align-items: stretch; gap: 8px; padding: 10px 12px">'
                 '<div style="display: flex; align-items: flex-start; gap: 8px"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{l.title}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; line-height: 18px">{{l.opts}}</span></span>'
                 '<span style="display: flex; flex-direction: column; align-items: flex-end"><span style="font-weight: {{l.diffWeight}}; color: {{l.diffColor}}; font-variant-numeric: tabular-nums">{{l.diff}}</span><span class="mm-muted" style="font-size: 12px">{{l.value}}</span></span></div>'
                 '<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px"><span class="mm-muted" style="font-size: 13px">Expected {{l.expected}}</span><sc-if value="{{editable}}" hint-placeholder-val="{{true}}">' + stepper(True) + '</sc-if><sc-if value="{{readOnly}}" hint-placeholder-val="{{false}}"><span style="font-variant-numeric: tabular-nums">Counted {{l.countedText}}</span></sc-if></div>'
                 '</div></li></sc-for></ul>')
    else:
        cline = ('<div style="border: 1px solid var(--border); border-bottom: 0; border-radius: 10px; overflow: hidden"><ul aria-label="Items" style="list-style: none; margin: 0; padding: 0"><sc-for list="{{lines}}" as="l" hint-placeholder-count="5"><li style="border-bottom: 1px solid var(--border)"><div class="mm-cntline" style="min-height: 56px; padding: 8px 12px 8px 16px; background: {{l.rowBg}}">'
                 '<span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{l.title}}<span class="mm-muted" style="font-weight: 400"> · {{l.opts}}</span></span><span class="mm-trunc mm-muted mm-code" style="font-size: 12px">{{l.sub}}</span></span>'
                 + stepper(False) + '</div></li></sc-for></ul></div>')
        rline = ('<div style="border: 1px solid var(--border); border-radius: 10px"><div class="mm-revgrid mm-thead" aria-hidden="true"><span>Item</span><span class="mm-num">Expected</span><span style="text-align: center">Counted</span><span class="mm-num">Difference</span><span class="mm-num">Value</span></div>'
                 '<ul aria-label="Items" style="list-style: none; margin: 0; padding: 0"><sc-for list="{{lines}}" as="l" hint-placeholder-count="5"><li style="border-top: 1px solid var(--border)"><div class="mm-revgrid" style="min-height: 52px; padding: 6px 16px">'
                 '<span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{l.title}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{l.opts}}</span></span>'
                 '<span class="mm-num mm-muted">{{l.expected}}</span>'
                 '<span style="display: flex; justify-content: center"><sc-if value="{{editable}}" hint-placeholder-val="{{true}}"><input class="mm-input mm-qty" inputMode="numeric" aria-label="{{l.aria}}" placeholder="—" value="{{l.counted}}" onChange="{{l.onCount}}" style="width: 72px"></sc-if><sc-if value="{{readOnly}}" hint-placeholder-val="{{false}}"><span style="font-variant-numeric: tabular-nums">{{l.countedText}}</span></sc-if></span>'
                 '<span class="mm-num" style="font-weight: {{l.diffWeight}}; color: {{l.diffColor}}">{{l.diff}}</span>'
                 '<span class="mm-num">{{l.value}}</span>'
                 '</div></li></sc-for></ul></div>')
    tabs_c = '<div role="tablist" aria-label="Show" class="mm-tabs mm-ttabs" style="align-self: flex-start; height: %s"><sc-for list="{{ctabs}}" as="t" hint-placeholder-count="2"><button type="button" role="tab" class="mm-tab" aria-selected="{{t.on}}" onClick="{{t.pick}}">{{t.label}}<span class="mm-tabcount">{{t.count}}</span></button></sc-for></div>' % ('40px' if phone else '36px')
    tabs_r = tabs_c.replace('{{ctabs}}', '{{rtabs}}')
    empty = '<sc-if value="{{noLines}}" hint-placeholder-val="{{false}}"><div class="mm-emptybox"><p style="margin: 0">{{noLinesText}}</p></div></sc-if>'
    return '\n'.join([
        '<sc-if value="{{hd.hasNote}}" hint-placeholder-val="{{true}}"><div class="mm-note">' + svg(ICONS['file']) + '<p style="margin: 0">{{hd.note}}</p></div></sc-if>',
        '<sc-if value="{{isApplied}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['ok'], 16, 'color: var(--success)') + '<p style="margin: 0">{{appliedText}}</p></div></sc-if>',
        '<sc-if value="{{isCancelled}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['ban']) + '<p style="margin: 0">Cancelled. Nothing changed in stock. The numbers counted are kept here.</p></div></sc-if>',
        '<sc-if value="{{hd.counting}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-label="Progress" style="gap: 10px"><div style="display: flex; justify-content: space-between; gap: 8px"><span style="font-weight: 600">{{hd.progress}}</span><span class="mm-muted">{{hd.left}}</span></div><span class="mm-prog" style="height: 8px"><span style="width: {{hd.pct}}; background: {{hd.progColor}}"></span></span></section></sc-if>',
        scan,
        '<sc-if value="{{hd.counting}}" hint-placeholder-val="{{true}}">' + tabs_c + cline + '</sc-if>',
        '<sc-if value="{{showReview}}" hint-placeholder-val="{{false}}"><div class="mm-sum" role="status">' + svg(ICONS['scan']) + '<p style="margin: 0">{{summary}}</p></div>'
        '<sc-if value="{{hasMissing}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; font-size: 13px">{{missingText}}</p></sc-if>' + tabs_r + rline + '</sc-if>',
        empty])

def count():
    more = ('<sc-if value="{{hd.open}}" hint-placeholder-val="{{true}}"><div style="position: relative; display: flex">'
            '<button type="button" class="mm-btn mm-outline mm-icon" aria-label="More actions" aria-haspopup="menu" aria-expanded="{{moreAria}}" onClick="{{toggleMore}}">' + svg(ICONS['dots']) + '</button>'
            '<sc-if value="{{moreOpen}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close menu" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button>'
            '<div role="menu" aria-label="More actions" class="mm-menu" onKeyDown="{{escClose}}" style="top: 40px; right: 0; width: 200px">'
            '<button type="button" role="menuitem" class="mm-cmd-item" onClick="{{printSheet}}">' + svg(ICONS['printer']) + 'Print count sheet</button>'
            '<div role="separator" class="mm-sep"></div>'
            '<button type="button" role="menuitem" class="mm-cmd-item mm-danger" onClick="{{askCancel}}">' + svg(ICONS['ban']) + 'Cancel count</button>'
            '</div></sc-if></div></sc-if>')
    head = back_title('Counts.dc.html', 'Back to counts', '{{hd.ref}}', 'true', sbadge('hd.badge')) + '\n'.join([
        '<sc-if value="{{hd.counting}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" onClick="{{submit}}">' + svg(ICONS['check']) + 'Done counting</button></sc-if>',
        '<sc-if value="{{hd.review}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline" onClick="{{reopen}}">Back to counting</button><button type="button" class="mm-btn mm-primary" onClick="{{askApply}}">Apply differences</button></sc-if>',
        more, '</div>', '<p class="mm-muted" style="margin: -8px 0 0">{{hd.sub}}</p>'])
    d = '\n'.join([MAIN, '<div class="mm-col">', head, count_body(False), '</div>']) + DEND
    apply_body = '<p style="margin: 0">{{applyBody}}</p><p style="margin: 0">{{applyValue}}</p><sc-if value="{{overThreshold}}" hint-placeholder-val="{{true}}"><p style="margin: 0; font-size: 13px">{{approvalText}}</p></sc-if>'
    d += palert('applyOpen', '{{applyTitle}}', apply_body, 'cancelConfirm', 'doApply', 'Apply differences', danger=False)
    d += '\n' + palert('cancelOpen', '{{cancelTitle}}', '<p style="margin: 0">Nothing changes in stock. The numbers counted so far are kept with the count.</p>', 'cancelConfirm', 'doCancel', 'Cancel count')
    d += XEND

    right = '<sc-if value="{{hd.open}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="More actions" aria-haspopup="dialog" onClick="{{toggleMore}}">' + svg(ICONS['dots'], 18) + '</button></sc-if>'
    pbottom = ('<sc-if value="{{hd.counting}}" hint-placeholder-val="{{true}}"><div style="display: flex; flex: none; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--background)"><button type="button" class="mm-btn mm-primary" style="flex: 1" onClick="{{submit}}">Done counting</button></div></sc-if>'
               '<sc-if value="{{hd.review}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex: none; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--background)"><button type="button" class="mm-btn mm-outline" style="flex: 1" onClick="{{reopen}}">Back to counting</button><button type="button" class="mm-btn mm-primary" style="flex: 1" onClick="{{askApply}}">Apply differences</button></div></sc-if>')
    ph = '\n'.join([PROOT % 'var(--page)', phone_back('CountsPhone.dc.html', 'Back to counts', '{{hd.ref}}', right),
        '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
        '<div style="display: flex; flex-direction: column; gap: 6px; padding: 4px 4px 0"><span>' + sbadge('hd.badge') + '</span><p class="mm-muted" style="margin: 0; font-size: 13px">{{hd.sub}}</p></div>',
        count_body(True), '</main>', pbottom, ''])
    ph += pdrawer('moreOpen', 'closeAll', 'mm-more-title', '{{hd.ref}}', '', '\n'.join([
        '<div role="menu" aria-labelledby="mm-more-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<button type="button" role="menuitem" class="mm-optrow" onClick="{{printSheet}}">' + svg(ICONS['printer'], 18) + 'Print count sheet</button>',
        '<div role="separator" class="mm-sep"></div>',
        '<button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{askCancel}}">' + svg(ICONS['ban'], 18) + 'Cancel count</button>',
        '</div>']), '', tall=False)
    ph += '\n' + phalert('applyOpen', '{{applyTitle}}', apply_body, 'cancelConfirm', 'doApply', 'Apply differences', danger=False)
    ph += '\n' + phalert('cancelOpen', '{{cancelTitle}}', '<p style="margin: 0">Nothing changes in stock. The numbers counted so far are kept with the count.</p>', 'cancelConfirm', 'doCancel', 'Cancel count')
    ph += '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    js = read('countdata.js') + read('count.js').replace("    vals.camera = Boolean(s.camera);", "    vals.camera = Boolean(s.camera);\n    vals.cameraAria = s.camera ? 'true' : 'false';").replace("    vals.editable = counting || review;", "    vals.editable = counting || review;\n    vals.showReview = !counting;")
    opts = ['Counting', 'After a scan', 'Not counted only', 'Code not found', 'In review', 'Apply differences', 'Cancel count', 'Applied']
    write('Count', dhead_for('counts', [('Inventory', 'Inventory.dc.html'), ('Counts', 'Counts.dc.html'), ('{{hd.ref}}', '')], 'Stock count'), expand(d), js, props(opts, 'Counting'), 'mm mm-root')
    write('CountPhone', phead_for('Stock count'), expand(ph, True), js, props(opts, 'Counting', True), 'mm')

ALL = {'stock': stock, 'adjustments': adjustments, 'pos': pos, 'po': po, 'receive': receive, 'suppliers': suppliers, 'supplier': supplier, 'counts': counts, 'count': count}
