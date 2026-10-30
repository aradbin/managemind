import os, sys, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ord'))
from opages import *
import build as B

def rread(n): return open('rep/' + n, encoding='utf-8').read()

ICONS.update({
    'chart': '<path d="M3 3v16a2 2 0 0 0 2 2h16"></path><path d="m19 9-5 5-4-4-3 3"></path>',
    'table': '<path d="M12 3v18"></path><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path><path d="M3 15h18"></path>',
})

RSECTIONS = [('overview', 'Overview', 'Reports'), ('sales', 'Sales', 'SalesReport'), ('profit', 'Profit', 'ProfitReport'), ('stock', 'Stock', 'StockReport'),
             ('suppliers', 'Suppliers', 'SupplierReport'), ('expenses', 'Expenses', 'ExpenseReport'), ('cod', 'COD outstanding', 'CodOutstanding')]

def rsections(cur, phone=False):
    out = ''.join('<a href="%s%s.dc.html" class="mm-tab"%s>%s</a>' % (f, 'Phone' if phone else '', ' aria-current="page"' if k == cur else '', lab) for k, lab, f in RSECTIONS)
    if phone:
        return '<nav aria-label="Report sections" style="margin: 0 -16px; padding: 0 16px; overflow-x: auto; scrollbar-width: none">\n<div class="mm-secbar">' + out + '</div>\n</nav>'
    return '<nav aria-label="Report sections" style="overflow-x: auto">\n<div class="mm-secbar">' + out + '</div>\n</nav>'

REP_LI = re.search(r'<li><a href="(?:#|Reports.dc.html)" class="mm-nav">(<svg(?:(?!</svg>).)*</svg>)<span style="flex: 1">Reports</span><svg(?:(?!</svg>).)*</svg></a></li>', B.dhead)
assert REP_LI
def rep_group(cur):
    subs = ''.join('<li><a href="%s.dc.html" class="mm-subbtn"%s>%s</a></li>' % (f, ' aria-current="page"' if k == cur else '', lab) for k, lab, f in RSECTIONS)
    return '<li><a href="Reports.dc.html" class="mm-nav" aria-expanded="true">' + REP_LI.group(1) + '<span style="flex: 1">Reports</span>' + B.CHEV_DOWN + '</a>\n<ul class="mm-sub">\n' + subs + '\n</ul></li>'

