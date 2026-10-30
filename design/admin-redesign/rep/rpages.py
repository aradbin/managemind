from rbuild import *

def page(name, sec, title, intro, jsfile, **kw):
    js = rread(jsfile)
    report(name, sec, title, intro, js, js_starts(js), **kw)

def overview():
    page('Reports', 'overview', 'Reports', 'Returns, refunds, failed deliveries and how orders were paid, for the dates you choose.', 'overview.js',
         actions_d='<a href="CodReconciliation.dc.html" class="mm-btn mm-outline">@@I:wallet@@COD reconciliation</a>', crumb='Overview')

def sales():
    page('SalesReport', 'sales', 'Sales', 'Delivered sales by day, week or month, and by product.', 'sales.js')

def profit():
    page('ProfitReport', 'profit', 'Profit', 'What the store made in the period, beside the same number of days before.', 'profit.js')

def stock():
    page('StockReport', 'stock', 'Stock', 'What the stock is worth, and what isn’t selling.', 'stock.js',
         actions_d='<a href="Inventory.dc.html" class="mm-btn mm-outline">@@I:package@@Open stock</a>')

def suppliers():
    page('SupplierReport', 'suppliers', 'Suppliers', 'What the store owes, by age, and what it bought and paid in the period.', 'suppliers.js',
         actions_d='<a href="Suppliers.dc.html" class="mm-btn mm-outline">@@I:truck@@Open suppliers</a>')

def expenses():
    page('ExpenseReport', 'expenses', 'Expenses', 'What the store spent, by category and month.', 'expenses.js',
         actions_d='<a href="Expenses.dc.html" class="mm-btn mm-outline">@@I:wallet@@Open expenses</a>')

def codout():
    page('CodOutstanding', 'cod', 'COD outstanding', 'Cash on delivery that was delivered but hasn’t reached the store yet.', 'codout.js',
         actions_d='<a href="CodReconciliation.dc.html" class="mm-btn mm-outline">@@I:wallet@@Open COD reconciliation</a>')

def imp_body(phone):
    top = '10px' if phone else '8px'
    g2 = '<div style="display: grid; grid-template-columns: %s; gap: 12px">' % ('minmax(0, 1fr)' if phone else 'repeat(2, minmax(0, 1fr))')
    return '\n'.join([
        '<p class="mm-muted" style="margin: 0">Upload the payout statement the courier sent. Each row is matched to a parcel by its consignment number. Nothing is saved until you record it.</p>',
        '<div class="mm-field"><span class="mm-label" id="mm-l-ic">Courier</span>' + chips('im.couriers', 'ic', 3, 'mm-l-ic') + '</div>',
        '<div class="mm-field"><span class="mm-label">Statement file</span><div class="mm-readonly" style="height: auto; min-height: 48px; padding: 8px 8px 8px 12px">' + svg(ICONS['file'], 18, 'flex: none; color: var(--muted-foreground)') + '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{im.file}}</span><span class="mm-muted" style="font-size: 12px">{{im.fileMeta}}</span></span><button type="button" class="mm-btn mm-ghost" style="height: 28px; padding: 0 8px">Change</button></div></div>',
        '<div class="mm-field"><span class="mm-label" id="mm-l-i1">Consignment column</span>' + chips('im.cons', 'i1', 6, 'mm-l-i1') + '</div>',
        '<div class="mm-field"><span class="mm-label" id="mm-l-i2">' + opt('Collected column') + '</span>' + chips('im.coll', 'i2', 7, 'mm-l-i2') + '</div>',
        '<div class="mm-field"><span class="mm-label" id="mm-l-i3">' + opt('Fee column') + '</span>' + chips('im.fee', 'i3', 7, 'mm-l-i3') + '</div>',
        g2 + '<div class="mm-field"><label class="mm-label" for="mm-im-ref">Courier’s payout reference</label><input id="mm-im-ref" class="mm-input" value="{{im.ref}}" onChange="{{im.onRef}}"></div>'
        '<div class="mm-field"><label class="mm-label" for="mm-im-date">Paid on</label><input id="mm-im-date" class="mm-input" type="date" value="{{im.date}}" onChange="{{im.onDate}}"></div></div>',
        '<sc-if value="{{im.notChecked}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" style="align-self: flex-start" onClick="{{im.check}}">' + svg(ICONS['check']) + 'Check</button></sc-if>',
        '<sc-if value="{{im.checked}}" hint-placeholder-val="{{false}}"><div role="status" style="display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px">'
        '<p style="margin: 0; font-weight: 600; display: flex; align-items: center; gap: 8px; color: var(--success)">' + svg(ICONS['ok']) + '{{im.matched}}</p>'
        '<p class="mm-warn" style="margin: 0; font-size: 13px">{{im.unknown}}</p><p class="mm-muted" style="margin: 0; font-size: 13px">{{im.already}}</p></div></sc-if>'])

