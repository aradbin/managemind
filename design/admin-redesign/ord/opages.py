from obuild import *

OUL = '<ul aria-label="%s" style="list-style: none; margin: 0; padding: 0">'

def ddialog(cond, title_id, title, body, cancel, confirm, label, danger=False, width=480, cancel_label='Cancel'):
    color = 'background: var(--destructive); color: #fff' if danger else ''
    cls = 'mm-btn' if danger else 'mm-btn mm-primary'
    return '\n'.join([
        '<sc-if value="{{%s}}" hint-placeholder-val="{{false}}">' % cond,
        '<div style="position: fixed; inset: 0; z-index: 80">',
        '<button type="button" tabindex="-1" class="mm-scrim" aria-label="Close" onClick="{{%s}}" style="position: absolute; background: rgb(0 0 0 / .5)"></button>' % cancel,
        '<div role="dialog" aria-modal="true" aria-labelledby="%s" onKeyDown="{{escClose}}" class="mm-dialog" style="max-width: %dpx; gap: 16px">' % (title_id, width),
        '<h2 id="%s" style="margin: 0; font-size: 18px; line-height: 1.3; font-weight: 600">%s</h2>' % (title_id, title),
        body,
        '<div style="display: flex; flex-wrap: wrap-reverse; justify-content: flex-end; gap: 8px">',
        '<button type="button" class="mm-btn mm-outline" style="height: 36px; padding: 0 16px" onClick="{{%s}}">%s</button>' % (cancel, cancel_label),
        '<button type="button" class="%s" style="height: 36px; padding: 0 16px; %s" onClick="{{%s}}">%s</button>' % (cls, color, confirm, label),
        '</div>', '</div>', '</div>', '</sc-if>'])

def pbody(inner):
    return '<div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 8px 16px 16px">\n' + inner + '\n</div>'

def pfoot_danger(cancel, save, label, cancel_label='Keep it'):
    return ('<div style="flex: none; display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border)">'
            '<button type="button" class="mm-btn mm-outline" style="flex: 1" onClick="{{%s}}">%s</button>'
            '<button type="button" class="mm-btn" style="flex: 2; background: var(--destructive); color: #fff" onClick="{{%s}}">%s</button></div>') % (cancel, cancel_label, save, label)

def cancel_body(p='cx'):
    return '\n'.join([
        '<div class="mm-field" style="gap: 0"><p id="mm-cx-why" class="mm-label" style="margin: 0 0 8px">Why</p>' + radio_list('%s.codes' % p, 'mm-cx-why', sub=False, var='cc') +
        '<sc-if value="{{%s.bad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err" style="margin-top: 6px">Pick a reason.</p></sc-if></div>' % p,
        '<div class="mm-field"><label class="mm-label" for="mm-cx-note">' + opt('Note') + '</label><textarea id="mm-cx-note" class="mm-textarea" maxLength="500" value="{{%s.reason}}" onChange="{{%s.onReason}}" placeholder="What the customer said"></textarea></div>' % (p, p),
        '<div class="mm-note" style="font-size: 13px">' + svg(ICONS['package']) + '<p style="margin: 0">{{%s.stockNote}}<sc-if value="{{%s.hasPaid}}" hint-placeholder-val="{{false}}"> {{%s.paidNote}}</sc-if></p></div>' % (p, p, p)])

def cancel_desk(p='cx', close='closeAll'):
    return ddialog('%s.open' % p, 'mm-cx-title', '{{%s.title}}' % p, cancel_body(p), close, '%s.confirm' % p, 'Cancel order', danger=True, cancel_label='Keep it')

def cancel_phone(p='cx', close='closeAll'):
    return pdrawer('%s.open' % p, close, 'mm-cx-title', '{{%s.title}}' % p, '', pbody(cancel_body(p)), pfoot_danger(close, '%s.confirm' % p, 'Cancel order'), z=60)

def badge_flags(r):
    return ('<sc-if value="{{%s.risky}}" hint-placeholder-val="{{false}}">' % r + sbadge('%s.risk' % r) + '</sc-if>'
            '<sc-for list="{{%s.flags}}" as="fl" hint-placeholder-count="1"><span class="mm-flag mm-warn">' % r + svg(ICONS['flag'], 12) + '{{fl.label}}</span></sc-for>')

# ======================================================================
# Orders
# ======================================================================
def orders():
    acts = ('<button type="button" class="mm-btn mm-outline" onClick="{{exportOrders}}">@@I:download@@Export</button>\n'
            '<a href="NewOrder.dc.html" class="mm-btn mm-primary">@@I:plus@@New order</a>')
    menu = dmenu('r.menuOpen', 'r.toggleMenu', 'r.menuAria', [('link', 'Open', 'Order.dc.html', 'file'), ('Confirm', 'r.confirm', 'check', 'r.canConfirm'), ('Book with a courier', 'r.book', 'truck', 'r.canShip'), ('Print invoice', 'r.invoice', 'printer'), 'sep', ('Cancel order', 'r.ask', 'ban', 'r.canCancel')], width=200)
    menu = menu.replace('class="mm-cmd-item" onClick="{{r.ask}}">', 'class="mm-cmd-item mm-danger" onClick="{{r.ask}}">')
    datebar = '\n'.join([
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">',
        search('Search by number, phone or name', width=300),
        dfilter('pf', 'Payment', list_pop('pf', 'Payment', 'Nothing found.'), 230),
        dfilter('sf', 'Source', list_pop('sf', 'Source', 'Nothing found.'), 220),
        dfilter('zf', 'Zone', list_pop('zf', 'Zone', 'Nothing found.'), 230),
        dfilter('ff', 'Flag', list_pop('ff', 'Flag', 'Nothing found.'), 230),
        RESET,
        '<span class="mm-muted" style="margin-left: auto; font-size: 13px; font-variant-numeric: tabular-nums">{{totalText}}</span>',
        '</div>'])
    d = otop('Orders', acts, 'orders') + '\n'.join([
        ttabs(count=6),
        datebar,
        '<div style="border: 1px solid var(--border); border-radius: 10px">',
        '<div class="mm-ogrid mm-thead"><span>' + checkbox('all', extra='') .replace('aria-checked="{{all.aria}}"', 'aria-checked="{{all.aria}}" aria-label="Select all"').replace('<sc-if value="{{all.on}}" hint-placeholder-val="{{false}}">' + CHECK + '</sc-if>', '<sc-if value="{{all.on}}" hint-placeholder-val="{{false}}">' + CHECK + '</sc-if><sc-if value="{{all.some}}" hint-placeholder-val="{{false}}">' + svg(ICONS['minus'], 14, 'color: var(--primary-foreground)').replace('stroke-width="2"', 'stroke-width="3"') + '</sc-if>') + '</span>'
        '<sc-if value="{{bar.hide}}" hint-placeholder-val="{{true}}"><span aria-hidden="true">Order</span><span aria-hidden="true">Customer</span><span aria-hidden="true">Placed</span><span aria-hidden="true">Status</span><span aria-hidden="true">Payment</span><span aria-hidden="true">Delivery</span><span class="mm-num" aria-hidden="true">Total</span><span></span></sc-if>',
        # Selecting rows swaps the headings for what can be done to them, right above the rows.
        '<sc-if value="{{bar.show}}" hint-placeholder-val="{{false}}"><div role="region" aria-label="Selected orders" class="mm-bulk">',
        '<span role="status" style="font-weight: 500; white-space: nowrap; color: var(--foreground)">{{bar.label}}</span><span aria-hidden="true" class="mm-bulk-sep"></span>',
        '<sc-if value="{{bar.canConfirm}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost" onClick="{{bar.confirm}}">' + svg(ICONS['check']) + '{{bar.confirmText}}</button></sc-if>',
        '<sc-if value="{{bar.canShip}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost" onClick="{{bar.book}}">' + svg(ICONS['truck']) + 'Book with a courier</button></sc-if>',
        '<button type="button" class="mm-btn mm-ghost" onClick="{{bar.invoices}}">' + svg(ICONS['printer']) + 'Invoices</button>',
        '<button type="button" class="mm-btn mm-ghost" onClick="{{bar.slips}}">' + svg(ICONS['file']) + 'Packing slips</button>',
        '<button type="button" class="mm-btn mm-ghost" style="margin-left: auto" onClick="{{bar.clear}}">Clear</button>',
        '</div></sc-if></div>',
        OUL % 'Orders',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="10"><li><div class="mm-ogrid mm-row" style="min-height: 56px">',
        '<span>' + checkbox('r.sel', 'r.selAria', '; position: relative; z-index: 2') + '</span>',
        '<a href="Order.dc.html" class="mm-rowlink mm-mono" aria-label="{{r.aria}}">{{r.n}}</a>',
        '<span style="display: flex; flex-direction: column; min-width: 0"><span style="display: flex; align-items: center; gap: 8px; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{r.name}}</span>' + badge_flags('r') + '</span><span class="mm-trunc mm-muted" style="font-size: 13px; font-variant-numeric: tabular-nums">{{r.sub}}</span></span>',
        '<span style="display: flex; flex-direction: column; font-variant-numeric: tabular-nums"><span>{{r.date}}</span><span class="mm-muted" style="font-size: 12px">{{r.time}}</span></span>',
        '<span>' + sbadge('r.status') + '</span>',
        '<span>' + sbadge('r.pay') + '</span>',
        '<span>' + sbadge('r.del') + '</span>',
        '<span class="mm-num" style="font-weight: 500">{{r.total}}</span>',
        menu,
        '</div></li></sc-for>',
        '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Reset filters') + '</sc-if>',
        '</div>']) + DEND
    book_body = '\n'.join([
        '<div class="mm-field" style="gap: 0"><p id="mm-bk-c" class="mm-label" style="margin: 0 0 8px">Courier</p>' + radio_list('bk.couriers', 'mm-bk-c', var='cr', count=3) + '</div>',
        '<div class="mm-field" style="gap: 0"><p class="mm-label" style="margin: 0 0 4px">Orders</p><ul class="mm-mlist"><sc-for list="{{bk.lines}}" as="bl" hint-placeholder-count="2"><li style="flex-direction: row; align-items: center; gap: 10px"><span class="mm-mono" style="font-weight: 600">{{bl.n}}</span><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc">{{bl.name}}</span><span class="mm-trunc mm-muted" style="font-size: 12px">{{bl.area}}</span></span><span style="font-size: 13px; font-variant-numeric: tabular-nums">{{bl.cod}}</span></li></sc-for></ul></div>',
        '<div class="mm-note" style="font-size: 13px">' + svg(ICONS['info']) + '<p style="margin: 0">Each order gets a consignment number and a label to print. Open an order to change its weight or note for the courier.</p></div>'])
    btns = dfoot_buttons('closeBook', 'bk.save', '{{bk.saveText}}')
    d += dpanel('bk.open', 'closeBook', 'mm-bk-title', 'Book with a courier', '{{bk.sub}}', book_body, '', btns[0], btns[1])
    d += '\n' + cancel_desk() + XEND

    chipgroup = lambda p, title, var: ('<div style="display: flex; flex-direction: column; gap: 8px"><p class="mm-label" style="margin: 0">%s</p>' % title
        + '<div style="display: flex; flex-wrap: wrap; gap: 6px"><sc-for list="{{%s.items}}" as="%s" hint-placeholder-count="4"><button type="button" class="mm-chipq" aria-pressed="{{%s.on}}" onClick="{{%s.pick}}">{{%s.label}}</button></sc-for></div></div>' % (p, var, var, var, var))
    filt = pbody('\n'.join([chipgroup('pf', 'Payment', 'c1'), chipgroup('sf', 'Source', 'c2'), chipgroup('zf', 'Zone', 'c3'), chipgroup('ff', 'Flag', 'c4')]))
    ph = optop('Orders', '<a href="NewOrderPhone.dc.html" class="mm-btn mm-primary">@@I:plus@@New</a>', 'orders') + '\n'.join([
        ttabs(phone=True),
        '<div style="display: flex; gap: 8px">' + search('Number, phone or name', phone=True) +
        '<button type="button" class="mm-btn mm-outline" aria-haspopup="dialog" onClick="{{openFilters}}" style="height: 40px">' + svg(ICONS['adjust']) + 'Filters<sc-if value="{{hasCount}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec" style="margin-left: 2px">{{filterCount}}</span></sc-if></button></div>',
        '<ul class="mm-plist" aria-label="Orders">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="8"><li><div class="mm-prow" style="align-items: flex-start; gap: 10px; padding: 12px 4px 12px 12px">',
        '<a href="OrderPhone.dc.html" class="mm-rowlink" aria-label="{{r.aria}}" style="gap: 3px; display: flex; flex-direction: column"><span style="display: flex; align-items: center; gap: 8px"><span class="mm-mono" style="font-weight: 600">{{r.n}}</span>' + sbadge('r.status') + '</span>'
        '<span class="mm-trunc" style="font-weight: 400">{{r.meta}}</span>'
        '<span style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px"><span class="mm-muted" style="font-size: 12px; line-height: 16px">{{r.placed}}</span>' + badge_flags('r') + '</span></a>',
        '<span style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none"><span style="font-weight: 600; font-variant-numeric: tabular-nums">{{r.total}}</span>' + sbadge('r.pay') + '</span>',
        '<button type="button" class="mm-btn mm-ghost mm-icon mm-above" aria-label="{{r.menuAria}}" aria-haspopup="dialog" onClick="{{r.toggleMenu}}" style="margin-top: -6px">' + svg(ICONS['dots'], 18) + '</button>',
        '</div></li></sc-for>',
        '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Reset filters', pad='32px 16px') + '</sc-if>']) + PEND
    ph += pdrawer('menuOpen', 'closeAll', 'mm-mx-title', 'Order {{mx.n}}', '{{mx.meta}}', '\n'.join([
        '<div role="menu" aria-labelledby="mm-mx-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<a href="OrderPhone.dc.html" role="menuitem" class="mm-optrow">' + svg(ICONS['file'], 18) + 'Open</a>',
        '<sc-if value="{{mx.canConfirm}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.confirm}}">' + svg(ICONS['check'], 18) + 'Confirm</button></sc-if>',
        '<sc-if value="{{mx.canShip}}" hint-placeholder-val="{{false}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.book}}">' + svg(ICONS['truck'], 18) + 'Book with a courier</button></sc-if>',
        '<button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.invoice}}">' + svg(ICONS['printer'], 18) + 'Print invoice</button>',
        '<sc-if value="{{mx.canCancel}}" hint-placeholder-val="{{true}}"><div role="separator" class="mm-sep"></div><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{mx.ask}}">' + svg(ICONS['ban'], 18) + 'Cancel order</button></sc-if>',
        '</div>']), '', tall=False)
    ph += '\n' + pdrawer('filtersOpen', 'closeAll', 'mm-pf-title', 'Filters', '', filt,
        '<div style="flex: none; display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border)"><button type="button" class="mm-btn mm-outline" style="flex: 1" disabled="{{noFilters}}" onClick="{{clearAll}}">Clear</button><button type="button" class="mm-btn mm-primary" style="flex: 2" onClick="{{closeAll}}">{{showText}}</button></div>', tall=False)
    ph += '\n' + pdrawer('bk.open', 'closeBook', 'mm-bk-title', 'Book with a courier', '{{bk.sub}}', pbody(book_body), pfoot('closeBook', 'bk.save', '{{bk.saveText}}'))
    ph += '\n' + cancel_phone() + PXEND
    opts = ['Orders', 'To confirm', 'To ship', 'Selected', 'Payment filter', 'Row menu', 'Cancel order', 'Book with a courier', 'Nothing found']
    owrite('Orders', 'orders', [('Orders', 'Orders.dc.html'), ('All orders', '')], 'Orders', d, ph, oread('orders.js'), opts, 'Orders',
           ['Orders', 'To confirm', 'To ship', 'Filters', 'Row menu', 'Cancel order', 'Book with a courier', 'Nothing found'])