RCSS = '''
.mm{--bar:#155dfc}
.mm-tab[aria-pressed=true]{background:var(--background);color:var(--foreground);box-shadow:0 1px 3px 0 rgb(0 0 0 / .1),0 1px 2px -1px rgb(0 0 0 / .1)}
.mm.dark .mm-tab[aria-pressed=true]{background:var(--input);border-color:var(--input)}
.mm.dark{--bar:#2b7fff}
.mm-blocks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
.mm-rtab{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.mm-rtab th{height:36px;padding:0 12px;background:var(--muted);color:var(--muted-foreground);font-weight:500;white-space:nowrap;border-top:1px solid var(--border)}
.mm-rtab th:first-child{padding-left:16px}
.mm-rtab th:last-child,.mm-rtab td:last-child{padding-right:16px}
.mm-rtab td{height:40px;padding:0 12px;white-space:nowrap}
.mm-rtab td:first-child{white-space:normal;min-width:120px}
.mm-rwrap{overflow-x:auto}
.mm-rwrap:focus-visible{outline:2px solid var(--ring);outline-offset:-2px}
.mm-chart{position:relative;display:flex;flex-direction:column;gap:6px}
.mm-plot{position:relative;height:200px;margin-left:44px}
.mm-tick{position:absolute;left:0;right:0;height:0;border-top:1px solid var(--border)}
.mm-tick>span{position:absolute;right:calc(100% + 8px);top:-8px;font-size:11px;line-height:16px;color:var(--muted-foreground);white-space:nowrap;font-variant-numeric:tabular-nums}
.mm-bars{position:absolute;inset:0;display:flex;align-items:flex-end;gap:2px}
.mm-bcol{position:relative;flex:1;min-width:0;height:100%;display:flex;align-items:flex-end;justify-content:center;outline:none;cursor:default}
.mm-bcol>i{display:block;width:100%;max-width:24px;border-radius:4px 4px 0 0;background:var(--bar)}
.mm-bcol:hover>i,.mm-bcol:focus-visible>i{opacity:.8}
.mm-bcol>b{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);z-index:5;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--popover);color:var(--foreground);font-size:12px;font-weight:500;line-height:16px;white-space:nowrap;box-shadow:0 4px 12px rgb(0 0 0 / .1)}
.mm-bcol:hover>b,.mm-bcol:focus-visible>b{display:block}
.mm-bcol:focus-visible{box-shadow:inset 0 0 0 2px var(--ring);border-radius:4px}
.mm-xlab{display:flex;gap:2px;margin-left:44px;font-size:11px;line-height:16px;color:var(--muted-foreground)}
.mm-xlab>span{flex:1;min-width:0;text-align:center;white-space:nowrap;overflow:visible}
.mm-statrow dd small{display:block;margin-top:2px;font-size:12px;font-weight:500;line-height:16px}
'''
RPCSS = '''
.mm-blocks{grid-template-columns:minmax(0,1fr);gap:12px}
.mm-rtab th:first-child,.mm-rtab td:first-child{padding-left:14px}
.mm-plot{height:160px;margin-left:40px}
.mm-xlab{margin-left:40px}
.mm-stats2 dd small{display:block;margin-top:2px;font-size:12px;font-weight:500;line-height:16px}
'''

def rdhead_for(cur, crumbs, title):
    h = dhead_for(None, crumbs, title)
    h = h.replace(B.inv_group(None), B.m.group(0).replace('href="#"', 'href="Inventory.dc.html"'), 1)
    h = h.replace(REP_LI.group(0), rep_group(cur), 1)
    k = h.rindex('</style>')
    return h[:k] + OCSS + RCSS + h[k:]

def rphead_for(title):
    h = phead_for(title)
    k = h.rindex('</style>')
    return h[:k] + OCSS + PCSS + RCSS + RPCSS + h[k:]

RTABBAR = TABBAR.replace(
    '<a href="#" class="mm-tabitem"><span class="mm-pill"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2',
    '<a href="OrdersPhone.dc.html" class="mm-tabitem"><span class="mm-pill"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2')
assert 'OrdersPhone' in RTABBAR

def rexpand(t, phone=False):
    t = re.sub(r'@@RSECTIONS:(\w+)@@', lambda mm: rsections(mm.group(1), phone), t)
    t = t.replace('@@TABBAR@@', RTABBAR)
    return expand(t, phone)

RSHARED = OSHARED + rread('shared.js')