def man_body(phone):
    top = '10px' if phone else '8px'
    return '\n'.join([
        '<div class="mm-field" style="gap: 0"><p id="mm-l-mc" class="mm-label" style="margin: 0 0 8px">Courier</p>' + radio_list('mp.couriers', 'mm-l-mc', var='mc', count=3) + '</div>',
        '<div class="mm-field"><label class="mm-label" for="mm-mp-a">Amount paid out</label><label class="mm-affix"><span aria-hidden="true" style="top: %s">৳</span><input id="mm-mp-a" class="mm-input" inputMode="decimal" aria-invalid="{{mp.aria}}" value="{{mp.amount}}" onChange="{{mp.onAmount}}"></label><sc-if value="{{mp.bad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter the amount the courier paid.</p></sc-if></div>' % top,
        '<div class="mm-field"><label class="mm-label" for="mm-mp-r">' + opt('Courier’s payout reference') + '</label><input id="mm-mp-r" class="mm-input" value="{{mp.ref}}" onChange="{{mp.onRef}}" placeholder="Bank or bKash transaction"></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-mp-d">Paid on</label><input id="mm-mp-d" class="mm-input" type="date" value="{{mp.date}}" onChange="{{mp.onDate}}"></div>',
        '<p class="mm-muted" style="margin: 0; font-size: 13px">It pays off that courier’s oldest parcels first.</p>'])

def codrec():
    ib = dfoot_buttons('closeImport', 'im.save', 'Record payout')
    mb = dfoot_buttons('closeManual', 'mp.save', 'Record payout')
    extra_d = '\n' + dpanel('im.open', 'closeImport', 'mm-im-title', 'Import a statement', '', imp_body(False), '', ib[0], ib[1]) + '\n' + dpanel('mp.open', 'closeManual', 'mm-mp-title', 'Record a payout', 'A payout the courier made outside its statement.', man_body(False), '', mb[0], mb[1])
    extra_p = '\n' + pdrawer('im.open', 'closeImport', 'mm-im-title', 'Import a statement', '', pbody(imp_body(True)), pfoot('closeImport', 'im.save', 'Record payout')) + '\n' + pdrawer('mp.open', 'closeManual', 'mm-mp-title', 'Record a payout', '', pbody(man_body(True)), pfoot('closeManual', 'mp.save', 'Record payout'))
    acts_p = ('<button type="button" class="mm-btn mm-ghost mm-icon" aria-label="Import a statement" aria-haspopup="dialog" onClick="{{openImport}}">' + svg(ICONS['upload'], 18) + '</button>'
              '<button type="button" class="mm-btn mm-ghost mm-icon" aria-label="Record a payout" aria-haspopup="dialog" onClick="{{openManual}}">' + svg(ICONS['plus'], 18) + '</button>')
    page('CodReconciliation', 'cod', 'COD reconciliation', 'What each courier collected, charged and paid out, and the parcels still unpaid.', 'codrec.js',
         actions_d='<button type="button" class="mm-btn mm-outline" aria-haspopup="dialog" onClick="{{openImport}}">@@I:upload@@Import a statement</button><button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{openManual}}">@@I:plus@@Record payout</button>',
         actions_p=acts_p, extra_d=extra_d, extra_p=extra_p, back='CodOutstanding', crumb='COD reconciliation')