# ======================================================================
# Order
# ======================================================================
def ostep(p, phone):
    sz = 18 if phone else 14
    return ('<div class="mm-step"><button type="button" aria-label="One less" disabled="{{%s.decDis}}" onClick="{{%s.dec}}">' % (p, p) + svg(ICONS['minus'], sz) + '</button>'
            '<input inputMode="numeric" aria-label="{{%s.qtyAria}}" value="{{%s.qty}}" onChange="{{%s.onQty}}">' % (p, p, p)
            + '<button type="button" aria-label="One more" onClick="{{%s.inc}}">' % p + svg(ICONS['plus'], sz) + '</button></div>')

def chead(id_, title, right='', sub=''):
    subh = '<span class="mm-muted" style="font-size: 13px">%s</span>' % sub if sub else ''
    return '<div class="mm-chead"><h2 id="%s" class="mm-ctitle">%s</h2>%s%s</div>' % (id_, title, subh, right)

def ghost_btn(handler, label, icon=None, cond=None, href=None):
    ic = svg(ICONS[icon]) if icon else ''
    if href:
        b = '<a href="%s" class="mm-btn mm-ghost" style="height: 28px; padding: 0 8px">%s%s</a>' % (href, ic, label)
    else:
        b = '<button type="button" class="mm-btn mm-ghost" onClick="{{%s}}" style="height: 28px; padding: 0 8px">%s%s</button>' % (handler, ic, label)
    return '<sc-if value="{{%s}}" hint-placeholder-val="{{true}}">%s</sc-if>' % (cond, b) if cond else b

def totals_block():
    return ('<div style="display: flex; flex-direction: column; gap: 6px"><sc-for list="{{totals}}" as="tt" hint-placeholder-count="5">'
            '<div class="mm-kv" style="border-top: {{tt.bt}}; padding-top: {{tt.pt}}; margin-top: {{tt.mt}}; font-weight: {{tt.weight}}"><span>{{tt.label}}</span><span style="color: {{tt.color}}">{{tt.value}}</span></div></sc-for></div>')