# ---------- the report body ----------
def range_ctl(phone):
    chips = ('<div role="group" aria-label="Dates" class="mm-tabs" style="height: %s; flex: none"><sc-for list="{{rg.presets}}" as="pr" hint-placeholder-count="4"><button type="button" class="mm-tab" aria-pressed="{{pr.on}}" aria-current="{{pr.on}}" onClick="{{pr.pick}}" style="%s">{{pr.label}}</button></sc-for></div>'
             % ('40px' if phone else '36px', 'height: 34px; padding: 0 12px' if phone else 'height: 30px'))
    chips = chips.replace(' aria-current="{{pr.on}}"', '')
    fields = ('<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">'
              '<div class="mm-field"><label class="mm-label" for="mm-rg-from">From</label><input id="mm-rg-from" class="mm-input" type="date" value="{{rg.from}}" onChange="{{rg.onFrom}}"></div>'
              '<div class="mm-field"><label class="mm-label" for="mm-rg-to">To</label><input id="mm-rg-to" class="mm-input" type="date" aria-invalid="{{rg.badAria}}" value="{{rg.to}}" onChange="{{rg.onTo}}"></div></div>'
              '<sc-if value="{{rg.bad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err" style="margin: 0">The end comes before the start.</p></sc-if>')
    if phone:
        return ('<nav aria-label="Dates" style="margin: 0 -16px; padding: 0 16px; overflow-x: auto; scrollbar-width: none">' + chips + '</nav>'
                '<p class="mm-muted" style="margin: -4px 0 0; font-size: 13px; display: flex; align-items: center; gap: 6px">' + svg(ICONS['calendar'], 14) + '{{rg.text}}<sc-if value="{{rg.isCustom}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-ghost" style="height: 28px; margin-left: auto; padding: 0 8px" aria-haspopup="dialog" onClick="{{rg.toggle}}">Change</button></sc-if></p>'), fields
    return ('<div style="position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 12px">' + chips
            + '<span class="mm-muted" style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px">' + svg(ICONS['calendar'], 14) + '{{rg.text}}</span>'
            + '<sc-if value="{{rg.open}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close dates" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button>'
            + '<div class="mm-pop" role="dialog" aria-label="Custom dates" onKeyDown="{{escClose}}" style="top: 42px; left: 0; width: 320px; display: flex; flex-direction: column; gap: 12px; padding: 12px">' + fields + '</div></sc-if></div>'), fields

def controls(phone):
    seg = ('<sc-for list="{{controls}}" as="ct" hint-placeholder-count="1"><div style="display: flex; align-items: center; gap: 8px%s"><span class="mm-label" style="font-size: 13px; white-space: nowrap">{{ct.label}}</span>'
           '<div role="group" aria-label="{{ct.label}}" class="mm-tabs" style="height: %s"><sc-for list="{{ct.opts}}" as="co" hint-placeholder-count="3"><button type="button" class="mm-tab" aria-pressed="{{co.on}}" onClick="{{co.pick}}" style="%s">{{co.label}}</button></sc-for></div></div></sc-for>'
           % ('; overflow-x: auto' if phone else '', '40px' if phone else '36px', 'height: 34px; padding: 0 12px' if phone else 'height: 30px'))
    return '<sc-if value="{{hasControls}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px">' + seg + '</div></sc-if>'

NOTES = ('<sc-for list="{{notes}}" as="nt" hint-placeholder-count="1"><sc-if value="{{nt.warn}}" hint-placeholder-val="{{false}}"><div class="mm-banner" role="note" style="font-size: 13px">' + svg(ICONS['alert']) + '<p style="margin: 0">{{nt.text}}</p></div></sc-if>'
         '<sc-if value="{{nt.info}}" hint-placeholder-val="{{true}}"><p class="mm-muted" style="margin: 0; font-size: 13px; display: flex; gap: 6px; align-items: flex-start">' + svg(ICONS['info'], 14, 'flex: none; margin-top: 3px') + '<span>{{nt.text}}</span></p></sc-if></sc-for>')

def stats(phone):
    cls = 'mm-stats2' if phone else 'mm-statrow'
    return ('<sc-if value="{{hasStats}}" hint-placeholder-val="{{true}}"><dl class="%s"><sc-for list="{{stats}}" as="x" hint-placeholder-count="4"><div><dt>{{x.label}}</dt><dd>{{x.value}}<sc-if value="{{x.hasSub}}" hint-placeholder-val="{{false}}"><small style="color: {{x.subColor}}">{{x.sub}}</small></sc-if></dd></div></sc-for></dl></sc-if>' % cls)