ALL = {'overview': overview, 'sales': sales, 'profit': profit, 'stock': stock, 'suppliers': suppliers, 'expenses': expenses, 'codout': codout, 'codrec': codrec}

# ======================================================================
# Home
# ======================================================================
HOME_LI = re.search(r'<li><a href="(?:#|Home.dc.html)" class="mm-nav">(<svg(?:(?!</svg>).)*</svg>)Home</a></li>', B.dhead)
HTABBAR = (RTABBAR.replace('<a href="#" class="mm-tabitem" aria-current="page">', '<a href="#" class="mm-tabitem">')
           .replace('<a href="#" class="mm-tabitem"><span class="mm-pill"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21',
                    '<a href="HomePhone.dc.html" class="mm-tabitem" aria-current="page"><span class="mm-pill"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21'))
assert HTABBAR.count('aria-current') == 1 and 'HomePhone' in HTABBAR
HCSS = '''
.mm-hgrid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px;align-items:start}
.mm-figs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.mm-fig{display:flex;flex-direction:column;gap:4px;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--card)}
.mm-fig dt{font-size:13px;font-weight:500;color:var(--muted-foreground)}
.mm-fig dd{margin:0;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.01em;font-variant-numeric:tabular-nums}
.mm-fig small{font-size:12px;font-weight:500;line-height:16px}
.mm-ring{position:relative;flex:none;width:44px;height:44px;border-radius:9999px}
.mm-ring>span{position:absolute;inset:5px;display:flex;align-items:center;justify-content:center;border-radius:9999px;background:var(--card);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.mm-wrow{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 12px 0 16px;color:var(--foreground);text-decoration:none;border-top:1px solid var(--border)}
.mm-wrow:hover{background:color-mix(in oklch,var(--muted) 50%,transparent)}
.mm-wico{display:inline-flex;flex:none;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px}
.mm-chk{display:inline-flex;flex:none;align-items:center;justify-content:center;width:18px;height:18px;border-radius:9999px;border:1px solid var(--border)}
.mm-chk[data-done=true]{border-color:var(--success);background:var(--success);color:#fff}
'''
HPCSS = '''
.mm-hgrid{grid-template-columns:minmax(0,1fr);gap:12px}
.mm-figs{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.mm-fig{padding:12px 14px}
.mm-fig dd{font-size:18px;line-height:24px}
'''