def o_banners():
    return '\n'.join([
        '<sc-if value="{{isDup}}" hint-placeholder-val="{{false}}"><div class="mm-banner" role="status">' + svg(ICONS['copy']) + '<div style="flex: 1; display: flex; flex-direction: column; gap: 10px"><p style="margin: 0">{{dupText}}</p><div style="display: flex; flex-wrap: wrap; gap: 8px">'
        '<button type="button" class="mm-btn mm-outline" style="height: 32px" onClick="{{merge}}">' + svg(ICONS['merge']) + '{{dupMerge}}</button>'
        '<button type="button" class="mm-btn mm-outline" style="height: 32px" onClick="{{cancelDup}}">Cancel as duplicate</button>'
        '<button type="button" class="mm-btn mm-ghost" style="height: 32px" onClick="{{notDup}}">Not a duplicate</button></div></div></div></sc-if>',
        '<sc-if value="{{isRisky}}" hint-placeholder-val="{{false}}"><div class="mm-banner mm-bad" role="status">' + svg(ICONS['alert']) + '<p style="margin: 0">{{riskText}}</p></div></sc-if>',
        '<sc-if value="{{isCancelled}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['ban']) + '<p style="margin: 0">{{cancelText}}</p></div></sc-if>'])

def o_items(phone):
    edit = ghost_btn('openEdit', 'Edit', cond='canEdit').replace('padding: 0 8px', 'margin-right: -8px; padding: 0 8px')
    if phone:
        rows = ('<ul class="mm-mlist"><sc-for list="{{lines}}" as="l" hint-placeholder-count="2"><li style="flex-direction: row; align-items: center; gap: 10px">'
                '<span class="mm-thumb2">' + svg(ICONS['box'], 18) + '</span><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{l.title}}</span><span class="mm-trunc mm-muted" style="font-size: 12px">{{l.qty}}</span></span>'
                '<span style="font-weight: 500; font-variant-numeric: tabular-nums">{{l.total}}</span></li></sc-for></ul>')
        return '<section class="mm-card" aria-labelledby="mm-c-it" style="gap: 8px">' + chead('mm-c-it', 'Items', edit, '') + rows + '<div style="padding-top: 10px; border-top: 1px solid var(--border)">' + totals_block() + '</div></section>'
    rows = ('<ul aria-label="Items" style="list-style: none; margin: 0; padding: 0"><sc-for list="{{lines}}" as="l" hint-placeholder-count="2"><li><div class="mm-oline" style="min-height: 60px; padding: 8px 20px; border-top: 1px solid var(--border)">'
            '<span class="mm-thumb2">' + svg(ICONS['box'], 18) + '</span><span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{l.title}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{l.opts}}</span></span>'
            '<span class="mm-num mm-muted">{{l.qty}}</span><span class="mm-num" style="font-weight: 500">{{l.total}}</span></div></li></sc-for></ul>')
    return ('<section class="mm-card" aria-labelledby="mm-c-it" style="gap: 12px; padding: 20px 0 16px"><div style="padding: 0 20px">' + chead('mm-c-it', 'Items', edit, '{{itemCount}}').replace('<span class="mm-muted" style="font-size: 13px">{{itemCount}}</span>', '<span class="mm-muted" style="flex: 1; font-size: 13px">{{itemCount}}</span>') + '</div>'
            + rows + '<div style="margin-left: auto; width: 340px; max-width: 100%; box-sizing: border-box; padding: 12px 20px 0; border-top: 1px solid var(--border)">' + totals_block() + '</div></section>')

def o_payments(phone):
    right = '<span style="display: flex; gap: 4px; margin-right: -8px">' + ghost_btn('copyLink', 'Payment link', 'link', 'canPay') + ghost_btn('openPay', 'Record a payment', 'plus', 'canPay') + '</span>'
    if phone:
        right = ''
    rows = ('<sc-if value="{{hasPayments}}" hint-placeholder-val="{{true}}"><ul class="mm-mlist"><sc-for list="{{payments}}" as="py" hint-placeholder-count="1"><li style="flex-direction: row; align-items: center; gap: 10px">'
            '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span style="font-weight: 500">{{py.method}}</span><span class="mm-trunc mm-muted" style="font-size: 12px">{{py.ref}} · {{py.when}}</span></span>'
            '<span style="font-weight: 500; font-variant-numeric: tabular-nums">{{py.amount}}</span></li></sc-for></ul></sc-if>'
            '<sc-if value="{{noPayments}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">{{noPayText}}</p></sc-if>')
    foot = ''
    if phone:
        foot = ('<sc-if value="{{canPay}}" hint-placeholder-val="{{true}}"><div style="display: flex; gap: 8px; margin-top: 8px"><button type="button" class="mm-btn mm-outline" style="flex: 1" onClick="{{copyLink}}">' + svg(ICONS['link']) + 'Payment link</button>'
                '<button type="button" class="mm-btn mm-outline" style="flex: 1" onClick="{{openPay}}">' + svg(ICONS['plus']) + 'Record</button></div></sc-if>')
    return '<section class="mm-card" aria-labelledby="mm-c-pay" style="gap: 8px">' + chead('mm-c-pay', 'Payments', right) + rows + foot + '</section>'

def o_shipments(phone):
    act = lambda h, lab, cond, icon=None, primary=False: '<sc-if value="{{sh.%s}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn %s" style="height: 32px%s" onClick="{{sh.%s}}">%s%s</button></sc-if>' % (cond, 'mm-primary' if primary else 'mm-outline', '; flex: 1' if phone else '', h, svg(ICONS[icon]) if icon else '', lab)
    block = ('<sc-for list="{{shipments}}" as="sh" hint-placeholder-count="1"><div style="display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px">'
             '<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">' + svg(ICONS['truck'], 16, 'flex: none; color: var(--muted-foreground)') + '<span style="font-weight: 500">{{sh.courier}}</span><span class="mm-mono mm-muted" style="font-size: 13px">{{sh.cons}}</span><span style="flex: 1"></span>' + sbadge('sh.chip') + '</div>'
             '<p class="mm-muted" style="margin: 0; font-size: 13px">{{sh.items}}</p>'
             '<sc-if value="{{sh.hasFailed}}" hint-placeholder-val="{{false}}"><p class="mm-bad" style="margin: 0; font-size: 13px; font-weight: 500">{{sh.failed}}</p></sc-if>'
             '<sc-if value="{{sh.canBack}}" hint-placeholder-val="{{false}}"><p style="margin: 0; font-size: 13px">{{sh.backText}}</p></sc-if>'
             '<sc-if value="{{sh.isBack}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; font-size: 13px">{{sh.backText}}</p></sc-if>'
             '<ol class="mm-tl" style="font-size: 13px"><sc-for list="{{sh.updates}}" as="su" hint-placeholder-count="3"><li><span class="mm-tldot" aria-hidden="true"></span><span style="flex: 1; display: flex; justify-content: space-between; gap: 8px"><span>{{su.text}}</span><span class="mm-muted" style="font-variant-numeric: tabular-nums">{{su.when}}</span></span></li></sc-for></ol>'
             '<div style="display: flex; flex-wrap: wrap; gap: 8px">' + act('markShipped', 'Mark shipped', 'canShip', 'truck', True) + act('delivered', 'Mark delivered', 'canDeliver', 'check', True) + act('failedAsk', 'Couldn’t deliver', 'canDeliver') + act('backAsk', 'Back in the shop', 'canBack', 'undo', True) + '</div>'
             '</div></sc-for>')
    empty = ('<sc-if value="{{noShipments}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px"><p class="mm-muted" style="flex: 1; margin: 0; min-width: 140px">{{noShipText}}</p>'
             '<sc-if value="{{canBook}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" style="height: 32px" onClick="{{createShipment}}">Create shipment</button><button type="button" class="mm-btn mm-primary" style="height: 32px" onClick="{{openBook}}">' + svg(ICONS['truck']) + '{{bookText}}</button></sc-if></div></sc-if>')
    return '<sc-if value="{{showShip}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-labelledby="mm-c-sh" style="gap: 12px">' + chead('mm-c-sh', 'Shipments') + block + empty + '</section></sc-if>'

def o_returns(phone):
    link = 'ReturnPhone.dc.html' if phone else 'Return.dc.html'
    return ('<sc-if value="{{showReturns}}" hint-placeholder-val="{{false}}"><section class="mm-card" aria-labelledby="mm-c-rt" style="gap: 8px">' + chead('mm-c-rt', 'Returns and refunds', ghost_btn('startReturn', 'Start a return', 'undo', 'canReturn').replace('padding: 0 8px', 'margin-right: -8px; padding: 0 8px'))
            + '<sc-if value="{{hasReturns}}" hint-placeholder-val="{{true}}"><ul class="mm-mlist"><sc-for list="{{returns}}" as="rt" hint-placeholder-count="1"><li style="position: relative; flex-direction: row; align-items: center; gap: 10px"><a href="%s" class="mm-rowlink mm-mono">{{rt.ref}}</a><span style="flex: 1"></span>' % link + sbadge('rt.chip') + '</li></sc-for></ul></sc-if>'
            + '<sc-if value="{{canReturn}}" hint-placeholder-val="{{true}}"><sc-if value="{{noReturnsYet}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">No returns. Start one if the customer sends something back.</p></sc-if></sc-if></section></sc-if>')

def o_timeline():
    return ('<section class="mm-card" aria-labelledby="mm-c-tl" style="gap: 14px">' + chead('mm-c-tl', 'Timeline')
            + '<div style="display: flex; flex-direction: column; gap: 8px"><label class="mm-sr" for="mm-tl-note">Add an internal note</label><textarea id="mm-tl-note" class="mm-textarea" maxLength="1000" placeholder="Add an internal note. Only staff see it." value="{{noteDraft}}" onChange="{{onNote}}" style="min-height: 64px"></textarea>'
            + '<button type="button" class="mm-btn mm-outline" style="align-self: flex-end; height: 32px" disabled="{{noteEmpty}}" onClick="{{addNote}}">Add note</button></div>'
            + '<ol class="mm-tl"><sc-for list="{{timeline}}" as="ev" hint-placeholder-count="5"><li><span class="mm-tldot" aria-hidden="true"></span><span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px">'
            + '<sc-if value="{{ev.isNote}}" hint-placeholder-val="{{false}}"><span class="mm-tlnote">{{ev.text}}</span></sc-if><sc-if value="{{ev.isEvent}}" hint-placeholder-val="{{true}}"><span>{{ev.text}}</span></sc-if>'
            + '<span class="mm-muted" style="font-size: 12px">{{ev.when}}</span></span></li></sc-for></ol></section>')

def o_customer(phone):
    cust_link = 'CustomerPhone.dc.html' if phone else 'Customer.dc.html'
    return ('<section class="mm-card" aria-labelledby="mm-c-cu" style="gap: 14px">' + chead('mm-c-cu', 'Customer')
            + '<div style="display: flex; flex-direction: column; gap: 2px"><a href="%s" style="font-weight: 500; color: var(--foreground); text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 3px">{{cust.name}}</a><span class="mm-muted" style="font-size: 13px; font-variant-numeric: tabular-nums">{{cust.phone}} · {{cust.orders}}</span></div>' % cust_link
            + '<div style="display: flex; gap: 8px"><a href="{{cust.tel}}" class="mm-btn mm-outline" style="flex: 1%s">' % ('' if phone else '; height: 32px') + svg(ICONS['phone']) + 'Call</a><a href="{{cust.wa}}" class="mm-btn mm-outline" style="flex: 1%s">' % ('' if phone else '; height: 32px') + svg(ICONS['msg']) + 'WhatsApp</a></div>'
            + '<div style="display: flex; flex-direction: column; gap: 4px; padding-top: 12px; border-top: 1px solid var(--border)"><span class="mm-label">Delivery address</span><span>{{cust.address}}</span><sc-if value="{{cust.hasZone}}" hint-placeholder-val="{{true}}"><span class="mm-muted" style="font-size: 13px">{{cust.zone}}</span></sc-if></div>'
            + '<sc-if value="{{cust.hasNote}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-direction: column; gap: 4px; padding-top: 12px; border-top: 1px solid var(--border)"><span class="mm-label">Note from the customer</span><span>{{cust.note}}</span></div></sc-if></section>')

def o_side_info():
    return ('<sc-if value="{{showConf}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-labelledby="mm-c-cf" style="gap: 12px">' + chead('mm-c-cf', 'Confirmation and delivery record')
            + '<div style="display: flex; flex-direction: column; gap: 2px"><span>{{confText}}</span><sc-if value="{{hasConfLink}}" hint-placeholder-val="{{false}}"><span class="mm-muted" style="font-size: 13px">{{confLink}}</span></sc-if></div>'
            + '<div style="display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border)">' + sbadge('risk') + '<span class="mm-muted" style="font-size: 13px">{{recordText}}</span></div></section></sc-if>')

def o_tags():
    return ('<section class="mm-card" aria-labelledby="mm-c-tg" style="gap: 10px">' + chead('mm-c-tg', 'Tags')
            + '<div class="mm-tagrow"><sc-for list="{{tags}}" as="tg" hint-placeholder-count="1"><span class="mm-tagx">{{tg.label}}<button type="button" aria-label="{{tg.aria}}" onClick="{{tg.remove}}">' + svg(ICONS['x'], 12) + '</button></span></sc-for></div>'
            + '<input class="mm-input" aria-label="Add a tag" placeholder="Add a tag and press Enter" value="{{tagQ}}" onChange="{{onTag}}" onKeyDown="{{tagKey}}" style="height: 32px"></section>')

def edit_body(phone):
    rows = ('<ul class="mm-mlist" aria-label="Items"><sc-for list="{{ed.lines}}" as="el" hint-placeholder-count="2"><li style="flex-direction: row; align-items: center; gap: 10px">'
            '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{el.title}}</span><span class="mm-trunc mm-muted" style="font-size: 12px">{{el.opts}} · {{el.price}}</span></span>'
            + ostep('el', phone) + '<sc-if value="{{el.canRemove}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{el.removeAria}}" onClick="{{el.remove}}" style="width: 28px; height: 28px; margin-right: -6px">' + svg(ICONS['x']) + '</button></sc-if></li></sc-for></ul>')
    add = ('<div style="position: relative"><button type="button" class="mm-addrow" aria-haspopup="%s" aria-expanded="{{ed.apAria}}" onClick="{{ed.addProduct}}">' % ('dialog' if phone else 'listbox') + svg(ICONS['plus']) + 'Add a product</button>' + ('' if phone else combo_pop('ap', 'No product found.').replace('class="mm-pop"', 'class="mm-pop" style="top: 44px; left: 0; right: 0"', 1)) + '</div>')
    return '\n'.join([rows, add,
        '<div class="mm-field"><label class="mm-label" for="mm-ed-why">Reason for the change</label><input id="mm-ed-why" class="mm-input" maxLength="300" aria-invalid="{{ed.reasonAria}}" value="{{ed.reason}}" onChange="{{ed.onReason}}" placeholder="The customer wants one more"><sc-if value="{{ed.reasonBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Say why it changed. It shows on the timeline.</p></sc-if></div>',
        '<div style="display: flex; align-items: baseline; gap: 6px; padding-top: 12px; border-top: 1px solid var(--border)"><span style="font-weight: 600; font-variant-numeric: tabular-nums">{{ed.totalText}}</span><sc-if value="{{ed.changed}}" hint-placeholder-val="{{true}}"><span class="mm-muted" style="font-variant-numeric: tabular-nums">{{ed.wasText}}</span></sc-if></div>',
        '<sc-if value="{{ed.dropped}}" hint-placeholder-val="{{false}}"><div class="mm-note" style="font-size: 13px">' + svg(ICONS['tag']) + '<p style="margin: 0">{{ed.droppedText}}</p></div></sc-if>',
        '<sc-if value="{{ed.refund}}" hint-placeholder-val="{{false}}"><div class="mm-banner" style="font-size: 13px">' + svg(ICONS['alert']) + '<p style="margin: 0">{{ed.refundText}}</p></div></sc-if>'])

def opay_body(phone):
    top = '10px' if phone else '8px'
    return '\n'.join([
        '<div class="mm-field"><label class="mm-label" for="mm-op-amt">Amount</label><label class="mm-affix"><span aria-hidden="true" style="top: %s">৳</span><input id="mm-op-amt" class="mm-input" inputMode="decimal" aria-invalid="{{pf.amtAria}}" value="{{pf.amount}}" onChange="{{pf.onAmount}}" style="font-variant-numeric: tabular-nums"></label>' % top
        + '<sc-if value="{{pf.amtBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter the amount paid.</p></sc-if><sc-if value="{{pf.over}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-warn">{{pf.overText}}</p></sc-if></div>',
        '<div class="mm-field"><span class="mm-label" id="mm-l-opm">Paid by</span><div role="radiogroup" aria-labelledby="mm-l-opm" class="mm-paygrid"><sc-for list="{{pf.methods}}" as="pm" hint-placeholder-count="6"><button type="button" role="radio" class="mm-paybtn" aria-checked="{{pm.on}}" onClick="{{pm.pick}}">{{pm.label}}</button></sc-for></div></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-op-ref">' + opt('Reference') + '</label><input id="mm-op-ref" class="mm-input" maxLength="100" value="{{pf.ref}}" onChange="{{pf.onRef}}"><p class="mm-hint">The bKash or bank transaction ID.</p></div>'])

def obook_body(phone):
    top = '10px' if phone else '8px'
    return '\n'.join([
        '<div class="mm-field" style="gap: 0"><p id="mm-ob-c" class="mm-label" style="margin: 0 0 8px">Courier</p>' + radio_list('bk.couriers', 'mm-ob-c', var='cr', count=3) + '</div>',
        '<div class="mm-grid2" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px"><div class="mm-field"><span class="mm-label">Address</span><p style="margin: 0; white-space: pre-line; font-size: 13px">{{bk.address}}</p></div><div class="mm-field"><span class="mm-label">Items</span><p style="margin: 0; white-space: pre-line; font-size: 13px">{{bk.items}}</p></div></div>',
        '<div class="mm-field"><span class="mm-label">Courier’s area</span><div class="mm-readonly">' + svg(ICONS['pin'], 16, 'flex: none; color: var(--muted-foreground)') + '<span class="mm-trunc">{{bk.area}}</span></div></div>',
        '<div class="mm-grid2" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px"><div class="mm-field"><label class="mm-label" for="mm-ob-cod">To collect</label><label class="mm-affix"><span aria-hidden="true" style="top: %s">৳</span><input id="mm-ob-cod" class="mm-input" inputMode="decimal" value="{{bk.cod}}" onChange="{{bk.onCod}}" style="font-variant-numeric: tabular-nums"></label></div>' % top
        + '<div class="mm-field"><label class="mm-label" for="mm-ob-w">Weight (grams)</label><input id="mm-ob-w" class="mm-input" inputMode="numeric" value="{{bk.weight}}" onChange="{{bk.onWeight}}" style="font-variant-numeric: tabular-nums"></div></div>',
        '<p class="mm-hint" style="margin-top: -8px">{{bk.codHint}}</p>',
        '<div class="mm-field"><label class="mm-label" for="mm-ob-note">' + opt('Note for the courier') + '</label><input id="mm-ob-note" class="mm-input" maxLength="200" value="{{bk.note}}" onChange="{{bk.onNote}}"></div>'])

def dv_body():
    return ('<sc-if value="{{dv.hasCod}}" hint-placeholder-val="{{true}}"><label style="display: flex; align-items: center; gap: 10px; cursor: pointer">' + checkbox('dv.check') + '<span style="font-weight: 500">{{dv.codText}}</span></label></sc-if>'
            '<p class="mm-muted" style="margin: 0">The order is marked complete. The customer can ask for a return for 7 days.</p>')

def fl_body():
    return '<div class="mm-field" style="gap: 0"><p id="mm-fl-why" class="mm-label" style="margin: 0 0 8px">What happened</p>' + radio_list('fl.reasons', 'mm-fl-why', sub=False, var='fr', count=4) + '</div><p class="mm-muted" style="margin: 0; font-size: 13px">The courier brings the parcel back. Mark it back in the shop when it arrives.</p>'

def bs_body(top):
    return ('<div class="mm-field"><label class="mm-label" for="mm-bs-cost">Return cost</label><label class="mm-affix"><span aria-hidden="true" style="top: %s">৳</span><input id="mm-bs-cost" class="mm-input" inputMode="decimal" value="{{bs.cost}}" onChange="{{bs.onCost}}" style="font-variant-numeric: tabular-nums"></label><p class="mm-hint">What the courier charged to bring it back. It’s recorded as an expense.</p></div>' % top
            + '<div class="mm-note" style="font-size: 13px">' + svg(ICONS['package']) + '<p style="margin: 0">{{bs.stockText}}</p></div>')

def order():
    more = ('<div style="position: relative; display: flex">'
            '<button type="button" class="mm-btn mm-outline mm-icon" aria-label="More actions" aria-haspopup="menu" aria-expanded="{{moreAria}}" onClick="{{toggleMore}}">' + svg(ICONS['dots']) + '</button>'
            '<sc-if value="{{moreOpen}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close menu" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button>'
            '<div role="menu" aria-label="More actions" class="mm-menu" onKeyDown="{{escClose}}" style="top: 40px; right: 0; width: 210px">'
            '<sc-if value="{{canEdit}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-cmd-item" aria-haspopup="dialog" onClick="{{openEdit}}">' + svg(ICONS['pencil']) + 'Edit order</button></sc-if>'
            '<sc-if value="{{canPay}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-cmd-item" onClick="{{openPay}}">' + svg(ICONS['wallet']) + 'Record a payment</button></sc-if>'
            '<sc-if value="{{canProcess}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-cmd-item" onClick="{{process}}">' + svg(ICONS['package']) + 'Start processing</button></sc-if>'
            '<button type="button" role="menuitem" class="mm-cmd-item" onClick="{{printInvoice}}">' + svg(ICONS['printer']) + 'Print invoice</button>'
            '<button type="button" role="menuitem" class="mm-cmd-item" onClick="{{printSlip}}">' + svg(ICONS['file']) + 'Print packing slip</button>'
            '<sc-if value="{{canCancel}}" hint-placeholder-val="{{true}}"><div role="separator" class="mm-sep"></div><button type="button" role="menuitem" class="mm-cmd-item mm-danger" onClick="{{askCancel}}">' + svg(ICONS['ban']) + 'Cancel order</button></sc-if>'
            '</div></sc-if></div>')
    head = '\n'.join([
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">',
        '<a href="Orders.dc.html" class="mm-btn mm-ghost mm-icon" aria-label="Back to orders" style="margin-left: -8px">' + svg(ICONS['back']) + '</a>',
        '<h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">{{od.title}}</h1>',
        '<span style="display: flex; gap: 6px">' + sbadge("od.status") + sbadge("od.pay") + sbadge("od.del") + '</span>',
        '<span style="flex: 1"></span>',
        # One next step in the header; editing and shipping in other ways live in ⋯ and the cards.
        '<sc-if value="{{canBook}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{openBook}}">' + svg(ICONS['truck']) + '{{bookText}}</button></sc-if>',
        '<sc-if value="{{canConfirm}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" onClick="{{confirm}}">' + svg(ICONS['check']) + 'Confirm</button></sc-if>',
        more, '</div>',
        '<p class="mm-muted" style="margin: -8px 0 0">{{od.placed}}</p>'])
    d = '\n'.join([MAIN, head, o_banners(),
        '<div class="mm-cols"><div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">', o_items(False), o_payments(False), o_shipments(False), o_returns(False), o_timeline(), '</div>',
        '<div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">', o_customer(False), o_side_info(), o_tags(), '</div></div>']) + DEND
    eb = dfoot_buttons('closeEdit', 'ed.save', 'Save changes')
    d += dpanel('ed.open', 'closeEdit', 'mm-ed-title', 'Edit order', '{{ed.sub}}', edit_body(False), '', eb[0], eb[1])
    pb = dfoot_buttons('closePay', 'pf.save', 'Record payment')
    d += '\n' + dpanel('pf.open', 'closePay', 'mm-op-title', 'Record a payment', '{{pf.sub}}', opay_body(False), '', pb[0], pb[1])
    bb = dfoot_buttons('closeBook', 'bk.save', '{{bk.saveText}}')
    d += '\n' + dpanel('bk.open', 'closeBook', 'mm-ob-title', 'Book with a courier', '{{bk.sub}}', obook_body(False), '', bb[0], bb[1])
    d += '\n' + cancel_desk()
    d += '\n' + ddialog('dv.open', 'mm-dv-title', 'Mark delivered?', dv_body(), 'closeDlg', 'dv.save', 'Mark delivered', width=440)
    d += '\n' + ddialog('fl.open', 'mm-fl-title', 'Couldn’t deliver', fl_body(), 'closeDlg', 'fl.save', 'Save', width=440)
    d += '\n' + ddialog('bs.open', 'mm-bs-title', 'Back in the shop', bs_body('8px'), 'closeDlg', 'bs.save', 'Put back in stock', width=440)
    d += XEND

    right = '<button type="button" class="mm-btn mm-ghost mm-icon" aria-label="More actions" aria-haspopup="dialog" onClick="{{toggleMore}}">' + svg(ICONS['dots'], 18) + '</button>'
    acts = ('<sc-if value="{{canConfirm}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" style="width: 100%" onClick="{{confirm}}">' + svg(ICONS['check']) + 'Confirm</button></sc-if>'
            '<sc-if value="{{canBook}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" style="width: 100%" onClick="{{openBook}}">' + svg(ICONS['truck']) + '{{bookText}}</button></sc-if>')
    ph = '\n'.join([PROOT % 'var(--page)', phone_back('OrdersPhone.dc.html', 'Back to orders', '{{od.title}}', right),
        '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
        '<section class="mm-card" style="gap: 10px"><div style="display: flex; flex-wrap: wrap; gap: 6px">' + sbadge("od.status") + sbadge("od.pay") + sbadge("od.del") + '</div>'
        '<div style="display: flex; flex-direction: column"><p class="mm-big" style="margin: 0">{{od.total}}</p><p class="mm-muted" style="margin: 0; font-size: 13px">{{od.due}}</p></div><p class="mm-muted" style="margin: 0; font-size: 12px">{{od.placed}}</p>' + acts + '</section>',
        o_banners(), o_customer(True), o_items(True), o_payments(True), o_shipments(True), o_returns(True), o_side_info(), o_timeline(),
        '</main>', ''])
    ph += pdrawer('moreOpen', 'closeAll', 'mm-more-title', '{{od.title}}', '', '\n'.join([
        '<div role="menu" aria-labelledby="mm-more-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<sc-if value="{{canEdit}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{openEdit}}">' + svg(ICONS['pencil'], 18) + 'Edit</button></sc-if>',
        '<sc-if value="{{canPay}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{openPay}}">' + svg(ICONS['wallet'], 18) + 'Record a payment</button></sc-if>',
        '<sc-if value="{{canBook}}" hint-placeholder-val="{{false}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{createShipment}}">' + svg(ICONS['package'], 18) + 'Create shipment</button></sc-if>',
        '<button type="button" role="menuitem" class="mm-optrow" onClick="{{printInvoice}}">' + svg(ICONS['printer'], 18) + 'Print invoice</button>',
        '<sc-if value="{{canCancel}}" hint-placeholder-val="{{true}}"><div role="separator" class="mm-sep"></div><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{askCancel}}">' + svg(ICONS['ban'], 18) + 'Cancel order</button></sc-if>',
        '</div>']), '', tall=False)
    ph += '\n' + pdrawer('ed.open', 'closeEdit', 'mm-ed-title', 'Edit order', '{{ed.sub}}', pbody(edit_body(True)), pfoot('closeEdit', 'ed.save', 'Save changes'))
    ph += '\n' + PCOMBO_DRAWER
    ph += '\n' + pdrawer('pf.open', 'closePay', 'mm-op-title', 'Record a payment', '{{pf.sub}}', pbody(opay_body(True)), pfoot('closePay', 'pf.save', 'Record payment'))
    ph += '\n' + pdrawer('bk.open', 'closeBook', 'mm-ob-title', 'Book with a courier', '{{bk.sub}}', pbody(obook_body(True)), pfoot('closeBook', 'bk.save', '{{bk.saveText}}'))
    ph += '\n' + cancel_phone()
    ph += '\n' + pdrawer('dv.open', 'closeDlg', 'mm-dv-title', 'Mark delivered?', '', pbody(dv_body()), pfoot('closeDlg', 'dv.save', 'Mark delivered'), tall=False)
    ph += '\n' + pdrawer('fl.open', 'closeDlg', 'mm-fl-title', 'Couldn’t deliver', '', pbody(fl_body()), pfoot('closeDlg', 'fl.save', 'Save'), tall=False)
    ph += '\n' + pdrawer('bs.open', 'closeDlg', 'mm-bs-title', 'Back in the shop', '', pbody(bs_body('10px')), pfoot('closeDlg', 'bs.save', 'Put back in stock'), tall=False)
    ph += '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    js = oread('order.js')
    opts = list(js_starts(js))
    owrite('Order', 'orders', [('Orders', 'Orders.dc.html'), ('{{od.title}}', '')], 'Order', d, ph, js, opts, opts[0])


def states():
    """Loading and failed-to-load, drawn once on Orders and one order for every list and record page to follow."""
    sk = lambda w, h=10: '<span class="mm-skel" style="width: %s; height: %dpx"></span>' % (w, h)
    def failed(what, phone=False):
        pad = '40px 20px' if phone else '56px 24px'
        return ('<div role="alert" style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: %s; text-align: center">' % pad
                + '<span aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 9999px; background: var(--muted); color: var(--muted-foreground)">' + svg(ICONS['alert'], 20) + '</span>'
                + '<p style="margin: 4px 0 0; font-weight: 600">%s didn’t load</p>' % what
                + '<p class="mm-muted" style="margin: 0; max-width: 360px">We couldn’t reach managemind. Check your connection, then try again. The rest of the admin still works.</p>'
                + '<button type="button" class="mm-btn mm-outline" style="margin-top: 8px%s" onClick="{{retry}}">' % ('; height: 40px' if phone else '') + svg(ICONS['refresh']) + 'Try again</button></div>')
    missing = lambda phone: ('<div role="alert" style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: %s; text-align: center">' % ('40px 20px' if phone else '56px 24px')
               + '<span aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 9999px; background: var(--muted); color: var(--muted-foreground)">' + svg(ICONS['search'], 20) + '</span>'
               + '<p style="margin: 4px 0 0; font-weight: 600">Order #1099 doesn’t exist</p><p class="mm-muted" style="margin: 0; max-width: 360px">It may have been deleted, or the link is wrong.</p>'
               + '<a href="Orders%s.dc.html" class="mm-btn mm-primary" style="margin-top: 8px">All orders</a></div>' % ('Phone' if phone else ''))
    busy = '<p class="mm-sr" role="status">Loading…</p>'
    # ---- desktop ----
    list_d = '\n'.join([
        '<sc-if value="{{isList}}" hint-placeholder-val="{{true}}">',
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px"><h1 style="flex: 1; margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">Orders</h1>'
        '<button type="button" class="mm-btn mm-outline">' + svg(ICONS['download']) + 'Export</button><a href="NewOrder.dc.html" class="mm-btn mm-primary">' + svg(ICONS['plus']) + 'New order</a></div>',
        '<div role="tablist" aria-label="Status" class="mm-tabs mm-ttabs" style="align-self: flex-start; height: 36px"><sc-for list="{{tabs}}" as="t" hint-placeholder-count="6"><button type="button" role="tab" class="mm-tab" aria-selected="{{t.on}}">{{t.label}}</button></sc-for></div>',
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px"><div style="position: relative; width: 300px; max-width: 100%">' + svg(ICONS['search'], 16, 'position: absolute; left: 10px; top: 10px; color: var(--muted-foreground); pointer-events: none')
        + '<input type="search" class="mm-input" aria-label="Search by number, phone or name" placeholder="Search by number, phone or name" style="width: 100%; padding-left: 34px"></div>'
        + ''.join('<button type="button" class="mm-btn mm-outline mm-dashed">' + svg(ICONS['circleplus']) + l + '</button>' for l in ['Payment', 'Source', 'Zone', 'Flag']) + '</div>',
        '<div style="border: 1px solid var(--border); border-radius: 10px">',
        '<div class="mm-ogrid mm-thead"><span></span><span>Order</span><span>Customer</span><span>Placed</span><span>Status</span><span>Payment</span><span>Delivery</span><span class="mm-num">Total</span><span></span></div>',
        '<sc-if value="{{loading}}" hint-placeholder-val="{{true}}">' + busy + '<ul aria-hidden="true" style="list-style: none; margin: 0; padding: 0"><sc-for list="{{skel}}" as="k" hint-placeholder-count="8"><li class="mm-ogrid mm-row" style="min-height: 56px">'
        + sk('16px', 16) + sk('{{k.b}}') + '<span style="display: flex; flex-direction: column; gap: 6px">' + sk('{{k.a}}') + sk('{{k.b}}', 8) + '</span>' + sk('{{k.c}}') + sk('70%', 18) + sk('62%', 18) + sk('74%', 18)
        + '<span style="display: flex; justify-content: flex-end">' + sk('{{k.c}}') + '</span><span></span></li></sc-for></ul></sc-if>',
        '<sc-if value="{{failed}}" hint-placeholder-val="{{false}}">' + failed('Orders') + '</sc-if>',
        '</div>', '</sc-if>'])
    rec_d = '\n'.join([
        '<sc-if value="{{isRec}}" hint-placeholder-val="{{false}}">',
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px"><a href="Orders.dc.html" class="mm-btn mm-ghost mm-icon" aria-label="Back to orders" style="margin-left: -8px">' + svg(ICONS['back']) + '</a>'
        '<sc-if value="{{known}}" hint-placeholder-val="{{true}}"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">Order #1053</h1></sc-if>'
        '<sc-if value="{{missing}}" hint-placeholder-val="{{false}}"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">Order #1099</h1></sc-if>'
        '<sc-if value="{{loading}}" hint-placeholder-val="{{true}}"><span aria-hidden="true" style="display: flex; gap: 6px">' + sk('76px', 20) + sk('64px', 20) + sk('72px', 20) + '</span></sc-if></div>',
        '<sc-if value="{{loading}}" hint-placeholder-val="{{true}}">' + busy + '<div class="mm-cols" aria-hidden="true"><div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">'
        '<section class="mm-card" style="gap: 14px">' + sk('80px', 14) + '<sc-for list="{{lines}}" as="ln" hint-placeholder-count="3"><div style="display: flex; align-items: center; gap: 12px">' + sk('40px', 40)
        + '<span style="flex: 1; display: flex; flex-direction: column; gap: 6px">' + sk('{{ln.a}}') + sk('{{ln.b}}', 8) + '</span>' + sk('64px') + '</div></sc-for></section>'
        '<section class="mm-card" style="gap: 12px">' + sk('96px', 14) + sk('70%') + sk('45%') + '</section></div>'
        '<div style="display: flex; flex-direction: column; gap: 16px; min-width: 0"><section class="mm-card" style="gap: 12px">' + sk('88px', 14) + sk('60%') + sk('80%') + '<span style="display: flex; gap: 8px">' + sk('50%', 32) + sk('50%', 32) + '</span></section>'
        '<section class="mm-card" style="gap: 12px">' + sk('64px', 14) + sk('40%', 20) + '</section></div></div></sc-if>',
        '<sc-if value="{{failed}}" hint-placeholder-val="{{false}}"><section class="mm-card" style="padding: 0">' + failed('This order') + '</section></sc-if>',
        '<sc-if value="{{missing}}" hint-placeholder-val="{{false}}"><section class="mm-card" style="padding: 0">' + missing(False) + '</section></sc-if>',
        '</sc-if>'])
    d = '\n'.join([MAIN, list_d, rec_d]) + DEND + XEND
    # ---- phone ----
    pcard = ('<li style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--border)"><span style="display: flex; justify-content: space-between; gap: 12px">'
             + sk('{{k.b}}', 12) + sk('56px', 12) + '</span>' + sk('{{k.a}}') + '<span style="display: flex; gap: 6px">' + sk('64px', 18) + sk('56px', 18) + '</span></li>')
    list_p = '\n'.join([
        '<sc-if value="{{isList}}" hint-placeholder-val="{{true}}">', '@@PHEADER@@', '<main class="mm-scroll" style="gap: 12px; padding: 16px">',
        '<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">Orders</h1><a href="NewOrderPhone.dc.html" class="mm-btn mm-primary">' + svg(ICONS['plus']) + 'New</a></div>',
        '<nav aria-label="Status" style="margin: 0 -16px; padding: 0 16px; overflow-x: auto; scrollbar-width: none"><div role="tablist" aria-label="Status" class="mm-tabs mm-ttabs" style="height: 40px"><sc-for list="{{tabs}}" as="t" hint-placeholder-count="6"><button type="button" role="tab" class="mm-tab" aria-selected="{{t.on}}">{{t.label}}</button></sc-for></div></nav>',
        '<div style="border: 1px solid var(--border); border-radius: 12px; background: var(--card); overflow: hidden">',
        '<sc-if value="{{loading}}" hint-placeholder-val="{{true}}">' + busy + '<ul aria-hidden="true" style="list-style: none; margin: 0 0 -1px; padding: 0"><sc-for list="{{cards}}" as="k" hint-placeholder-count="5">' + pcard + '</sc-for></ul></sc-if>',
        '<sc-if value="{{failed}}" hint-placeholder-val="{{false}}">' + failed('Orders', True) + '</sc-if>',
        '</div>', '</main>', '@@TABBAR@@', '</sc-if>'])
    rec_p = '\n'.join([
        '<sc-if value="{{isRec}}" hint-placeholder-val="{{false}}">',
        '<sc-if value="{{known}}" hint-placeholder-val="{{true}}">' + phone_back('OrdersPhone.dc.html', 'Back to orders', 'Order #1053') + '</sc-if>',
        '<sc-if value="{{missing}}" hint-placeholder-val="{{false}}">' + phone_back('OrdersPhone.dc.html', 'Back to orders', 'Order #1099') + '</sc-if>',
        '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
        '<sc-if value="{{loading}}" hint-placeholder-val="{{true}}">' + busy + '<div aria-hidden="true" style="display: flex; flex-direction: column; gap: 12px">'
        '<section class="mm-card" style="gap: 10px; padding: 16px"><span style="display: flex; gap: 6px">' + sk('72px', 20) + sk('64px', 20) + '</span>' + sk('40%', 22) + sk('60%') + sk('100%', 40) + '</section>'
        '<section class="mm-card" style="gap: 10px; padding: 16px">' + sk('88px', 14) + sk('60%') + sk('80%') + '<span style="display: flex; gap: 8px">' + sk('50%', 40) + sk('50%', 40) + '</span></section>'
        '<section class="mm-card" style="gap: 12px; padding: 16px">' + sk('64px', 14) + '<sc-for list="{{lines}}" as="ln" hint-placeholder-count="3"><div style="display: flex; align-items: center; gap: 12px">' + sk('40px', 40)
        + '<span style="flex: 1; display: flex; flex-direction: column; gap: 6px">' + sk('{{ln.a}}') + sk('{{ln.b}}', 8) + '</span></div></sc-for></section></div></sc-if>',
        '<sc-if value="{{failed}}" hint-placeholder-val="{{false}}"><section class="mm-card" style="padding: 0">' + failed('This order', True) + '</section></sc-if>',
        '<sc-if value="{{missing}}" hint-placeholder-val="{{false}}"><section class="mm-card" style="padding: 0">' + missing(True) + '</section></sc-if>',
        '</main>', '</sc-if>'])
    ph = '\n'.join([PROOT % 'var(--background)', list_p, rec_p]) + '\n@@PTOAST@@\n\n</div>\n</x-dc>\n'
    js = oread('states.js'); opts = js_starts(js)
    owrite('States', 'orders', [('Orders', 'Orders.dc.html'), ('Loading and errors', '')], 'Loading and errors', d, ph, js, opts, opts[0])

def js_starts(js):
    """The top-level keys of START, in order."""
    i = js.index('var START = {') + len('var START = {')
    depth, out, k = 0, [], i
    keyre = re.compile(r"\s*(?:'([^']+)'|\"([^\"]+)\"|(\w+))\s*:")
    while True:
        if depth == 0:
            m = keyre.match(js, k)
            if m: out.append(m.group(1) or m.group(2) or m.group(3)); k = m.end()
        c = js[k]
        if c in '{[': depth += 1
        elif c in '}]':
            if depth == 0: break
            depth -= 1
        elif c == "'" :
            k = js.index("'", k + 1)
        elif c == ',' and depth == 0:
            pass
        k += 1
    return out


# ======================================================================
# New order
# ======================================================================
def no_cards(phone):
    g2 = '<div style="display: grid; grid-template-columns: %s; gap: 12px">' % ('minmax(0, 1fr)' if phone else 'repeat(2, minmax(0, 1fr))')
    g3 = '<div style="display: grid; grid-template-columns: %s; gap: 12px">' % ('minmax(0, 1fr)' if phone else '140px minmax(0, 1fr) minmax(0, 1.4fr)')
    top = '10px' if phone else '8px'
    find = pcombo_btn('fc', 'mm-l-fc') if phone else combo_btn('fc', 'mm-l-fc')
    cust = '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-nc" style="gap: 14px">' + chead('mm-c-nc', 'Customer'),
        '<div class="mm-field"><span class="mm-label" id="mm-l-fc">Find a customer</span>' + find + '</div>',
        g2 + '<div class="mm-field"><label class="mm-label" for="mm-nc-ph">Phone</label><input id="mm-nc-ph" class="mm-input" type="tel" inputMode="tel" placeholder="01712-345678" aria-invalid="{{cu.phoneAria}}" value="{{cu.phone}}" onChange="{{cu.onPhone}}" style="font-variant-numeric: tabular-nums"><sc-if value="{{cu.phoneBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter an 11-digit number starting with 01.</p></sc-if></div>'
        '<div class="mm-field"><label class="mm-label" for="mm-nc-nm">Name</label><input id="mm-nc-nm" class="mm-input" maxLength="120" aria-invalid="{{cu.nameAria}}" value="{{cu.name}}" onChange="{{cu.onName}}"><sc-if value="{{cu.nameBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter the customer’s name.</p></sc-if></div></div>',
        '<sc-if value="{{isKnown}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: -6px 0 0; font-size: 13px">{{knownText}}</p></sc-if>',
        '<sc-if value="{{isBlocked}}" hint-placeholder-val="{{false}}"><div class="mm-banner mm-bad" role="alert" style="font-size: 13px">' + svg(ICONS['ban']) + '<p style="margin: 0">{{blockText}}</p></div></sc-if>',
        '<sc-if value="{{isDup}}" hint-placeholder-val="{{false}}"><div class="mm-banner" role="status" style="font-size: 13px">' + svg(ICONS['copy']) + '<p style="margin: 0">{{dupText}} <a href="%s" style="font-weight: 500; color: var(--foreground); text-decoration: underline; text-underline-offset: 2px">Open it</a></p></div></sc-if>' % ('OrderPhone.dc.html' if phone else 'Order.dc.html'),
        '<sc-if value="{{hasRecord}}" hint-placeholder-val="{{false}}"><div style="display: flex; align-items: center; gap: 8px">' + sbadge('record') + '<span class="mm-muted" style="font-size: 13px">{{recordText}}</span></div></sc-if>',
        g2 + '<div class="mm-field"><label class="mm-label" for="mm-nc-em">' + opt('Email') + '</label><input id="mm-nc-em" class="mm-input" type="email" value="{{cu.email}}" onChange="{{cu.onEmail}}"></div>'
        '<div class="mm-field"><span class="mm-label" id="mm-l-src">Source</span>' + chips('cu.sources', 'sr', 5, 'mm-l-src').replace('display: flex; flex-wrap: wrap; gap: 6px', 'display: flex; flex-wrap: wrap; gap: 6px; min-height: %s; align-items: center' % ('40px' if phone else '36px')) + '</div></div>',
        '</section>'])
    if phone:
        line = ('<li style="flex-direction: column; align-items: stretch; gap: 8px"><div style="display: flex; gap: 8px"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{nl.title}}</span><span class="mm-trunc mm-muted" style="font-size: 12px">{{nl.opts}} · {{nl.price}}</span><span style="font-size: 12px; color: {{nl.availColor}}">{{nl.avail}}</span></span>'
                '<button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{nl.removeAria}}" onClick="{{nl.remove}}" style="margin: -6px -8px 0 0">' + svg(ICONS['x'], 18) + '</button></div>'
                '<div style="display: flex; align-items: center; justify-content: space-between">' + ostep('nl', True) + '<span style="font-weight: 600; font-variant-numeric: tabular-nums">{{nl.total}}</span></div></li>')
    else:
        line = ('<li style="display: block"><div class="mm-nline"><span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{nl.title}}</span><span class="mm-trunc" style="font-size: 12px"><span class="mm-muted">{{nl.opts}} · </span><span style="color: {{nl.availColor}}">{{nl.avail}}</span></span></span>'
                + ostep('nl', False) + '<span class="mm-num mm-muted" style="font-size: 13px">{{nl.price}}</span><span class="mm-num" style="font-weight: 500">{{nl.total}}</span>'
                '<button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{nl.removeAria}}" onClick="{{nl.remove}}" style="width: 28px; height: 28px">' + svg(ICONS['x']) + '</button></div></li>')
    pop = '' if phone else combo_pop('ap', 'No product found.').replace('class="mm-pop"', 'class="mm-pop" style="top: 44px; left: 0; right: 0"', 1)
    items = '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-ni" style="gap: 12px">' + chead('mm-c-ni', 'Items'),
        '<sc-if value="{{hasLines}}" hint-placeholder-val="{{true}}"><ul class="mm-mlist" aria-label="Items"><sc-for list="{{lines}}" as="nl" hint-placeholder-count="2">' + line + '</sc-for></ul></sc-if>',
        '<div style="position: relative"><button type="button" class="mm-addrow" aria-haspopup="%s" aria-expanded="{{apAria}}" onClick="{{addProduct}}">' % ('dialog' if phone else 'listbox') + svg(ICONS['plus']) + 'Add a product</button>' + pop + '</div>',
        '<sc-if value="{{linesBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err" style="margin: -4px 0 0">Add at least one item.</p></sc-if>',
        '</section>'])
    delivery = '\n'.join([
        '<sc-if value="{{showDel}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-labelledby="mm-c-nd" style="gap: 14px">' + chead('mm-c-nd', 'Delivery'),
        '<label style="display: flex; align-items: center; gap: 10px; cursor: pointer">' + checkbox('noDel') + '<span>No delivery (collected in the shop)</span></label>',
        '<sc-if value="{{delOn}}" hint-placeholder-val="{{true}}">',
        '<sc-if value="{{hasSaved}}" hint-placeholder-val="{{false}}"><div class="mm-field" style="gap: 0"><p id="mm-l-sa" class="mm-label" style="margin: 0 0 8px">Saved addresses</p>' + radio_list('addrs', 'mm-l-sa', var='sa', count=2) + '</div></sc-if>',
        '<sc-if value="{{newAddr}}" hint-placeholder-val="{{true}}">' + g3 + '<div class="mm-field"><label class="mm-label" for="mm-ad-d">District</label><input id="mm-ad-d" class="mm-input" value="{{ad.district}}" onChange="{{ad.onDistrict}}"></div>'
        '<div class="mm-field"><label class="mm-label" for="mm-ad-a">Area</label><input id="mm-ad-a" class="mm-input" placeholder="Dhanmondi" aria-invalid="{{ad.areaAria}}" value="{{ad.area}}" onChange="{{ad.onArea}}"><sc-if value="{{ad.areaBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter the area.</p></sc-if></div>'
        '<div class="mm-field"><label class="mm-label" for="mm-ad-s">Street and house</label><input id="mm-ad-s" class="mm-input" placeholder="House 12, Road 5" value="{{ad.street}}" onChange="{{ad.onStreet}}"></div></div></sc-if>',
        '<div class="mm-field"><span class="mm-label" id="mm-l-zn">Delivery zone</span>' + chips('zones', 'zn', 3, 'mm-l-zn') + '<p class="mm-hint">{{zoneHint}}</p></div>',
        '</sc-if>', '</section></sc-if>'])
    disc = '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-ds" style="gap: 14px">' + chead('mm-c-ds', 'Discounts'),
        '<div class="mm-field"><label class="mm-label" for="mm-ds-code">' + opt('Offer code') + '</label>',
        '<sc-if value="{{noOffer}}" hint-placeholder-val="{{true}}"><div style="display: flex; gap: 8px"><input id="mm-ds-code" class="mm-input" placeholder="EID10" aria-invalid="{{codeAria}}" value="{{code}}" onChange="{{onCode}}" style="flex: 1; min-width: 0; text-transform: uppercase"><button type="button" class="mm-btn mm-outline" onClick="{{applyCode}}">Apply</button></div><sc-if value="{{codeBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">That code isn’t active.</p></sc-if></sc-if>',
        '<sc-if value="{{hasOffer}}" hint-placeholder-val="{{false}}"><div class="mm-readonly">' + svg(ICONS['tag'], 16, 'flex: none; color: var(--muted-foreground)') + '<span class="mm-trunc" style="flex: 1"><span class="mm-mono" style="font-weight: 600">{{code}}</span> · {{offerText}}</span><span style="font-variant-numeric: tabular-nums">{{offerOff}}</span><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="Remove the code" onClick="{{removeCode}}" style="width: 24px; height: 24px; margin-right: -4px">' + svg(ICONS['x'], 14) + '</button></div></sc-if></div>',
        '<div class="mm-field"><span class="mm-label" id="mm-l-mk">Manual discount</span>' + chips('mkinds', 'mk', 3, 'mm-l-mk') + '</div>',
        '<sc-if value="{{hasManual}}" hint-placeholder-val="{{false}}">' + g2.replace('repeat(2, minmax(0, 1fr))', '160px minmax(0, 1fr)') + '<div class="mm-field"><label class="mm-label" for="mm-ds-v">Discount</label><sc-if value="{{mvIsAmt}}" hint-placeholder-val="{{true}}"><label class="mm-affix"><span aria-hidden="true" style="top: %s">৳</span><input id="mm-ds-v" class="mm-input" inputMode="decimal" value="{{mv}}" onChange="{{onMv}}"></label></sc-if>' % top
        + '<sc-if value="{{mvIsPct}}" hint-placeholder-val="{{false}}"><label class="mm-affix mm-affix-r"><input id="mm-ds-v" class="mm-input" inputMode="decimal" value="{{mv}}" onChange="{{onMv}}"><span aria-hidden="true" style="top: %s">%%</span></label></sc-if></div>' % top
        + '<div class="mm-field"><label class="mm-label" for="mm-ds-r">Reason</label><input id="mm-ds-r" class="mm-input" maxLength="200" placeholder="Wholesale buyer" aria-invalid="{{mrAria}}" value="{{mr}}" onChange="{{onMr}}"><sc-if value="{{mrBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Say why. It shows on the order.</p></sc-if></div></div></sc-if>',
        '</section>'])
    payment = '\n'.join([
        '<section class="mm-card" aria-labelledby="mm-c-np" style="gap: 14px">' + chead('mm-c-np', 'Payment'),
        '<sc-if value="{{showPayMode}}" hint-placeholder-val="{{true}}">' + radio_list('paymodes', 'mm-c-np', var='pmd', count=2).replace('flex-direction: column; gap: 6px', 'flex-direction: %s; gap: 6px' % ('column' if phone else 'row')).replace('class="mm-mode"', 'class="mm-mode" style="flex: 1"') + '</sc-if>',
        '<sc-if value="{{isPaid}}" hint-placeholder-val="{{false}}">',
        '<div class="mm-field"><span class="mm-label" id="mm-l-nm">Paid by</span><div role="radiogroup" aria-labelledby="mm-l-nm" class="mm-paygrid"><sc-for list="{{methods}}" as="pm" hint-placeholder-count="5"><button type="button" role="radio" class="mm-paybtn" aria-checked="{{pm.on}}" onClick="{{pm.pick}}">{{pm.label}}</button></sc-for></div></div>',
        g2 + '<div class="mm-field"><label class="mm-label" for="mm-np-a">Amount</label><label class="mm-affix"><span aria-hidden="true" style="top: %s">৳</span><input id="mm-np-a" class="mm-input" inputMode="decimal" placeholder="{{amountPh}}" value="{{amount}}" onChange="{{onAmount}}" style="font-variant-numeric: tabular-nums"></label><p class="mm-hint">{{amountHint}}</p></div>' % top
        + '<div class="mm-field"><label class="mm-label" for="mm-np-r">' + opt('Reference') + '</label><input id="mm-np-r" class="mm-input" maxLength="100" value="{{ref}}" onChange="{{onRef}}" placeholder="Transaction ID"></div></div>',
        '</sc-if>', '</section>'])
    note = '<section class="mm-card" aria-labelledby="mm-c-nn" style="gap: 10px">' + chead('mm-c-nn', 'Note for the order') + '<textarea class="mm-textarea" aria-labelledby="mm-c-nn" maxLength="1000" value="{{note}}" onChange="{{onNote}}" placeholder="Printed on the packing slip."></textarea></section>'
    return [cust, items, delivery, disc, payment, note]