CHART = ('<sc-if value="{{hasChart}}" hint-placeholder-val="{{false}}"><section class="mm-card" aria-labelledby="mm-c-ch" style="gap: 16px">'
         '<div class="mm-chead"><h2 id="mm-c-ch" class="mm-ctitle">{{chart.title}}</h2><span class="mm-muted" style="font-size: 13px">{{chart.sub}}</span></div>'
         '<div class="mm-chart" role="group" aria-label="{{chart.title}}"><div class="mm-plot"><sc-for list="{{chart.ticks}}" as="tk" hint-placeholder-count="4"><div class="mm-tick" style="bottom: {{tk.pos}}"><span>{{tk.label}}</span></div></sc-for>'
         '<div class="mm-bars"><sc-for list="{{chart.bars}}" as="br" hint-placeholder-count="12"><div class="mm-bcol" tabIndex="0" role="img" aria-label="{{br.tip}}"><i style="height: {{br.h}}"></i><b>{{br.tip}}</b></div></sc-for></div></div>'
         '<div class="mm-xlab" aria-hidden="true"><sc-for list="{{chart.bars}}" as="bx" hint-placeholder-count="12"><span>{{bx.xl}}</span></sc-for></div></div></section></sc-if>')

def blocks(phone):
    exp = ('<div style="position: relative; display: flex">'
           '<button type="button" class="mm-btn mm-ghost" aria-label="{{bk.expLabel}}" aria-haspopup="menu" aria-expanded="{{bk.expAria}}" onClick="{{bk.toggleExp}}" style="height: 28px; margin-right: -8px; padding: 0 8px">' + svg(ICONS['download']) + 'Export</button>'
           '<sc-if value="{{bk.expOpen}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close menu" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button>'
           '<div role="menu" aria-label="{{bk.expLabel}}" class="mm-menu" onKeyDown="{{escClose}}" style="top: 32px; right: -8px; width: 160px">'
           '<button type="button" role="menuitem" class="mm-cmd-item" onClick="{{bk.toExcel}}">' + svg(ICONS['table']) + 'Excel</button>'
           '<button type="button" role="menuitem" class="mm-cmd-item" onClick="{{bk.toCsv}}">' + svg(ICONS['file']) + 'CSV</button></div></sc-if></div>')
    return ('<div class="mm-blocks"><sc-for list="{{blocks}}" as="bk" hint-placeholder-count="2"><div style="grid-column: {{bk.span}}; min-width: 0">'
            '<sc-if value="{{bk.isHeading}}" hint-placeholder-val="{{false}}"><h2 style="margin: 8px 0 0; font-size: 16px; line-height: 24px; font-weight: 600">{{bk.text}}</h2></sc-if>'
            '<sc-if value="{{bk.isTable}}" hint-placeholder-val="{{true}}"><section class="mm-card" style="gap: 12px; padding: 16px 0 0; overflow: visible">'
            '<div style="display: flex; align-items: flex-start; gap: 8px; padding: 0 16px"><div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px"><h2 class="mm-ctitle">{{bk.caption}}</h2><sc-if value="{{bk.hasSub}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; font-size: 13px">{{bk.sub}}</p></sc-if></div>'
            '<sc-if value="{{bk.has}}" hint-placeholder-val="{{true}}">' + exp + '</sc-if></div>'
            '<sc-if value="{{bk.has}}" hint-placeholder-val="{{true}}"><div class="mm-rwrap" tabIndex="0" role="region" aria-label="{{bk.caption}}" style="border-radius: 0 0 14px 14px"><table class="mm-rtab"><thead><tr><sc-for list="{{bk.head}}" as="th" hint-placeholder-count="4"><th scope="col" style="text-align: {{th.align}}">{{th.text}}</th></sc-for></tr></thead>'
            '<tbody><sc-for list="{{bk.rows}}" as="rr" hint-placeholder-count="4"><tr style="background: {{rr.bg}}; border-top: {{rr.border}}"><sc-for list="{{rr.cells}}" as="rc" hint-placeholder-count="4"><td style="text-align: {{rc.align}}; font-weight: {{rc.weight}}; color: {{rc.color}}; padding-left: {{rc.indent}}">{{rc.text}}</td></sc-for></tr></sc-for></tbody></table></div></sc-if>'
            '<sc-if value="{{bk.none}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; padding: 0 16px 16px">{{bk.emptyText}}</p></sc-if>'
            '<sc-if value="{{bk.hasHint}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: -4px 0 0; padding: 0 16px; font-size: 12px">{{bk.hint}}</p></sc-if>'
            '<sc-if value="{{bk.hasLink}}" hint-placeholder-val="{{false}}"><a href="{{bk.link}}" class="mm-btn mm-ghost" style="align-self: flex-start; height: 28px; margin: -4px 0 0 8px; padding: 0 8px">{{bk.linkText}}' + svg(ICONS['right'], 14) + '</a></sc-if>'
            '<div aria-hidden="true" style="height: 4px"></div></section></sc-if></div></sc-for></div>')