def home_body(phone):
    P = 'Phone' if phone else ''
    icons = ''.join('<sc-if value="{{w.is_%s}}" hint-placeholder-val="{{false}}">%s</sc-if>' % (k, svg(ICONS[k], 16)) for k in ['phone', 'clock', 'truck', 'cart', 'copy', 'undo', 'package', 'ban'])
    setup = ('<sc-if value="{{showSetup}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-labelledby="mm-c-su" style="gap: 14px">'
             '<div style="display: flex; align-items: center; gap: 14px"><span class="mm-ring" style="background: {{setup.ring}}" aria-hidden="true"><span>{{setup.pct}}</span></span>'
             '<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px"><h2 id="mm-c-su" class="mm-ctitle">Finish setting up your store</h2><p class="mm-muted" style="margin: 0; font-size: 13px">{{setup.intro}}</p></div></div>'
             '<div style="display: flex; flex-wrap: wrap; gap: 8px"><a href="{{setup.nextHref}}" class="mm-btn mm-primary"%s>{{setup.next}}' % (' style="flex: 1"' if phone else '') + svg(ICONS['right']) + '</a>'
             '<button type="button" class="mm-btn mm-ghost" aria-expanded="{{setup.aria}}" onClick="{{setup.toggle}}">All steps' + svg(ICONS['down']) + '</button></div>'
             '<sc-if value="{{setup.open}}" hint-placeholder-val="{{false}}"><ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column"><sc-for list="{{setup.items}}" as="si" hint-placeholder-count="10"><li style="display: flex; align-items: center; gap: 10px; min-height: 36px">'
             '<span class="mm-chk" data-done="{{si.done}}" aria-hidden="true"><sc-if value="{{si.done}}" hint-placeholder-val="{{true}}">' + svg(ICONS['check'], 12).replace('stroke-width="2"', 'stroke-width="3"') + '</sc-if></span><span class="mm-sr">{{si.state}}: </span>'
             '<sc-if value="{{si.todo}}" hint-placeholder-val="{{false}}"><a href="{{si.href}}" style="color: var(--foreground); text-decoration: underline; text-underline-offset: 3px">{{si.label}}</a></sc-if><sc-if value="{{si.done}}" hint-placeholder-val="{{true}}"><span class="mm-muted">{{si.label}}</span></sc-if>'
             '<sc-if value="{{si.optional}}" hint-placeholder-val="{{false}}"><span class="mm-muted" style="font-size: 12px">(optional)</span></sc-if></li></sc-for></ul>'
             '<button type="button" class="mm-btn mm-outline" style="align-self: flex-start; height: 32px" onClick="{{setup.keepIt}}">{{setup.keep}}</button></sc-if></section></sc-if>')
    usage = ('<sc-if value="{{showUsage}}" hint-placeholder-val="{{true}}"><div class="mm-banner" role="note">' + svg(ICONS['alert']) + '<div style="flex: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px"><p style="margin: 0; flex: 1; min-width: 200px"><span style="font-weight: 600">Plan limits.</span> {{usage}}</p>'
             '<a href="#" style="font-weight: 500; color: var(--foreground); text-decoration: underline; text-underline-offset: 3px">See plan and billing</a></div></div></sc-if>')
    figs = ('<dl class="mm-figs" aria-label="Sales" style="margin: 0"><sc-for list="{{figures}}" as="fg" hint-placeholder-count="4"><div class="mm-fig"><dt>{{fg.label}}</dt><dd>{{fg.value}}</dd><sc-if value="{{fg.hasNote}}" hint-placeholder-val="{{true}}"><small style="color: {{fg.noteColor}}">{{fg.note}}</small></sc-if></div></sc-for></dl>')
    chart = ('<section class="mm-card" aria-labelledby="mm-c-wk" style="gap: 14px"><div class="mm-chead"><div style="display: flex; flex-direction: column; gap: 2px"><h2 id="mm-c-wk" class="mm-ctitle">Sales, last 7 days</h2><span class="mm-muted" style="font-size: 12px">{{week.total}}</span></div>'
             '<sc-if value="{{week.has}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost" style="height: 28px; margin-right: -8px; padding: 0 8px" onClick="{{week.toggle}}">{{week.toggleText}}</button></sc-if></div>'
             '<sc-if value="{{week.has}}" hint-placeholder-val="{{true}}"><sc-if value="{{week.asChart}}" hint-placeholder-val="{{true}}"><div class="mm-chart" role="group" aria-label="Sales, last 7 days"><div class="mm-plot" style="height: %s"><sc-for list="{{week.ticks}}" as="tk" hint-placeholder-count="3"><div class="mm-tick" style="bottom: {{tk.pos}}"><span>{{tk.label}}</span></div></sc-for>' % ('150px' if phone else '180px')
             + '<div class="mm-bars" style="gap: %s"><sc-for list="{{week.bars}}" as="br" hint-placeholder-count="7"><div class="mm-bcol" tabIndex="0" role="img" aria-label="{{br.tip}}"><i style="height: {{br.h}}; max-width: %s"></i><b>{{br.tip}}</b></div></sc-for></div></div>' % ('8px' if phone else '16px', '24px')
             + '<div class="mm-xlab" aria-hidden="true" style="gap: %s"><sc-for list="{{week.bars}}" as="bx" hint-placeholder-count="7"><span>{{bx.xl}}</span></sc-for></div></div></sc-if>' % ('8px' if phone else '16px')
             + '<sc-if value="{{week.asTable}}" hint-placeholder-val="{{false}}"><div class="mm-rwrap" style="margin: 0 -20px"><table class="mm-rtab"><caption class="mm-sr">Sales, last 7 days</caption><thead><tr><th scope="col" style="text-align: left">Day</th><th scope="col" style="text-align: right">Orders</th><th scope="col" style="text-align: right">Sales</th></tr></thead>'
             '<tbody><sc-for list="{{week.rows}}" as="wr" hint-placeholder-count="7"><tr style="border-top: 1px solid var(--border)"><td style="padding-left: 20px">{{wr.day}}</td><td style="text-align: right">{{wr.orders}}</td><td style="text-align: right; font-weight: 500; padding-right: 20px">{{wr.sales}}</td></tr></sc-for></tbody></table></div></sc-if></sc-if>'
             '<sc-if value="{{week.none}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">No sales yet.</p></sc-if></section>')
    recent = ('<section class="mm-card" aria-labelledby="mm-c-rc" style="gap: 8px; padding: 20px 0 8px"><div class="mm-chead" style="padding: 0 20px"><h2 id="mm-c-rc" class="mm-ctitle">Recent orders</h2><sc-if value="{{hasRecent}}" hint-placeholder-val="{{true}}"><a href="Orders%s.dc.html" class="mm-btn mm-ghost" style="height: 28px; margin-right: -8px; padding: 0 8px">View all' % P + svg(ICONS['right'], 14) + '</a></sc-if></div>'
              '<sc-if value="{{hasRecent}}" hint-placeholder-val="{{true}}"><ul style="list-style: none; margin: 0; padding: 0"><sc-for list="{{recent}}" as="ro" hint-placeholder-count="6"><li><a href="{{ro.href}}" class="mm-wrow" aria-label="{{ro.aria}}" style="min-height: 56px; padding-right: 20px; padding-left: 20px">'
              '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span style="display: flex; align-items: center; gap: 8px"><span class="mm-mono" style="font-weight: 600">{{ro.n}}</span><span class="mm-trunc" style="font-weight: 500">{{ro.name}}</span></span><span class="mm-trunc mm-muted" style="font-size: 12px">{{ro.sub}} · {{ro.when}}</span></span>'
              + sbadge('ro.chip') + '<span style="width: 72px; text-align: right; font-weight: 500; font-variant-numeric: tabular-nums">{{ro.total}}</span></a></li></sc-for></ul></sc-if>'
              '<sc-if value="{{noRecent}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; padding: 0 20px 12px">No orders yet. Share your store link, or add an order from Facebook or a phone call.</p></sc-if></section>')
    waiting = ('<section class="mm-card" aria-labelledby="mm-c-wt" style="gap: 8px; padding: 20px 0 0"><h2 id="mm-c-wt" class="mm-ctitle" style="padding: 0 20px">Waiting for you</h2>'
               '<sc-if value="{{hasWaiting}}" hint-placeholder-val="{{true}}"><ul style="list-style: none; margin: 0; padding: 0"><sc-for list="{{waiting}}" as="w" hint-placeholder-count="8"><li><a href="{{w.href}}" class="mm-wrow" aria-label="{{w.aria}}" style="padding-left: 20px"><span class="mm-wico" style="background: {{w.bg}}; color: {{w.fg}}">' + icons + '</span>'
               '<span style="flex: 1; min-width: 0" class="mm-trunc">{{w.label}}</span><span style="font-weight: 600; font-variant-numeric: tabular-nums">{{w.count}}</span>' + svg(ICONS['right'], 16, 'flex: none; color: var(--muted-foreground)') + '</a></li></sc-for></ul>'
               '<div style="display: flex; flex-direction: column; gap: 4px; padding: 12px 20px 16px; border-top: 1px solid var(--border)"><sc-for list="{{waitNotes}}" as="wn" hint-placeholder-count="2"><p class="mm-muted" style="margin: 0; font-size: 12px">{{wn.text}}</p></sc-for></div></sc-if>'
               '<sc-if value="{{allClear}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; padding: 0 20px 20px">Nothing is waiting for you.</p></sc-if></section>')
    profit = ('<sc-if value="{{showProfit}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-labelledby="mm-c-pf" style="gap: 12px"><div class="mm-chead"><h2 id="mm-c-pf" class="mm-ctitle">Profit this month</h2><a href="ProfitReport%s.dc.html" class="mm-btn mm-ghost" style="height: 28px; margin-right: -8px; padding: 0 8px">Open the profit report' % P + svg(ICONS['right'], 14) + '</a></div>'
              '<dl style="margin: 0; display: flex; flex-direction: column; gap: 8px"><sc-for list="{{profit}}" as="pp" hint-placeholder-count="3"><div class="mm-kv" style="flex-wrap: wrap"><dt>{{pp.label}}</dt><dd style="margin: 0; font-weight: 600">{{pp.value}}</dd><sc-if value="{{pp.hasNote}}" hint-placeholder-val="{{false}}"><span class="mm-warn" style="width: 100%; font-size: 12px; color: var(--warn)">{{pp.note}}</span></sc-if></div></sc-for></dl></section></sc-if>')
    return setup, usage, figs, chart, recent, waiting, profit