def no_summary(phone):
    btns = ('<sc-if value="{{notWalkIn}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" style="width: 100%" onClick="{{saveConfirm}}">Save and confirm</button><button type="button" class="mm-btn mm-outline" style="width: 100%" onClick="{{savePending}}">Save as pending</button></sc-if>'
            '<sc-if value="{{walkIn}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" style="width: 100%" onClick="{{saveConfirm}}">Complete the sale</button></sc-if>')
    if phone:
        btns = '<sc-if value="{{notWalkIn}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" style="width: 100%" onClick="{{savePending}}">Save as pending</button></sc-if>'
    return ('<section class="mm-card%s" aria-labelledby="mm-c-sm" style="gap: 12px%s">' % ('' if phone else ' mm-sticky', '' if phone else '; top: 0') + chead('mm-c-sm', 'Summary', '', '{{itemsText}}').replace('<span class="mm-muted" style="font-size: 13px">', '<span class="mm-muted" style="margin-left: auto; font-size: 13px">')
            + '<div style="display: flex; flex-direction: column; gap: 6px"><sc-for list="{{sum}}" as="sm" hint-placeholder-count="3"><div class="mm-kv"><span class="mm-trunc">{{sm.label}}</span><span>{{sm.value}}</span></div></sc-for>'
            + '<div class="mm-kv" style="margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--border); font-weight: 600"><span style="color: var(--foreground)">Total</span><span>{{total}}</span></div>'
            + '<sc-if value="{{hasPaidRow}}" hint-placeholder-val="{{false}}"><div class="mm-kv"><span>Paid</span><span style="color: var(--success)">{{paidRow}}</span></div></sc-if>'
            + '<div class="mm-kv" style="font-weight: 600"><span>{{collectLabel}}</span><span>{{collect}}</span></div></div>' + btns + '</section>')