NODATA = '<sc-if value="{{noData}}" hint-placeholder-val="{{false}}"><div class="mm-emptybox">' + svg(ICONS['calendar'], 24) + '<p style="margin: 0">{{noDataText}}</p></div></sc-if>'

def report(name, sec, title, intro, js, opts, actions_d='', actions_p='', extra_d='', extra_p='', back=None, crumb=None):
    rc, fields = range_ctl(False)
    head = ('<div style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px">'
            '<div style="display: flex; align-items: center; gap: 12px; min-width: 0">%s<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">%s</h1><p class="mm-muted" style="margin: 0">%s</p></div></div>'
            '<div style="display: flex; flex-wrap: wrap; gap: 8px">%s</div></div>') % (
        '<a href="%s.dc.html" class="mm-btn mm-ghost mm-icon" aria-label="Back" style="margin-left: -8px">' % back + svg(ICONS['back']) + '</a>' if back else '', title, intro, actions_d)
    d = '\n'.join([MAIN, head, '' if back else '@@RSECTIONS:%s@@' % sec, '<sc-if value="{{hasRange}}" hint-placeholder-val="{{true}}">' + rc + '</sc-if>', controls(False), NOTES, NODATA, stats(False), CHART, blocks(False)]) + DEND + extra_d + XEND
    rcp, fieldsp = range_ctl(True)
    if back:
        ph_top = '\n'.join([PROOT % 'var(--background)', phone_back(back + 'Phone.dc.html', 'Back', title, actions_p), '<main class="mm-scroll" style="gap: 12px; padding: 16px">', '<p class="mm-muted" style="margin: 0; font-size: 13px">%s</p>' % intro])
    else:
        ph_top = optop(title, actions_p, sec).replace('@@OSECTIONS:%s@@' % sec, '@@RSECTIONS:%s@@' % sec)
    ph = ph_top + '\n'.join(['<sc-if value="{{hasRange}}" hint-placeholder-val="{{true}}">' + rcp + '</sc-if>', controls(True), NOTES, NODATA, stats(True), CHART, blocks(True)])
    ph += '\n</main>\n\n' + ('' if back else '@@TABBAR@@\n')
    ph += pdrawer('rg.open', 'closePop', 'mm-rg-title', 'Custom dates', '', pbody(fieldsp), '<div style="flex: none; display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border)"><button type="button" class="mm-btn mm-primary" style="flex: 1" onClick="{{closePop}}">Show</button></div>', tall=False)
    ph += extra_p + ('\n@@PTOAST0@@\n\n</div>\n</x-dc>\n' if back else PXEND)
    jsall = RSHARED + js
    crumbs = [('Reports', 'Reports.dc.html'), (crumb or title, '')]
    write(name, rdhead_for(sec, crumbs, title), rexpand(d), jsall, props(opts, opts[0]), 'mm mm-root')
    write(name + 'Phone', rphead_for(title), rexpand(ph, True), jsall, props(opts, opts[0], True), 'mm')

if __name__ == '__main__':
    sys.path.insert(0, 'rep')
    import rpages
    which = sys.argv[1:] or list(rpages.ALL)
    for w in which:
        rpages.ALL[w]()
        print('built', w)