def home():
    setup, usage, figs, chart, recent, waiting, profit = home_body(False)
    head = ('<div style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px"><div style="display: flex; flex-direction: column; gap: 2px"><p class="mm-muted" style="margin: 0; font-size: 13px">{{dateLine}}</p>'
            '<h1 style="margin: 0; font-size: 24px; line-height: 32px; font-weight: 600; letter-spacing: -0.02em">{{greeting}}</h1></div><div style="display: flex; gap: 8px"><a href="Reports.dc.html" class="mm-btn mm-outline">@@I:chart@@Reports</a><a href="NewOrder.dc.html" class="mm-btn mm-primary">@@I:plus@@New order</a></div></div>')
    d = '\n'.join([MAIN, head, setup, usage, figs, '<div class="mm-hgrid"><div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">', chart, recent, '</div><div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">', waiting, profit, '</div></div>']) + DEND + XEND
    setup, usage, figs, chart, recent, waiting, profit = home_body(True)
    ph = '\n'.join([PROOT % 'var(--background)', '@@PHEADER@@', '<main class="mm-scroll" style="gap: 12px; padding: 16px">',
        '<div style="display: flex; flex-direction: column; gap: 2px"><p class="mm-muted" style="margin: 0; font-size: 13px">{{dateLine}}</p><h1 style="margin: 0; font-size: 22px; line-height: 28px; font-weight: 600; letter-spacing: -0.02em">{{greeting}}</h1></div>',
        setup, usage, figs, waiting, chart, profit, recent, '</main>', '@@TABBAR@@']) + PXEND
    js = rread('home.js'); opts = js_starts(js)
    h = dhead_for(None, [('Home', '')], 'Home')
    h = h.replace(B.inv_group(None), B.m.group(0).replace('href="#"', 'href="Inventory.dc.html"'), 1)
    h = h.replace(HOME_LI.group(0), '<li><a href="Home.dc.html" class="mm-nav" aria-current="page">' + HOME_LI.group(1) + 'Home</a></li>', 1)
    k = h.rindex('</style>'); h = h[:k] + OCSS + RCSS + HCSS + h[k:]
    ph_head = rphead_for('Home'); k = ph_head.rindex('</style>'); ph_head = ph_head[:k] + HCSS + HPCSS + ph_head[k:]
    jsall = RSHARED + js
    write('Home', h, rexpand(d), jsall, props(opts, opts[0]), 'mm mm-root')
    write('HomePhone', ph_head, expand(re.sub(r'@@RSECTIONS:(\w+)@@', '', ph).replace('@@TABBAR@@', HTABBAR), True), jsall, props(opts, opts[0], True), 'mm')

ALL['home'] = home