def neworder():
    cards = no_cards(False)
    d = '\n'.join([MAIN,
        '<div style="display: flex; align-items: center; gap: 12px"><a href="Orders.dc.html" class="mm-btn mm-ghost mm-icon" aria-label="Back to orders" style="margin-left: -8px">' + svg(ICONS['back']) + '</a><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">New order</h1></div>',
        ALERT_PROBLEMS,
        '<div class="mm-cols"><div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">'] + cards + ['</div>', no_summary(False), '</div>']) + DEND + XEND
    pc = no_cards(True)
    ph = '\n'.join([PROOT % 'var(--page)', phone_back('OrdersPhone.dc.html', 'Back to orders', 'New order'),
        '<main class="mm-scroll" style="gap: 12px; padding: 12px">', ALERT_PROBLEMS] + pc + [no_summary(True), '</main>',
        '<div style="display: flex; flex: none; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--background)"><span style="flex: 1; display: flex; flex-direction: column"><span class="mm-muted" style="font-size: 12px">{{collectLabel}}</span><span style="font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums">{{collect}}</span></span>'
        '<sc-if value="{{notWalkIn}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" onClick="{{saveConfirm}}">Save and confirm</button></sc-if><sc-if value="{{walkIn}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" onClick="{{saveConfirm}}">Complete the sale</button></sc-if></div>', ''])
    ph += PCOMBO_DRAWER + '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    js = oread('neworder.js')
    opts = js_starts(js)
    owrite('NewOrder', 'orders', [('Orders', 'Orders.dc.html'), ('New order', '')], 'New order', d, ph, js, opts, opts[0])


# ======================================================================
# Confirm orders
# ======================================================================
def call_body(phone):
    return '\n'.join([
        '<a href="{{cl.tel}}" class="mm-btn mm-primary" style="width: 100%">' + svg(ICONS['phone']) + '{{cl.callText}}</a>',
        '<p class="mm-script" style="margin: 0">{{cl.script}}</p>',
        '<div style="display: flex; flex-direction: column; gap: 6px; font-size: 13px"><sc-for list="{{cl.lines}}" as="cln" hint-placeholder-count="1"><div class="mm-kv"><span>{{cln.text}}</span><span>{{cln.value}}</span></div></sc-for>'
        '<div class="mm-kv" style="font-weight: 600"><span style="color: var(--foreground)">{{cl.total}}</span></div><span class="mm-muted">{{cl.address}}</span></div>',
        '<div class="mm-field" style="gap: 0"><p id="mm-cl-out" class="mm-label" style="margin: 0 0 8px">What happened</p>' + radio_list('cl.outcomes', 'mm-cl-out', var='oc', count=5) + '</div>',
        '<sc-if value="{{cl.isLater}}" hint-placeholder-val="{{false}}"><div class="mm-field"><span class="mm-label" id="mm-l-wh">Call back</span>' + chips('cl.whens', 'wh', 4, 'mm-l-wh') + '</div></sc-if>',
        '<sc-if value="{{cl.isCancelled}}" hint-placeholder-val="{{false}}"><div class="mm-field" style="gap: 0"><p id="mm-cl-why" class="mm-label" style="margin: 0 0 8px">Why</p>' + radio_list('cl.codes', 'mm-cl-why', sub=False, var='ccd', count=4) + '</div></sc-if>',
        '<sc-if value="{{cl.isCancel}}" hint-placeholder-val="{{false}}"><label style="display: flex; align-items: center; gap: 10px; cursor: pointer">' + checkbox('cl.block') + '<span>Also block this phone</span></label></sc-if>',
        '<div class="mm-field"><label class="mm-label" for="mm-cl-note">' + opt('Note') + '</label><input id="mm-cl-note" class="mm-input" maxLength="300" value="{{cl.note}}" onChange="{{cl.onNote}}" placeholder="What they said"></div>',
        '<sc-if value="{{cl.bad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err" role="alert" style="margin: 0">{{cl.badText}}</p></sc-if>',
        '<div style="display: flex; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border)"><a href="%s" class="mm-btn mm-outline" style="height: 32px">' % ('OrderPhone.dc.html' if phone else 'Order.dc.html') + svg(ICONS['pencil']) + 'Change the order</a><button type="button" class="mm-btn mm-ghost mm-danger" style="height: 32px" onClick="{{cl.stop}}">Stop calling</button></div>'])

def confirm():
    card = ('<sc-for list="{{cards}}" as="cd" hint-placeholder-count="3"><li class="mm-ccard" data-due="{{cd.dueFlag}}">'
            '<div style="display: flex; align-items: center; gap: 8px"><a href="@@ORDER@@" class="mm-mono" style="font-weight: 600; color: var(--foreground)" aria-label="{{cd.aria}}">{{cd.n}}</a><span class="mm-muted" style="font-size: 12px">{{cd.placed}}</span><span style="flex: 1"></span>' + sbadge('cd.risk') + '</div>'
            '<div style="display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 600">{{cd.name}}</span><span class="mm-muted" style="font-size: 13px; font-variant-numeric: tabular-nums">{{cd.phone}} · {{cd.area}}</span></div>'
            '<div style="display: flex; justify-content: space-between; gap: 8px; font-size: 13px"><span class="mm-trunc">{{cd.items}}</span><span style="flex: none; font-weight: 600; font-variant-numeric: tabular-nums">{{cd.cod}}</span></div>'
            '<div style="display: flex; flex-direction: column; gap: 4px; font-size: 13px">'
            '<span style="display: flex; align-items: center; gap: 6px" class="mm-muted">' + svg(ICONS['phone'], 14, 'flex: none') + '<span class="mm-trunc">{{cd.info}}</span></span>'
            '<sc-if value="{{cd.hasDue}}" hint-placeholder-val="{{false}}"><span class="mm-warn" style="display: flex; align-items: center; gap: 6px; font-weight: 500">' + svg(ICONS['clock'], 14, 'flex: none') + '{{cd.due}}</span></sc-if>'
            '<sc-if value="{{cd.hasSms}}" hint-placeholder-val="{{false}}"><span class="mm-muted" style="display: flex; align-items: center; gap: 6px">' + svg(ICONS['msg'], 14, 'flex: none') + '{{cd.sms}}</span></sc-if>'
            '<sc-if value="{{cd.hasDup}}" hint-placeholder-val="{{false}}"><span class="mm-warn" style="display: flex; align-items: center; gap: 6px; font-weight: 500">' + svg(ICONS['copy'], 14, 'flex: none') + '{{cd.dup}}</span></sc-if></div>'
            '<sc-if value="{{cd.free}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{cd.call}}">' + svg(ICONS['phone']) + '{{cd.callText}}</button></sc-if>'
            '<sc-if value="{{cd.locked}}" hint-placeholder-val="{{false}}"><div class="mm-readonly" style="justify-content: center; color: var(--muted-foreground)">' + svg(ICONS['lock'], 14, 'flex: none') + '{{cd.lockText}}</div></sc-if>'
            '</li></sc-for>')
    empty = '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}"><div class="mm-emptybox">' + svg(ICONS['ok'], 24) + '<p style="margin: 0">{{emptyText}}</p><sc-if value="{{allDone}}" hint-placeholder-val="{{false}}"><a href="@@ORDERS@@" class="mm-btn mm-outline">See all orders</a></sc-if></div></sc-if>'
    sortc = '<label style="display: inline-flex; align-items: center; gap: 8px; font-weight: 500; cursor: pointer">' + checkbox('risky') + 'Risky first</label>'
    d = otop('Confirm orders', '<a href="NewOrder.dc.html" class="mm-btn mm-outline">@@I:plus@@New order</a>', 'confirm') + '\n'.join([
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">' + ttabs(count=3) + sortc + '<span class="mm-muted" style="margin-left: auto; font-size: 13px">{{summary}}</span></div>',
        '<ul class="mm-ccards" aria-label="Orders to call" style="list-style: none; margin: 0; padding: 0; grid-template-columns: repeat(3, minmax(0, 1fr))">' + card.replace('@@ORDER@@', 'Order.dc.html') + '</ul>',
        empty.replace('@@ORDERS@@', 'Orders.dc.html')]) + DEND
    d += dpanel('cl.open', 'closeCall', 'mm-cl-title', '{{cl.title}}', '{{cl.sub}}', call_body(False), '', dfoot_buttons('closeCall', 'cl.save', '')[0], dfoot_buttons('closeCall', 'cl.save', '{{cl.saveText}}')[1])
    d += XEND
    ph = optop('Confirm orders', '', 'confirm') + '\n'.join([
        ttabs(count=3, phone=True),
        '<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">' + sortc + '<span class="mm-muted" style="font-size: 12px; text-align: right">{{summary}}</span></div>',
        '<ul class="mm-ccards" aria-label="Orders to call" style="list-style: none; margin: 0; padding: 0">' + card.replace('@@ORDER@@', 'OrderPhone.dc.html') + '</ul>',
        empty.replace('@@ORDERS@@', 'OrdersPhone.dc.html')]) + PEND
    ph += pdrawer('cl.open', 'closeCall', 'mm-cl-title', '{{cl.title}}', '{{cl.sub}}', pbody(call_body(True)), pfoot('closeCall', 'cl.save', '{{cl.saveText}}'))
    ph += PXEND
    js = oread('confirm.js')
    opts = js_starts(js)
    owrite('Confirm', 'confirm', [('Orders', 'Orders.dc.html'), ('Confirm orders', '')], 'Confirm orders', d, ph, js, opts, opts[0])


# ======================================================================
# Incomplete orders
# ======================================================================
def incomplete():
    menu = dmenu('r.menuOpen', 'r.toggleMenu', 'r.menuAria', [('link', 'Open', 'IncompleteOrder.dc.html', 'file'), ('link', 'Call', '{{r.tel}}', 'phone'), ('Create order', 'r.create', 'plus', 'r.isOpen'), ('Mark as contacted', 'r.contact', 'check', 'r.notContacted'), 'sep', ('Dismiss', 'r.dismiss', 'x', 'r.isOpen')], width=200)
    d = otop('Incomplete orders', '', 'incomplete') + '\n'.join([
        ttabs(count=4),
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">' + search('Search by name or phone') + RESET + '<span class="mm-muted" style="margin-left: auto; font-size: 13px">{{summary}}</span></div>',
        '<div style="border: 1px solid var(--border); border-radius: 10px">',
        '<div class="mm-incgrid mm-thead" aria-hidden="true"><span>Shopper</span><span>Items</span><span class="mm-num">Value</span><span>Left at</span><span>Started</span><span>Status</span><span></span></div>',
        OUL % 'Incomplete orders',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="3"><li><div class="mm-incgrid mm-row" style="min-height: 56px">',
        '<span style="display: flex; flex-direction: column; min-width: 0"><a href="IncompleteOrder.dc.html" class="mm-rowlink" aria-label="{{r.aria}}" style="color: {{r.nameColor}}">{{r.name}}</a><span class="mm-trunc mm-muted" style="font-size: 13px; font-variant-numeric: tabular-nums">{{r.phone}} · {{r.area}}</span></span>',
        '<span class="mm-trunc">{{r.items}}</span>',
        '<span class="mm-num" style="font-weight: 500">{{r.value}}</span>',
        '<span>{{r.step}}</span>',
        '<span class="mm-muted" style="font-size: 13px; font-variant-numeric: tabular-nums">{{r.when}}</span>',
        '<span style="display: flex; align-items: center; gap: 6px"><sc-if value="{{r.isOpen}}" hint-placeholder-val="{{true}}"><sc-if value="{{r.contacted}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">Contacted</span></sc-if><sc-if value="{{r.notContacted}}" hint-placeholder-val="{{true}}"><span class="mm-muted">Not called</span></sc-if></sc-if><sc-if value="{{r.hasMade}}" hint-placeholder-val="{{false}}"><a href="Order.dc.html" class="mm-mono" style="color: var(--foreground); font-weight: 500; position: relative; z-index: 2">{{r.made}}</a></sc-if></span>',
        menu,
        '</div></li></sc-for>', '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Clear search', 'emptyCanReset', 'emptyReset') + '</sc-if>',
        '</div>',
        '<p class="mm-muted" style="margin: 0; font-size: 13px">A checkout shows up here when a shopper gives their phone number on the website and leaves before paying.</p>']) + DEND + XEND
    ph = optop('Incomplete orders', '', 'incomplete') + '\n'.join([
        ttabs(count=4, phone=True),
        '<div style="display: flex; gap: 8px">' + search('Name or phone', phone=True) + '</div>',
        '<p class="mm-muted" style="margin: 0; font-size: 13px">{{summary}}</p>',
        '<ul class="mm-plist" aria-label="Incomplete orders">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="3"><li><div class="mm-prow" style="align-items: flex-start; gap: 10px; padding: 12px 4px 12px 12px">',
        '<a href="IncompleteOrderPhone.dc.html" class="mm-rowlink" aria-label="{{r.aria}}" style="display: flex; flex-direction: column; gap: 2px"><span class="mm-trunc" style="color: {{r.nameColor}}">{{r.name}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; font-weight: 400">{{r.items}}</span><span class="mm-muted" style="font-size: 12px; font-weight: 400">{{r.meta}}</span></a>',
        '<span style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none"><span style="font-weight: 600; font-variant-numeric: tabular-nums">{{r.value}}</span><sc-if value="{{r.contacted}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">Contacted</span></sc-if></span>',
        '<button type="button" class="mm-btn mm-ghost mm-icon mm-above" aria-label="{{r.menuAria}}" aria-haspopup="dialog" onClick="{{r.toggleMenu}}" style="margin-top: -6px">' + svg(ICONS['dots'], 18) + '</button>',
        '</div></li></sc-for>', '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Clear search', 'emptyCanReset', 'emptyReset', pad='32px 16px') + '</sc-if>']) + PEND
    ph += pdrawer('menuOpen', 'closeAll', 'mm-mx-title', '{{mx.name}}', '{{mx.meta}}', '\n'.join([
        '<div role="menu" aria-labelledby="mm-mx-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<a href="IncompleteOrderPhone.dc.html" role="menuitem" class="mm-optrow">' + svg(ICONS['file'], 18) + 'Open</a>',
        '<a href="{{mx.tel}}" role="menuitem" class="mm-optrow">' + svg(ICONS['phone'], 18) + 'Call</a>',
        '<sc-if value="{{mx.isOpen}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.create}}">' + svg(ICONS['plus'], 18) + 'Create order</button></sc-if>',
        '<sc-if value="{{mx.notContacted}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.contact}}">' + svg(ICONS['check'], 18) + 'Mark as contacted</button></sc-if>',
        '<sc-if value="{{mx.isOpen}}" hint-placeholder-val="{{true}}"><div role="separator" class="mm-sep"></div><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{mx.dismiss}}">' + svg(ICONS['x'], 18) + 'Dismiss</button></sc-if>',
        '</div>']), '', tall=False) + PXEND
    js = oread('incomplete.js'); opts = js_starts(js)
    owrite('Incomplete', 'incomplete', [('Orders', 'Orders.dc.html'), ('Incomplete orders', '')], 'Incomplete orders', d, ph, js, opts, opts[0])

def inc_cards(phone):
    if phone:
        line = ('<li style="flex-direction: row; align-items: center; gap: 10px"><span class="mm-thumb2">' + svg(ICONS['box'], 18) + '</span><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{il.title}}</span>'
                '<span class="mm-muted" style="font-size: 12px">{{il.qty}} {{il.now}}<sc-if value="{{il.diff}}" hint-placeholder-val="{{false}}"> · was {{il.then}}</sc-if></span><span style="font-size: 12px; color: {{il.stockColor}}">{{il.stock}}</span></span><span style="font-weight: 500; font-variant-numeric: tabular-nums">{{il.total}}</span></li>')
    else:
        line = ('<li style="flex-direction: row; align-items: center; gap: 12px"><span class="mm-thumb2">' + svg(ICONS['box'], 18) + '</span><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{il.title}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{il.opts}} · <span style="color: {{il.stockColor}}">{{il.stock}}</span></span></span>'
                '<span class="mm-muted" style="width: 36px; text-align: right">{{il.qty}}</span><span style="width: 150px; display: flex; flex-direction: column; align-items: flex-end; font-variant-numeric: tabular-nums"><span>Now {{il.now}}</span><sc-if value="{{il.diff}}" hint-placeholder-val="{{false}}"><span class="mm-warn" style="font-size: 12px">In the cart at {{il.then}}</span></sc-if></span><span style="width: 90px; text-align: right; font-weight: 500; font-variant-numeric: tabular-nums">{{il.total}}</span></li>')
    items = ('<section class="mm-card" aria-labelledby="mm-c-ii" style="gap: 8px">' + chead('mm-c-ii', 'Items')
             + '<ul class="mm-mlist"><sc-for list="{{lines}}" as="il" hint-placeholder-count="2">' + line + '</sc-for></ul>'
             + '<div style="display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--border)"><div class="mm-kv" style="font-weight: 600"><span style="color: var(--foreground)">Items total</span><span>{{itemsTotal}}</span></div>'
             + '<sc-if value="{{ic.hasCode}}" hint-placeholder-val="{{false}}"><div class="mm-kv"><span>Offer code typed</span><span class="mm-mono">{{ic.code}}</span></div></sc-if></div>'
             + '<sc-if value="{{priceChanged}}" hint-placeholder-val="{{false}}"><div class="mm-banner" style="font-size: 13px">' + svg(ICONS['info']) + '<p style="margin: 0">A price changed since they left: the cart was {{thenTotal}}. A new order uses today’s prices.</p></div></sc-if></section>')
    note = ('<section class="mm-card" aria-labelledby="mm-c-in" style="gap: 10px">' + chead('mm-c-in', 'The call note')
            + '<textarea class="mm-textarea" aria-labelledby="mm-c-in" maxLength="1000" value="{{nd}}" onChange="{{onNd}}" placeholder="What they said when you called."></textarea>'
            + '<button type="button" class="mm-btn mm-outline" style="align-self: flex-end; height: 32px" disabled="{{noteSame}}" onClick="{{saveNote}}">Save note</button></section>')
    shopper = ('<section class="mm-card" aria-labelledby="mm-c-is" style="gap: 14px">' + chead('mm-c-is', 'Shopper')
               + '<div style="display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 500; color: {{ic.nameColor}}">{{ic.name}}</span><span class="mm-muted" style="font-size: 13px; font-variant-numeric: tabular-nums">{{ic.phone}}</span></div>'
               + '<div style="display: flex; gap: 8px"><a href="{{ic.tel}}" class="mm-btn mm-outline" style="flex: 1%s">' % ('' if phone else '; height: 32px') + svg(ICONS['phone']) + 'Call</a><a href="{{ic.wa}}" class="mm-btn mm-outline" style="flex: 1%s">' % ('' if phone else '; height: 32px') + svg(ICONS['msg']) + 'WhatsApp</a></div>'
               + '<div style="display: flex; flex-direction: column; gap: 4px; padding-top: 12px; border-top: 1px solid var(--border)"><span class="mm-label">Address they typed</span><span style="color: {{ic.addrColor}}">{{ic.address}}</span></div></section>')
    steps = ('<section class="mm-card" aria-labelledby="mm-c-ist" style="gap: 12px">' + chead('mm-c-ist', 'Checkout')
             + '<ol class="mm-tl"><sc-for list="{{steps}}" as="st" hint-placeholder-count="3"><li><span class="mm-tldot" aria-hidden="true"></span><span style="flex: 1; display: flex; justify-content: space-between; gap: 8px"><span>{{st.label}}</span><span class="mm-muted" style="font-size: 13px">{{st.note}}</span></span></li></sc-for></ol></section>')
    return items, note, shopper, steps

INC_BANNERS = ('<sc-if value="{{ic.hasMade}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['ok']) + '<p style="margin: 0">{{ic.made}}</p></div></sc-if>'
               '<sc-if value="{{ic.dismissed}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['x']) + '<p style="margin: 0; flex: 1">Dismissed. It’s off the call list.</p><button type="button" class="mm-btn mm-outline" style="height: 28px; margin: -4px 0" onClick="{{restore}}">Put it back</button></div></sc-if>')

def incorder():
    items, note, shopper, steps = inc_cards(False)
    more = ('<sc-if value="{{isOpen}}" hint-placeholder-val="{{true}}"><div style="position: relative; display: flex">'
            '<button type="button" class="mm-btn mm-outline mm-icon" aria-label="More actions" aria-haspopup="menu" aria-expanded="{{moreAria}}" onClick="{{toggleMore}}">' + svg(ICONS['dots']) + '</button>'
            '<sc-if value="{{moreOpen}}" hint-placeholder-val="{{false}}"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close menu" onClick="{{closePop}}" style="z-index: 35; background: transparent"></button>'
            '<div role="menu" aria-label="More actions" class="mm-menu" onKeyDown="{{escClose}}" style="top: 40px; right: 0; width: 200px">'
            '<sc-if value="{{notContacted}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-cmd-item" onClick="{{contact}}">' + svg(ICONS['check']) + 'Mark as contacted</button><div role="separator" class="mm-sep"></div></sc-if>'
            '<button type="button" role="menuitem" class="mm-cmd-item mm-danger" onClick="{{askDismiss}}">' + svg(ICONS['x']) + 'Dismiss</button>'
            '</div></sc-if></div></sc-if>')
    head = '\n'.join([
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">',
        '<a href="Incomplete.dc.html" class="mm-btn mm-ghost mm-icon" aria-label="Back to incomplete orders" style="margin-left: -8px">' + svg(ICONS['back']) + '</a>',
        '<h1 class="mm-trunc" style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">{{ic.title}}</h1>' + sbadge('ic.chip'),
        '<sc-if value="{{ic.contacted}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">Contacted</span></sc-if>',
        '<span style="flex: 1"></span>',
        '<a href="{{ic.tel}}" class="mm-btn mm-outline">' + svg(ICONS['phone']) + 'Call</a>',
        '<sc-if value="{{isOpen}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" onClick="{{create}}">' + svg(ICONS['plus']) + 'Create order</button></sc-if>',
        more, '</div>', '<p class="mm-muted" style="margin: -8px 0 0">{{ic.sub}}</p>'])
    d = '\n'.join([MAIN, head, INC_BANNERS,
        '<div class="mm-cols"><div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">', items, note, '</div>',
        '<div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">', shopper, steps, '</div></div>']) + DEND
    d += palert('confirmOpen', 'Dismiss this checkout?', '<p style="margin: 0">It leaves the call list. Nothing is ordered, and you can put it back later.</p>', 'cancelConfirm', 'doDismiss', 'Dismiss') + XEND
    items, note, shopper, steps = inc_cards(True)
    right = '<sc-if value="{{isOpen}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="More actions" aria-haspopup="dialog" onClick="{{toggleMore}}">' + svg(ICONS['dots'], 18) + '</button></sc-if>'
    ph = '\n'.join([PROOT % 'var(--page)', phone_back('IncompletePhone.dc.html', 'Back to incomplete orders', 'Incomplete order', right),
        '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
        '<section class="mm-card" style="gap: 10px"><div style="display: flex; flex-wrap: wrap; gap: 6px">' + sbadge('ic.chip') + '<sc-if value="{{ic.contacted}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">Contacted</span></sc-if></div>'
        '<div style="display: flex; flex-direction: column"><p class="mm-big" style="margin: 0">{{itemsTotal}}</p><p class="mm-muted" style="margin: 0; font-size: 13px">{{ic.sub}}</p></div>'
        '<sc-if value="{{isOpen}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" style="width: 100%" onClick="{{create}}">' + svg(ICONS['plus']) + 'Create order</button></sc-if></section>',
        INC_BANNERS, shopper, items, note, steps, '</main>', ''])
    ph += pdrawer('moreOpen', 'closeAll', 'mm-more-title', '{{ic.name}}', '', '\n'.join([
        '<div role="menu" aria-labelledby="mm-more-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<sc-if value="{{notContacted}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{contact}}">' + svg(ICONS['check'], 18) + 'Mark as contacted</button><div role="separator" class="mm-sep"></div></sc-if>',
        '<button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{askDismiss}}">' + svg(ICONS['x'], 18) + 'Dismiss</button>',
        '</div>']), '', tall=False)
    ph += '\n' + phalert('confirmOpen', 'Dismiss this checkout?', '<p style="margin: 0">It leaves the call list. Nothing is ordered, and you can put it back later.</p>', 'cancelConfirm', 'doDismiss', 'Dismiss')
    ph += '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    js = oread('incorder.js'); opts = js_starts(js)
    owrite('IncompleteOrder', 'incomplete', [('Orders', 'Orders.dc.html'), ('Incomplete orders', 'Incomplete.dc.html'), ('{{ic.name}}', '')], 'Incomplete order', d, ph, js, opts, opts[0])


# ======================================================================
# Courier returns
# ======================================================================
def recv_body(phone):
    sz = 18 if phone else 14
    step = ('<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px"><span class="mm-muted" style="font-size: 12px">Damaged</span><div class="mm-step"><button type="button" aria-label="One less damaged" disabled="{{rl.decDis}}" onClick="{{rl.dec}}">' + svg(ICONS['minus'], sz) + '</button>'
            '<input readOnly aria-label="{{rl.aria}}" value="{{rl.bad}}"><button type="button" aria-label="One more damaged" disabled="{{rl.incDis}}" onClick="{{rl.inc}}">' + svg(ICONS['plus'], sz) + '</button></div></div>')
    top = '10px' if phone else '8px'
    return '\n'.join([
        '<p class="mm-muted" style="margin: 0">Check the parcel. Count anything that came back damaged: the rest goes back on the shelf.</p>',
        '<ul class="mm-mlist" aria-label="Items in the parcel"><sc-for list="{{rv.lines}}" as="rl" hint-placeholder-count="1"><li style="flex-direction: row; align-items: center; gap: 12px"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{rl.qty}} {{rl.title}}</span><span class="mm-muted" style="font-size: 12px">{{rl.opts}}</span><span style="font-size: 12px; font-weight: 500; color: {{rl.statusColor}}">{{rl.status}}</span></span>' + step + '</li></sc-for></ul>',
        '<div class="mm-field"><label class="mm-label" for="mm-rv-cost">Return cost</label><label class="mm-affix"><span aria-hidden="true" style="top: %s">৳</span><input id="mm-rv-cost" class="mm-input" inputMode="decimal" value="{{rv.cost}}" onChange="{{rv.onCost}}" style="font-variant-numeric: tabular-nums"></label><p class="mm-hint">What the courier charges for bringing it back. It’s recorded as an expense.</p></div>' % top,
        '<div class="mm-note" style="font-size: 13px">' + svg(ICONS['package']) + '<p style="margin: 0">{{rv.summary}}</p></div>'])

def creturns():
    d = otop('Courier returns', '', 'creturns') + '\n'.join([
        ttabs(count=2),
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">' + search('Search order, name or consignment', width=320) + RESET + '<span class="mm-muted" style="margin-left: auto; font-size: 13px">{{summary}}</span></div>',
        '<div style="border: 1px solid var(--border); border-radius: 10px">',
        '<div class="mm-crgrid mm-thead" aria-hidden="true"><span>Order</span><span>Customer</span><span>Courier</span><span>Why it came back</span><span>Since</span><span>Status</span><span></span></div>',
        OUL % 'Courier returns',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="3"><li><div class="mm-crgrid mm-row" style="min-height: 60px; padding-right: 16px">',
        '<a href="Order.dc.html" class="mm-rowlink mm-mono">{{r.n}}</a>',
        '<span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{r.name}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{r.items}} · {{r.value}}</span></span>',
        '<span style="display: flex; flex-direction: column; min-width: 0"><span>{{r.courier}}</span><span class="mm-trunc mm-mono mm-muted" style="font-size: 12px">{{r.cons}}</span></span>',
        '<span class="mm-trunc">{{r.reason}}</span>',
        '<span class="mm-muted" style="font-size: 13px; font-variant-numeric: tabular-nums">{{r.since}}</span>',
        '<span style="display: flex; min-width: 0">' + sbadge('r.chip').replace('class="mm-sbadge"', 'class="mm-sbadge mm-trunc"') + '</span>',
        '<span style="display: flex; justify-content: flex-end"><sc-if value="{{r.open}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" aria-label="{{r.aria}}" aria-haspopup="dialog" onClick="{{r.receive}}" style="height: 32px; position: relative; z-index: 2">' + svg(ICONS['check']) + 'Received</button></sc-if><sc-if value="{{r.done}}" hint-placeholder-val="{{false}}"><span class="mm-muted" style="font-size: 13px">{{r.cost}}</span></sc-if></span>',
        '</div></li></sc-for>', '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Clear search', 'emptyCanReset', 'emptyReset') + '</sc-if>',
        '</div>',
        '<p class="mm-muted" style="margin: 0; font-size: 13px">Parcels a courier couldn’t deliver. Stock comes back only when you mark the parcel received.</p>']) + DEND
    rb = dfoot_buttons('closeRecv', 'rv.save', 'Mark received')
    d += dpanel('rv.open', 'closeRecv', 'mm-rv-title', 'Parcel received', '{{rv.sub}}', recv_body(False), '', rb[0], rb[1]) + XEND
    ph = optop('Courier returns', '', 'creturns') + '\n'.join([
        ttabs(count=2, phone=True),
        '<div style="display: flex; gap: 8px">' + search('Order, name or consignment', phone=True) + '</div>',
        '<p class="mm-muted" style="margin: 0; font-size: 13px">{{summary}}</p>',
        '<ul class="mm-plist" aria-label="Courier returns">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="3"><li><div class="mm-prow" style="flex-direction: column; align-items: stretch; gap: 8px; padding: 12px">',
        '<div style="display: flex; align-items: center; gap: 8px"><a href="OrderPhone.dc.html" class="mm-mono" style="font-weight: 600; color: var(--foreground)">{{r.n}}</a><span class="mm-trunc" style="flex: 1">{{r.name}}</span>' + sbadge('r.chip') + '</div>',
        '<span class="mm-muted" style="font-size: 13px">{{r.items}} · {{r.reason}}</span><span class="mm-muted" style="font-size: 12px">{{r.meta}} · {{r.since}}</span>',
        '<sc-if value="{{r.open}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" aria-label="{{r.aria}}" aria-haspopup="dialog" onClick="{{r.receive}}">' + svg(ICONS['check']) + 'Received</button></sc-if>',
        '</div></li></sc-for>', '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Clear search', 'emptyCanReset', 'emptyReset', pad='32px 16px') + '</sc-if>']) + PEND
    ph += pdrawer('rv.open', 'closeRecv', 'mm-rv-title', 'Parcel received', '{{rv.sub}}', pbody(recv_body(True)), pfoot('closeRecv', 'rv.save', 'Mark received')) + PXEND
    js = oread('creturns.js'); opts = js_starts(js)
    owrite('CourierReturns', 'creturns', [('Orders', 'Orders.dc.html'), ('Courier returns', '')], 'Courier returns', d, ph, js, opts, opts[0])


# ======================================================================
# Returns
# ======================================================================
def returns():
    menu = dmenu('r.menuOpen', 'r.toggleMenu', 'r.menuAria', [('link', 'Open', 'Return.dc.html', 'file'), ('Approve', 'r.approve', 'check', 'r.isRequested'), ('Mark received', 'r.receive', 'package', 'r.canReceive'), ('Reject', 'r.reject', 'ban', 'r.isRequested')], width=190)
    menu = menu.replace('class="mm-cmd-item" onClick="{{r.reject}}">', 'class="mm-cmd-item mm-danger" onClick="{{r.reject}}">')
    d = otop('Returns', '', 'returns') + '\n'.join([
        ttabs(count=5),
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">' + search('Search return, order or name') + dfilter('rf', 'Reason', list_pop('rf', 'Reason', 'Nothing found.'), 230) + RESET + '<span class="mm-muted" style="margin-left: auto; font-size: 13px">{{summary}}</span></div>',
        '<div style="border: 1px solid var(--border); border-radius: 10px">',
        '<div class="mm-rtgrid mm-thead" aria-hidden="true"><span>Return</span><span>Order</span><span>Customer</span><span>Items</span><span>Status</span><span>Asked on</span><span class="mm-num">Value</span><span></span></div>',
        OUL % 'Returns',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="6"><li><div class="mm-rtgrid mm-row" style="min-height: 56px">',
        '<a href="Return.dc.html" class="mm-rowlink mm-mono" aria-label="{{r.aria}}">{{r.ref}}</a>',
        '<a href="Order.dc.html" class="mm-mono" style="position: relative; z-index: 2; color: var(--muted-foreground)">{{r.order}}</a>',
        '<span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{r.name}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{r.wants}}</span></span>',
        '<span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc">{{r.items}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{r.reason}}</span></span>',
        '<span>' + sbadge('r.chip') + '</span>',
        '<span class="mm-muted" style="font-variant-numeric: tabular-nums">{{r.at}}</span>',
        '<span class="mm-num" style="font-weight: 500">{{r.value}}</span>',
        menu,
        '</div></li></sc-for>', '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Reset filters') + '</sc-if>',
        '</div>']) + DEND + XEND
    ph = optop('Returns', '', 'returns') + '\n'.join([
        ttabs(count=5, phone=True),
        '<div style="display: flex; gap: 8px">' + search('Return, order or name', phone=True) + '</div>',
        '<ul class="mm-plist" aria-label="Returns">',
        '<sc-for list="{{rows}}" as="r" hint-placeholder-count="6"><li><div class="mm-prow" style="align-items: flex-start; gap: 10px; padding: 12px 4px 12px 12px">',
        '<a href="ReturnPhone.dc.html" class="mm-rowlink" aria-label="{{r.aria}}" style="display: flex; flex-direction: column; gap: 3px"><span style="display: flex; align-items: center; gap: 8px"><span class="mm-mono" style="font-weight: 600">{{r.ref}}</span>' + sbadge('r.chip') + '</span><span class="mm-trunc" style="font-weight: 400">{{r.items}} · {{r.reason}}</span><span class="mm-muted" style="font-size: 12px; font-weight: 400">{{r.meta}} · {{r.at}}</span></a>',
        '<span style="flex: none; font-weight: 600; font-variant-numeric: tabular-nums">{{r.value}}</span>',
        '<button type="button" class="mm-btn mm-ghost mm-icon mm-above" aria-label="{{r.menuAria}}" aria-haspopup="dialog" onClick="{{r.toggleMenu}}" style="margin-top: -6px">' + svg(ICONS['dots'], 18) + '</button>',
        '</div></li></sc-for>', '</ul>',
        '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}">' + empty_block('{{emptyText}}', 'Reset filters', pad='32px 16px') + '</sc-if>']) + PEND
    ph += pdrawer('menuOpen', 'closeAll', 'mm-mx-title', 'Return {{mx.ref}}', '{{mx.meta}}', '\n'.join([
        '<div role="menu" aria-labelledby="mm-mx-title" style="display: flex; flex-direction: column; padding: 4px 8px 24px">',
        '<a href="ReturnPhone.dc.html" role="menuitem" class="mm-optrow">' + svg(ICONS['file'], 18) + 'Open</a>',
        '<sc-if value="{{mx.isRequested}}" hint-placeholder-val="{{true}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.approve}}">' + svg(ICONS['check'], 18) + 'Approve</button></sc-if>',
        '<sc-if value="{{mx.canReceive}}" hint-placeholder-val="{{false}}"><button type="button" role="menuitem" class="mm-optrow" onClick="{{mx.receive}}">' + svg(ICONS['package'], 18) + 'Mark received</button></sc-if>',
        '<sc-if value="{{mx.isRequested}}" hint-placeholder-val="{{true}}"><div role="separator" class="mm-sep"></div><button type="button" role="menuitem" class="mm-optrow mm-danger" onClick="{{mx.reject}}">' + svg(ICONS['ban'], 18) + 'Reject</button></sc-if>',
        '</div>']), '', tall=False) + PXEND
    js = oread('returns.js'); opts = js_starts(js)
    owrite('Returns', 'returns', [('Orders', 'Orders.dc.html'), ('Returns', '')], 'Returns', d, ph, js, opts, opts[0])

def ret_actions(phone):
    w = '; flex: 1' if phone else ''
    b = lambda cond, h, lab, primary=False, icon=None, dialog=False: '<sc-if value="{{%s}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn %s" style="%s"%s onClick="{{%s}}">%s%s</button></sc-if>' % (cond, 'mm-primary' if primary else 'mm-outline', w.lstrip('; '), ' aria-haspopup="dialog"' if dialog else '', h, svg(ICONS[icon]) if icon else '', lab)
    return ''.join([
        b('isRequested', 'openReject', 'Reject', dialog=True), b('isRequested', 'approve', 'Approve', True, 'check'),
        b('isApproved', 'onTheWay', 'On its way back', icon='truck'), b('canReceive', 'receive', 'Mark received', True, 'package'),
        b('isReceived', 'openInspect', 'Inspect', True, 'search', True),
        b('isInspected', 'closeNoRefund', 'Close without refund'), b('isInspected', 'exchange', 'Exchange', icon='refresh'), b('isInspected', 'openRefund', 'Refund', True, 'wallet', True)])

def ret_cards(phone):
    flow = ('<sc-if value="{{showFlow}}" hint-placeholder-val="{{true}}"><ol class="mm-steps" aria-label="Progress"%s><sc-for list="{{flow}}" as="fw" hint-placeholder-count="6"><li data-s="{{fw.s}}"><span class="mm-sdot">{{fw.mark}}</span>%s</li></sc-for></ol></sc-if>'
            % (' style="overflow: hidden"' if phone else '', '' if phone else '<span class="mm-trunc">{{fw.label}}</span>'))
    banners = ('<sc-if value="{{rt.hasOutcome}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['info']) + '<p style="margin: 0">{{rt.outcome}}</p></div></sc-if>'
               '<sc-if value="{{hasStockNote}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['package']) + '<p style="margin: 0">{{stockNote}}</p></div></sc-if>')
    items = ('<section class="mm-card" aria-labelledby="mm-c-ri" style="gap: 10px">' + chead('mm-c-ri', 'Items')
             + '<ul class="mm-mlist"><sc-for list="{{lines}}" as="rl" hint-placeholder-count="1"><li style="flex-direction: row; align-items: center; gap: 12px"><span class="mm-thumb2">' + svg(ICONS['box'], 18) + '</span>'
             + '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{rl.qty}} {{rl.title}}</span><span class="mm-trunc mm-muted" style="font-size: 12px">{{rl.opts}}</span><span style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px"><span class="mm-badge-sec">{{rl.reason}}</span><sc-if value="{{rl.insp}}" hint-placeholder-val="{{false}}"><span style="font-size: 12px; font-weight: 500; color: {{rl.inspColor}}">{{rl.inspText}}</span></sc-if></span></span>'
             + '<span style="font-weight: 500; font-variant-numeric: tabular-nums">{{rl.value}}</span></li></sc-for></ul>'
             + '<sc-if value="{{rt.hasNote}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid var(--border)"><span class="mm-label">What the customer said</span><blockquote style="margin: 0; padding-left: 12px; border-left: 2px solid var(--border)">{{rt.note}}</blockquote>'
             + '<sc-if value="{{rt.hasPhotos}}" hint-placeholder-val="{{false}}"><div style="display: flex; gap: 8px; margin-top: 4px"><sc-for list="{{rt.photoList}}" as="pp" hint-placeholder-count="2"><span role="img" aria-label="{{pp.aria}}" class="mm-thumb2" style="width: 56px; height: 56px">' + svg(ICONS['camera'], 18) + '</span></sc-for></div></sc-if></div></sc-if></section>')
    cust = ('<section class="mm-card" aria-labelledby="mm-c-rc" style="gap: 12px">' + chead('mm-c-rc', 'Customer')
            + '<div style="display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 500">{{rt.name}}</span><span class="mm-muted" style="font-size: 13px; font-variant-numeric: tabular-nums">{{rt.phone}} · order <a href="%s" class="mm-mono" style="color: var(--foreground)">{{rt.order}}</a></span></div>' % ('OrderPhone.dc.html' if phone else 'Order.dc.html')
            + '<a href="{{rt.tel}}" class="mm-btn mm-outline" style="%s">' % ('' if phone else 'height: 32px') + svg(ICONS['phone']) + 'Call</a>'
            + '<div style="display: flex; flex-direction: column; gap: 4px; padding-top: 12px; border-top: 1px solid var(--border)"><span class="mm-label">They asked for</span><span>{{rt.wants}}</span><span class="mm-muted" style="font-size: 13px">Items worth {{rt.value}}</span></div></section>')
    hist = ('<section class="mm-card" aria-labelledby="mm-c-rh" style="gap: 12px">' + chead('mm-c-rh', 'History')
            + '<ol class="mm-tl"><sc-for list="{{history}}" as="hs" hint-placeholder-count="3"><li><span class="mm-tldot" aria-hidden="true"></span><span style="flex: 1; display: flex; flex-direction: column; gap: 2px"><span>{{hs.text}}</span><span class="mm-muted" style="font-size: 12px">{{hs.when}}</span></span></li></sc-for></ol></section>')
    return flow, banners, items, cust, hist

def inspect_body(phone):
    sz = 18 if phone else 14
    return ('<p class="mm-muted" style="margin: 0">Count anything damaged. Good items go back in stock; damaged ones are written off.</p>'
            '<ul class="mm-mlist"><sc-for list="{{ip.lines}}" as="il" hint-placeholder-count="1"><li style="flex-direction: row; align-items: center; gap: 12px"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{il.title}}</span><span class="mm-muted" style="font-size: 12px">{{il.opts}}</span><span style="font-size: 12px; font-weight: 500; color: {{il.statusColor}}">{{il.status}}</span></span>'
            '<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px"><span class="mm-muted" style="font-size: 12px">Damaged</span><div class="mm-step"><button type="button" aria-label="One less damaged" disabled="{{il.decDis}}" onClick="{{il.dec}}">' + svg(ICONS['minus'], sz) + '</button><input readOnly aria-label="{{il.aria}}" value="{{il.bad}}"><button type="button" aria-label="One more damaged" disabled="{{il.incDis}}" onClick="{{il.inc}}">' + svg(ICONS['plus'], sz) + '</button></div></div></li></sc-for></ul>')

def refund_body(phone):
    top = '10px' if phone else '8px'
    return '\n'.join([
        '<div class="mm-field"><span class="mm-label" id="mm-l-rfm">Refund by</span><div role="radiogroup" aria-labelledby="mm-l-rfm" class="mm-paygrid"><sc-for list="{{rf.methods}}" as="rm" hint-placeholder-count="5"><button type="button" role="radio" class="mm-paybtn" aria-checked="{{rm.on}}" onClick="{{rm.pick}}">{{rm.label}}</button></sc-for></div></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-rf-a">Amount</label><label class="mm-affix"><span aria-hidden="true" style="top: %s">৳</span><input id="mm-rf-a" class="mm-input" inputMode="decimal" aria-invalid="{{rf.amtAria}}" value="{{rf.amount}}" onChange="{{rf.onAmount}}" style="font-variant-numeric: tabular-nums"></label><sc-if value="{{rf.amtBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter the amount to refund.</p></sc-if><p class="mm-hint">{{rf.hint}}</p></div>' % top,
        '<div class="mm-field"><label class="mm-label" for="mm-rf-r">Reason</label><input id="mm-rf-r" class="mm-input" maxLength="200" value="{{rf.reason}}" onChange="{{rf.onReason}}"></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-rf-t">' + opt('Transaction ID') + '</label><input id="mm-rf-t" class="mm-input" maxLength="100" value="{{rf.trx}}" onChange="{{rf.onTrx}}" placeholder="From the bKash or bank receipt"></div>'])

def reject_body():
    return ('<div class="mm-field"><label class="mm-label" for="mm-rj-t">Tell the customer why</label><textarea id="mm-rj-t" class="mm-textarea" maxLength="500" aria-invalid="{{rj.aria}}" value="{{rj.text}}" onChange="{{rj.onText}}" placeholder="Returns are open for 7 days after delivery."></textarea>'
            '<sc-if value="{{rj.bad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Add a reason. They get it by SMS.</p></sc-if></div>')

def ret():
    flow, banners, items, cust, hist = ret_cards(False)
    head = '\n'.join([
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">',
        '<a href="Returns.dc.html" class="mm-btn mm-ghost mm-icon" aria-label="Back to returns" style="margin-left: -8px">' + svg(ICONS['back']) + '</a>',
        '<h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">{{rt.title}}</h1>' + sbadge('rt.chip'),
        '<span style="flex: 1"></span>', ret_actions(False), '</div>',
        '<p class="mm-muted" style="margin: -8px 0 0">{{rt.sub}}</p>'])
    d = '\n'.join([MAIN, head, flow, banners,
        '<div class="mm-cols"><div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">', items, '</div>',
        '<div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">', cust, hist, '</div></div>']) + DEND
    ib = dfoot_buttons('closeInspect', 'ip.save', 'Save inspection')
    d += dpanel('ip.open', 'closeInspect', 'mm-ip-title', 'Inspect the return', '{{rt.title}}', inspect_body(False), '', ib[0], ib[1])
    rb = dfoot_buttons('closeRefund', 'rf.save', 'Refund')
    d += '\n' + dpanel('rf.open', 'closeRefund', 'mm-rf-title', 'Refund', '{{rf.sub}}', refund_body(False), '', rb[0], rb[1])
    d += '\n' + ddialog('rj.open', 'mm-rj-title', 'Reject {{rt.title}}?', reject_body(), 'closeReject', 'rj.save', 'Reject', danger=True, width=460, cancel_label='Keep it')
    d += XEND
    flow, banners, items, cust, hist = ret_cards(True)
    ph = '\n'.join([PROOT % 'var(--page)', phone_back('ReturnsPhone.dc.html', 'Back to returns', '{{rt.title}}'),
        '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
        '<section class="mm-card" style="gap: 12px"><div style="display: flex; align-items: center; gap: 8px">' + sbadge('rt.chip') + '<span class="mm-muted" style="font-size: 12px">{{rt.sub}}</span></div>' + flow
        + '<div style="display: flex; flex-wrap: wrap; gap: 8px">' + ret_actions(True) + '</div></section>',
        banners, items, cust, hist, '</main>', ''])
    ph += pdrawer('ip.open', 'closeInspect', 'mm-ip-title', 'Inspect the return', '{{rt.title}}', pbody(inspect_body(True)), pfoot('closeInspect', 'ip.save', 'Save inspection'))
    ph += '\n' + pdrawer('rf.open', 'closeRefund', 'mm-rf-title', 'Refund', '{{rf.sub}}', pbody(refund_body(True)), pfoot('closeRefund', 'rf.save', 'Refund'))
    ph += '\n' + pdrawer('rj.open', 'closeReject', 'mm-rj-title', 'Reject {{rt.title}}?', '', pbody(reject_body()), pfoot_danger('closeReject', 'rj.save', 'Reject'), tall=False)
    ph += '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    js = oread('return.js'); opts = js_starts(js)
    owrite('Return', 'returns', [('Orders', 'Orders.dc.html'), ('Returns', 'Returns.dc.html'), ('{{rt.title}}', '')], 'Return', d, ph, js, opts, opts[0])

ALL = {'states': states, 'orders': orders, 'order': order, 'neworder': neworder, 'confirm': confirm, 'incomplete': incomplete, 'incorder': incorder, 'creturns': creturns, 'returns': returns, 'ret': ret}
