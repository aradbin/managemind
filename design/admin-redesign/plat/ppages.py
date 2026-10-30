from pbuild import *
from pages import dfilter, list_pop, search, RESET, ttabs, empty_block

NO2FA = ('<sc-if value="{{no2fa}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-direction: column; gap: 12px; max-width: 560px"><div class="mm-note">' + svg(ICONS['shield']) +
         '<p style="margin: 0">The platform area needs two-factor login. Set it up on your account page first.</p></div><a href="@@ACCOUNT@@" class="mm-btn mm-primary" style="align-self: flex-start">Set up now</a></div></sc-if>')

def gate(body, phone):
    return '<sc-if value="{{has2fa}}" hint-placeholder-val="{{true}}">' + body + '</sc-if>' + NO2FA.replace('@@ACCOUNT@@', 'AccountPhone.dc.html' if phone else 'Account.dc.html')

def tile(var, size=32):
    return '<span class="mm-tile" aria-hidden="true" style="width: %dpx; height: %dpx">{{%s}}</span>' % (size, size, var)

def suspend_body():
    return ('<p class="mm-muted" style="margin: 0">Shoppers see a maintenance page and staff can’t change anything until it is reactivated.</p>'
            + radios('mm-l-why', 'Why', 'whys', 'w', 4)
            + text('mm-sd-r', 'Reason', 'reason', optional=True, area=True, p='sf', hint='Kept in the audit log.'))

def stores():
    menu = dmenu('r.menuOpen', 'r.toggleMenu', 'r.menuAria', [('link', 'Open', '{{r.href}}', 'file'), ('link', 'Invoices', '{{r.invoices}}', 'receipt'), ('Reactivate', 'r.reactivate', 'play', 'r.canReactivate'),
                 ('Suspend store', 'r.suspend', 'pause', 'r.canSuspend')], width=190)
    menu = menu.replace('class="mm-cmd-item" onClick="{{r.suspend}}"', 'class="mm-cmd-item mm-danger" onClick="{{r.suspend}}"')
    cols = 'minmax(0, 1.7fr) 104px minmax(0, 1fr) 150px 112px 36px'
    cells = ('<span style="display: flex; align-items: center; gap: 10px; min-width: 0">' + tile('r.tile') + '<span style="display: flex; flex-direction: column; min-width: 0"><a href="{{r.href}}" class="mm-rowlink" aria-label="{{r.aria}}">{{r.name}}</a>'
             '<span class="mm-trunc mm-muted" style="font-size: 13px">{{r.slug}}</span></span></span>'
             '<span>' + sbadge('r.chip') + '</span>'
             '<span style="display: flex; align-items: center; gap: 6px; min-width: 0">{{r.plan}}<sc-if value="{{r.notClient}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">{{r.kind}}</span></sc-if></span>'
             '<span style="display: flex; flex-direction: column; gap: 4px"><span style="font-size: 13px; font-variant-numeric: tabular-nums">{{r.setup}}</span><sc-if value="{{r.checked}}" hint-placeholder-val="{{true}}"><span class="mm-meter" aria-hidden="true" style="width: 96px; height: 4px"><span style="display: block; height: 100%; width: {{r.setupPct}}; background: {{r.setupColor}}"></span></span></sc-if></span>'
             '<span class="mm-muted" style="font-size: 13px">{{r.created}}</span>' + menu)
    bar_d = ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">' + search('Search by name or address', width=280)
             + dfilter('kf', 'Kind', list_pop('kf', 'Kind', 'Nothing found.'), 200) + dfilter('pf', 'Plan', list_pop('pf', 'Plan', 'Nothing found.'), 200) + RESET
             + '<span class="mm-muted" style="margin-left: auto; font-size: 13px">{{count}}</span></div>')
    empty = '<sc-if value="{{noRows}}" hint-placeholder-val="{{false}}">' + empty_block('No stores match.', 'Clear filters') + '</sc-if>'
    body_d = gate('\n'.join([ttabs(count=6), bar_d, '<sc-if value="{{hasRows}}" hint-placeholder-val="{{true}}">' + table(cols, ['Store', 'Status', 'Plan', 'Setup', 'Created', ''], 'rows', 'r', cells, 10, 'Stores') + '</sc-if>', empty]), False)
    pcells = (tile('r.tile', 36) + '<a href="{{r.href}}" class="mm-rowlink" aria-label="{{r.aria}}" style="display: flex; flex-direction: column"><span class="mm-trunc">{{r.name}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; font-weight: 400">{{r.plan}} · Setup {{r.setup}}</span></a>' + sbadge('r.chip'))
    bar_p = ('<div style="display: flex; gap: 8px">' + search('Search by name or address', phone=True)
             + '<sc-if value="{{canCreate}}" hint-placeholder-val="{{true}}"><a href="NewStorePhone.dc.html" class="mm-btn mm-primary mm-icon" aria-label="New store" style="width: 40px; height: 40px">' + svg(ICONS['plus']) + '</a></sc-if></div>'
             '<div style="display: flex; flex-wrap: wrap; gap: 8px">' + dfilter('kf', 'Kind', list_pop('kf', 'Kind', 'Nothing found.'), 200) + dfilter('pf', 'Plan', list_pop('pf', 'Plan', 'Nothing found.'), 200) + RESET + '</div>')
    body_p = gate('\n'.join([ttabs(count=6, phone=True), bar_p, '<sc-if value="{{hasRows}}" hint-placeholder-val="{{true}}">' + plist('rows', 'r', pcells, 10, 'Stores') + '</sc-if>', empty]), True)
    acts = '<sc-if value="{{canCreate}}" hint-placeholder-val="{{true}}"><sc-if value="{{has2fa}}" hint-placeholder-val="{{true}}"><a href="NewStore.dc.html" class="mm-btn mm-primary">' + svg(ICONS['plus']) + 'New store</a></sc-if></sc-if>'
    ex = [dialog('sd.open', 'mm-sd-t', '{{sd.title}}', suspend_body(), 'closeAll', 'sd.confirm', 'Suspend store', phone=ph, danger=True) for ph in (False, True)]
    ppage('PlatformStores', 'stores', 'Stores', '', body_d, body_p, js=pread('stores.js'), extra_d='\n' + ex[0], extra_p='\n' + ex[1], actions=acts, crumbs=[('Platform', 'PlatformStores.dc.html'), ('Stores', '')])

ALL = {'stores': stores}

def kvlist(lst, var, count=6):
    return '<div style="display: flex; flex-direction: column; gap: 10px"><sc-for list="{{%s}}" as="%s" hint-placeholder-count="%d"><div class="mm-kv" style="font-size: 14px"><span class="mm-muted">{{%s.k}}</span><span style="text-align: right">{{%s.v}}</span></div></sc-for></div>' % (lst, var, count, var, var)

def chk(var):
    return ('<span class="mm-chk" data-done="{{%s.done}}" aria-hidden="true"><sc-if value="{{%s.done}}" hint-placeholder-val="{{true}}">' % (var, var) + svg(ICONS['check'], 12).replace('stroke-width="2"', 'stroke-width="3"') + '</sc-if></span><span class="mm-sr">{{%s.state}}: </span>' % var)

def code_field(id_, hint):
    return text(id_, 'Code from your authenticator app', 'code', p='lf', mode='numeric', ph='000000', hint=hint, invalid='codeBad', err=('codeBad', 'Enter the 6-digit code.')).replace('class="mm-input"', 'class="mm-input mm-code6" maxLength="6" autoComplete="one-time-code"', 1)

def typed_field(id_):
    return text(id_, 'Store address', 'typed', p='lf', hint='{{typeHint}}', invalid='typedBad', err=('typedBad', 'That isn’t the store’s address.')).replace('class="mm-input"', 'class="mm-input mm-mono" autoComplete="off"', 1)

def store_page():
    btn_sup = '<button type="button" class="mm-btn mm-outline" aria-haspopup="dialog" onClick="{{openSupport}}">' + svg(ICONS['login']) + 'Support access</button>'
    acts = (btn_sup
            + '<sc-if value="{{canReactivate}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" onClick="{{reactivate}}">' + svg(ICONS['play']) + 'Reactivate</button></sc-if>'
            + '<sc-if value="{{canReopen}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline" onClick="{{reopen}}">Reopen store</button></sc-if>'
            + '<sc-if value="{{canSuspend}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline mm-danger" aria-haspopup="dialog" onClick="{{askSuspend}}">' + svg(ICONS['pause']) + 'Suspend store</button></sc-if>'
            + '<sc-if value="{{canClose}}" hint-placeholder-val="{{true}}">' + dmenu('menuOpen', 'toggleMenu', 'menuAria', [('Close store', 'askClose', 'ban', True)], width=170, ghost=False) + '</sc-if>')
    acts_p = ('<div style="display: flex; flex-wrap: wrap; gap: 8px">' + btn_sup.replace('class="mm-btn mm-outline"', 'class="mm-btn mm-outline" style="flex: 1"')
              + '<sc-if value="{{canReactivate}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" style="flex: 1" onClick="{{reactivate}}">Reactivate</button></sc-if>'
              + '<sc-if value="{{canReopen}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline" style="flex: 1" onClick="{{reopen}}">Reopen store</button></sc-if>'
              + '<sc-if value="{{canClose}}" hint-placeholder-val="{{true}}">' + dmenu('menuOpen', 'toggleMenu', 'menuAria', [('Suspend store', 'askSuspend', 'pause', 'canSuspend'), ('Close store', 'askClose', 'ban', True)], width=190, ghost=False) + '</sc-if></div>')
    acts_p = acts_p.replace('class="mm-cmd-item" onClick="{{askSuspend}}"', 'class="mm-cmd-item mm-danger" onClick="{{askSuspend}}"')
    extra = ('<span aria-hidden="true"></span>' + sbadge('chip') + '<span class="mm-badge-sec">{{kind}}</span><span class="mm-badge-sec">{{planName}}</span>')
    note = ('<sc-if value="{{isSuspended}}" hint-placeholder-val="{{false}}"><div class="mm-banner" role="note">' + svg(ICONS['alert']) + '<p style="margin: 0">{{statusNote}}</p></div></sc-if>'
            '<sc-if value="{{isClosed}}" hint-placeholder-val="{{false}}"><div class="mm-note" role="note">' + svg(ICONS['ban']) + '<p style="margin: 0">{{statusNote}}</p></div></sc-if>')
    setup = card('mm-c-su', 'Setup checklist', '<sc-if value="{{setup.never}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">Not checked yet. Check now to see what the store still needs.</p></sc-if>'
                 '<sc-if value="{{setup.checked}}" hint-placeholder-val="{{true}}"><span class="mm-meter" aria-hidden="true"><span style="display: block; height: 100%; width: {{setup.pct}}; background: var(--primary)"></span></span>'
                 '<ul class="mm-two-list" style="list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px"><sc-for list="{{setup.items}}" as="si" hint-placeholder-count="10"><li style="display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 18px">' + chk('si')
                 + '<span style="color: var(--foreground)">{{si.label}}<sc-if value="{{si.optional}}" hint-placeholder-val="{{false}}"><span class="mm-muted"> (optional)</span></sc-if></span></li></sc-for></ul></sc-if>',
                 sub='<sc-if value="{{setup.checked}}" hint-placeholder-val="{{true}}">{{setup.progress}} · {{setup.checkedAt}}</sc-if>',
                 right='<button type="button" class="mm-btn mm-ghost" style="height: 30px; padding: 0 8px; margin: -4px -8px 0 0" onClick="{{setup.refresh}}">' + svg(ICONS['refresh'], 14) + 'Check again</button>', gap='12px')
    plan = card('mm-c-pl', 'Plan', '<sc-if value="{{sub2.none}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">No plan: everything is allowed and nothing is billed.</p></sc-if>'
                '<sc-if value="{{sub2.has}}" hint-placeholder-val="{{true}}">' + kvlist('sub2.rows', 'pr', 4) + '</sc-if>'
                '<sc-if value="{{sub2.holding}}" hint-placeholder-val="{{false}}"><div class="mm-note" style="align-items: center">' + svg(ICONS['clock']) + '<p style="margin: 0; flex: 1">{{sub2.holdText}}</p><button type="button" class="mm-btn mm-outline" style="height: 30px; background: var(--background)" onClick="{{sub2.endHold}}">End the hold</button></div></sc-if>'
                '<div style="display: flex; flex-wrap: wrap; gap: 8px"><sc-if value="{{canPlan}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" aria-haspopup="dialog" onClick="{{changePlan}}">Change plan</button><button type="button" class="mm-btn mm-outline" aria-haspopup="dialog" onClick="{{holdIt}}">Hold reminders</button></sc-if>'
                '<a href="{{sub2.invoices}}" class="mm-btn mm-ghost">Invoices' + svg(ICONS['right']) + '</a></div>',
                right='<sc-if value="{{sub2.has}}" hint-placeholder-val="{{true}}">' + sbadge('sub2.chip') + '</sc-if>', gap='14px')
    jobs = card('mm-c-jb', 'Exports and jobs', '<sc-if value="{{hasJobs}}" hint-placeholder-val="{{true}}"><ul style="list-style: none; margin: 0 -20px; padding: 0"><sc-for list="{{jobs}}" as="j" hint-placeholder-count="3"><li style="display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 20px; border-top: 1px solid var(--border)">'
                '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span style="font-weight: 500">{{j.kind}} <span class="mm-muted" style="font-weight: 400; font-size: 13px">· {{j.when}}</span></span><sc-if value="{{j.hasNote}}" hint-placeholder-val="{{true}}"><span class="mm-muted" style="font-size: 13px">{{j.note}}</span></sc-if></span>'
                + sbadge('j.chip') + '<sc-if value="{{j.link}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline" style="height: 30px" onClick="{{j.download}}">' + svg(ICONS['download'], 14) + 'Download</button></sc-if></li></sc-for></ul></sc-if>'
                '<sc-if value="{{canJobs}}" hint-placeholder-val="{{true}}"><div style="display: flex; flex-wrap: wrap; gap: 8px"><button type="button" class="mm-btn mm-outline" onClick="{{exportNow}}">' + svg(ICONS['download']) + 'Export now</button><button type="button" class="mm-btn mm-outline" onClick="{{rebuild}}">' + svg(ICONS['refresh']) + 'Rebuild reports</button>'
                '<sc-if value="{{canReset}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline mm-danger" aria-haspopup="dialog" onClick="{{askReset}}">Reset the store</button></sc-if></div></sc-if>', gap='12px')
    purge = ('<sc-if value="{{showPurge}}" hint-placeholder-val="{{false}}">' + card('mm-c-pu', 'Purge',
             '<p class="mm-muted" style="margin: 0">Deletes every product, order, customer, file and setting of this closed store for good. Its record, invoices, payments and audit log stay.</p>'
             '<sc-if value="{{purge.canCount}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" style="align-self: flex-start" onClick="{{purge.start}}">Count what would be deleted</button></sc-if>'
             '<sc-if value="{{purge.counted}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 10px"><h3 style="margin: 0; font-size: 14px; font-weight: 600">What the purge deletes</h3>' + kvlist('purge.rows', 'pg', 6)
             + '<button type="button" class="mm-btn mm-ghost" style="align-self: flex-start; height: 30px; padding: 0 8px; margin-left: -8px" aria-expanded="{{purge.aria}}" onClick="{{purge.toggle}}">Rows by table' + svg(ICONS['down'], 14) + '</button>'
             '<sc-if value="{{purge.open}}" hint-placeholder-val="{{false}}">' + kvlist('purge.tables', 'pt', 8).replace('<span class="mm-muted">{{pt.k}}</span>', '<span class="mm-muted mm-mono" style="font-size: 13px">{{pt.k}}</span>') + '</sc-if></div>'
             '<sc-if value="{{purge.canPurge}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn" style="align-self: flex-start; background: var(--destructive); color: #fff" aria-haspopup="dialog" onClick="{{purge.ask}}">' + svg(ICONS['trash']) + 'Purge the store</button></sc-if></sc-if>', gap='12px') + '</sc-if>')
    details = card('mm-c-dt', 'Details', kvlist('details', 'd', 8), gap='14px')
    owners = card('mm-c-ow', 'Owners', '<ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px"><sc-for list="{{owners}}" as="ow" hint-placeholder-count="1"><li style="display: flex; align-items: center; gap: 10px">' + tile('ow.tile')
                  + '<span style="display: flex; flex-direction: column; min-width: 0"><span style="font-weight: 500">{{ow.name}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{ow.email}}</span></span></li></sc-for></ul>', gap='12px')
    doms = card('mm-c-dm', 'Web addresses', '<ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px"><sc-for list="{{domains}}" as="dm" hint-placeholder-count="2"><li style="display: flex; align-items: center; justify-content: space-between; gap: 10px"><span class="mm-trunc mm-mono" style="font-size: 13px">{{dm.host}}</span>'
                 '<sc-if value="{{dm.main}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">Main</span></sc-if></li></sc-for></ul>', gap='12px')
    body = note + '<div class="mm-two"><div class="mm-col">' + setup + plan + jobs + purge + '</div><div class="mm-col">' + details + owners + doms + '</div></div>'
    body_p = note + '<div class="mm-two"><div class="mm-col">' + purge + details + setup.replace('repeat(2, minmax(0, 1fr))', 'minmax(0, 1fr)') + plan + jobs + owners + doms + '</div></div>'
    # Panels and dialogs.
    sp = ('<p class="mm-muted" style="margin: 0">Work in this store as support for a limited time. Its owners get an email with your reason.</p>' + radios('mm-l-sr', 'Access', 'spRoles', 'sr', 2)
          + segs('mm-l-sm', 'For how long', 'spMins', 'sm', 5)
          + text('mm-sp-r', 'Reason', 'reason', p='sp', area=True, hint='At least 10 characters. The owners will see it.', invalid='spBad', err=('spBad', 'Write at least 10 characters.')))
    pl = (radios('mm-l-pl', 'Plan', 'plans', 'po', 3) + grid(text('mm-pl-p', 'Monthly price', 'price', optional=True, p='pl', prefix='৳', mode='numeric', hint='{{priceHint}}'), text('mm-pl-f', 'Setup fee', 'fee', optional=True, p='pl', prefix='৳', mode='numeric', hint='{{feeHint}}'))
          + grid(text('mm-pl-d', 'Billing day', 'day', p='pl', mode='numeric', hint='Each month’s invoice is drafted on this day (1–28).'), text('mm-pl-t', 'Free until', 'trial', optional=True, p='pl', typ='date', hint='No plan charge for months that start before this date.')))
    hd = ('<p class="mm-muted" style="margin: 0">No reminder and no suspension until this date, e.g. “paying next week, agreed by phone”.</p>' + text('mm-hd-u', 'Hold until', 'until', p='hd', typ='date')
          + text('mm-hd-w', 'Why', 'why', p='hd', area=True, hint='Kept in the audit log.', invalid='hdBad', err=('hdBad', 'Say why, for the audit log.')))
    sus = ('<p class="mm-muted" style="margin: 0">Shoppers see a maintenance page and staff can’t change anything until it is reactivated.</p>' + radios('mm-l-why', 'Why', 'whys', 'w', 4)
           + text('mm-sd-r', 'Reason', 'reason', optional=True, area=True, p='lf', hint='Kept in the audit log.'))
    clo = ('<p class="mm-muted" style="margin: 0">The store stops selling at once: its pages say it has closed, staff can’t open it, and its custom domains are released. Its data stays until the purge, and it can be reopened before then.</p>'
           + radios('mm-l-cwhy', 'Why', 'whys', 'w', 4) + code_field('mm-cl-c', 'Closing a store needs a fresh code, even though you are signed in.'))
    pur = '<p class="mm-muted" style="margin: 0">Nothing can bring the data back after this. Type the store’s address and enter your code to confirm.</p>' + typed_field('mm-pu-t') + code_field('mm-pu-c', '')
    rst = '<p class="mm-muted" style="margin: 0">Every product, order, customer and file goes, and the store starts again with its defaults; a demo store gets its sample catalog and orders back. Its people and settings stay. Type the store’s address to confirm.</p>' + typed_field('mm-rs-t')
    ex = []
    for ph in (False, True):
        ex.append('\n'.join([panel('pn.support', 'closeAll', 'mm-sp-t', 'Support access', '{{name}}', sp, 'startSupport', 'Start and open the store', phone=ph),
                             panel('pn.plan', 'closeAll', 'mm-pl-t', 'Change plan', '{{name}}', pl, 'savePlan', 'Save', phone=ph),
                             panel('pn.hold', 'closeAll', 'mm-hd-t', 'Hold reminders', '{{name}}', hd, 'saveHold', 'Hold reminders', phone=ph),
                             dialog('dl.suspend', 'mm-ds-t', '{{dl.suspendTitle}}', sus, 'closeAll', 'suspendIt', 'Suspend store', phone=ph, danger=True),
                             dialog('dl.close', 'mm-dc-t', '{{dl.closeTitle}}', clo, 'closeAll', 'closeIt', 'Close store', phone=ph, danger=True),
                             dialog('dl.purge', 'mm-dp-t', '{{dl.purgeTitle}}', pur, 'closeAll', 'purgeIt', 'Purge the store', phone=ph, danger=True),
                             dialog('dl.reset', 'mm-dr-t', '{{dl.resetTitle}}', rst, 'closeAll', 'resetIt', 'Reset the store', phone=ph, danger=True)]))
    ppage('PlatformStore', 'stores', '{{name}}', '{{sub}}', body, body_p, js=pread('store.js'), extra_d='\n' + ex[0], extra_p='\n' + ex[1], actions=acts, actions_p=acts_p, back=('PlatformStores', 'All stores'),
          crumbs=[('Platform', 'PlatformStores.dc.html'), ('Stores', 'PlatformStores.dc.html'), ('{{name}}', '')], title_extra=extra)

ALL['store'] = store_page

def newstore():
    steps = '<ol class="mm-steps" aria-label="Steps"><sc-for list="{{steps}}" as="st" hint-placeholder-count="4"><li data-s="{{st.s}}" aria-current="{{st.cur}}"><span class="mm-sdot" aria-hidden="true">{{st.n}}</span><span class="mm-trunc">{{st.label}}</span></li></sc-for></ol>'
    slug = ('<div class="mm-field"><label class="mm-label" for="mm-ns-s">Store address</label><label class="mm-affix mm-affix-r"><input id="mm-ns-s" class="mm-input" autoComplete="off" aria-invalid="{{slugBad}}" value="{{f.slug.value}}" onChange="{{f.slug.on}}" placeholder="sonarbangla" style="padding-right: 128px"><span aria-hidden="true" style="top: @@AFFIX@@">.managemind.app</span></label>'
            '<sc-if value="{{slugFree}}" hint-placeholder-val="{{false}}"><p class="mm-hint" style="display: flex; align-items: center; gap: 6px; color: var(--success)">' + svg(ICONS['ok'], 14) + '{{slugNote}}</p></sc-if>'
            '<sc-if value="{{slugBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">{{slugNote}}</p></sc-if>'
            '<sc-if value="{{slugMissing}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Choose the store’s address.</p></sc-if>'
            '<p class="mm-hint">3–32 lowercase letters, numbers or hyphens. It becomes part of the store’s web address.</p></div>')
    s0 = ('<sc-if value="{{is0}}" hint-placeholder-val="{{true}}">' + text('mm-ns-n', 'Store name', 'name', invalid='nameBad', err=('nameBad', 'Enter the store’s name.')) + slug
          + segs('mm-l-ln', 'Main language for shoppers and emails', 'langs', 'lg', 2) + radios('mm-l-kd', 'Kind', 'kinds', 'kd', 3, hint='Demo and test stores are never billed and can be reset.') + '</sc-if>')
    s1 = ('<sc-if value="{{is1}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">The owner gets an email with the admin’s address and how to sign in.</p>'
          + text('mm-ns-e', 'Owner’s email', 'email', typ='email', invalid='emailBad', err=('emailBad', 'Enter an email address.')) + text('mm-ns-o', 'Owner’s name', 'owner', invalid='ownerBad', err=('ownerBad', 'Enter the owner’s name.')) + '</sc-if>')
    s2 = ('<sc-if value="{{is2}}" hint-placeholder-val="{{false}}">' + radios('mm-l-np', 'Plan', 'plans', 'np', 4)
          + '<sc-if value="{{hasPlan}}" hint-placeholder-val="{{false}}">' + grid(text('mm-ns-p', 'Monthly price', 'price', optional=True, prefix='৳', mode='numeric', hint='{{priceHint}}'), text('mm-ns-f', 'Setup fee', 'fee', optional=True, prefix='৳', mode='numeric', hint='{{feeHint}}'))
          + grid(text('mm-ns-d', 'Billing day', 'day', mode='numeric', hint='Each month’s invoice is drafted on this day (1–28).'), text('mm-ns-t', 'Free until', 'trial', optional=True, typ='date', hint='No plan charge for months that start before this date.')) + '</sc-if></sc-if>')
    s3 = ('<sc-if value="{{is3}}" hint-placeholder-val="{{false}}">' + radios('mm-l-pr', 'Starting design', 'presets', 'pr', 3, hint='Colors and homepage sections the owner can change later.')
          + '<div style="display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-radius: 10px; background: var(--muted)">' + kvlist('summary', 'sm', 4) + '</div></sc-if>')
    foot = ('<div style="display: flex; align-items: center; gap: 8px; padding-top: 4px"><sc-if value="{{hasBack}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline" onClick="{{back}}">' + svg(ICONS['back']) + 'Back</button></sc-if><span style="flex: 1"></span>'
            '<sc-if value="{{notLast}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" onClick="{{next}}">Next' + svg(ICONS['right']) + '</button></sc-if>'
            '<sc-if value="{{isLast}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" onClick="{{create}}">Create store</button></sc-if></div>')
    form_ = ('<sc-if value="{{notDone}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-labelledby="mm-ns-h" style="gap: 18px">' + steps
             + '<h2 id="mm-ns-h" class="mm-ctitle" aria-live="polite">{{stepOf}}</h2>' + s0 + s1 + s2 + s3 + foot + '</section></sc-if>')
    done = ('<sc-if value="{{done}}" hint-placeholder-val="{{false}}"><section class="mm-card" style="align-items: center; gap: 12px; padding: 40px 24px; text-align: center"><span class="mm-chk" data-done="true" style="width: 40px; height: 40px" aria-hidden="true">' + svg(ICONS['check'], 20).replace('stroke-width="2"', 'stroke-width="3"') + '</span>'
            '<h2 class="mm-ctitle" style="font-size: 18px">{{doneTitle}}</h2><p class="mm-muted" style="margin: 0; max-width: 420px">{{doneText}}</p><div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; padding-top: 4px"><button type="button" class="mm-btn mm-outline" onClick="{{again}}">Create another</button><a href="{{storeHref}}" class="mm-btn mm-primary">Open the store</a></div></section></sc-if>')
    intro = 'Everything a store starts with, in one go. The owner gets an email with the admin’s address.'
    ppage('NewStore', 'stores', 'New store', intro, form_ + done, js=pread('newstore.js'), back=('PlatformStores', 'All stores'), width=640,
          crumbs=[('Platform', 'PlatformStores.dc.html'), ('Stores', 'PlatformStores.dc.html'), ('New store', '')])

ALL['newstore'] = newstore

def figs(lst, var, n, label, link=False):
    note = '<sc-if value="{{%s.hasNote}}" hint-placeholder-val="{{true}}"><small style="color: {{%s.color}}">{{%s.note}}</small></sc-if>' % (var, var, var)
    return ('<dl class="mm-figs" aria-label="%s" style="margin: 0; grid-template-columns: repeat(%d, minmax(0, 1fr))"><sc-for list="{{%s}}" as="%s" hint-placeholder-count="%d"><div class="mm-fig"><dt>{{%s.label}}</dt><dd>{{%s.value}}</dd>%s</div></sc-for></dl>'
            % (label, n, lst, var, n, var, var, note if link else ''))

def sec_h(id_, title):
    return '<h2 id="%s" style="margin: 0; font-size: 15px; line-height: 20px; font-weight: 600">%s</h2>' % (id_, title)

def dashboard(): 
    bars = ('<div class="mm-chart" role="group" aria-label="Sales across client stores, last 30 days"><div class="mm-plot" style="height: %s"><sc-for list="{{trend.ticks}}" as="tk" hint-placeholder-count="3"><div class="mm-tick" style="bottom: {{tk.pos}}"><span>{{tk.label}}</span></div></sc-for>'
            '<div class="mm-bars" style="gap: 3px"><sc-for list="{{trend.bars}}" as="br" hint-placeholder-count="30"><div class="mm-bcol" tabIndex="0" role="img" aria-label="{{br.tip}}"><i style="height: {{br.h}}"></i><b>{{br.tip}}</b></div></sc-for></div></div>'
            '<div class="mm-xlab" aria-hidden="true" style="gap: 3px"><sc-for list="{{trend.bars}}" as="bx" hint-placeholder-count="30"><span>{{bx.xl}}</span></sc-for></div></div>')
    tbl = ('<div class="mm-rwrap" style="margin: 0 -20px; max-height: 260px; overflow-y: auto"><table class="mm-rtab"><caption class="mm-sr">Sales across client stores, last 30 days</caption><thead><tr><th scope="col" style="text-align: left; padding-left: 20px">Day</th><th scope="col" style="text-align: right">Orders</th><th scope="col" style="text-align: right; padding-right: 20px">Sales</th></tr></thead>'
           '<tbody><sc-for list="{{trend.rows}}" as="tr2" hint-placeholder-count="30"><tr style="border-top: 1px solid var(--border)"><td style="padding-left: 20px">{{tr2.day}}</td><td style="text-align: right">{{tr2.orders}}</td><td style="text-align: right; font-weight: 500; padding-right: 20px">{{tr2.sales}}</td></tr></sc-for></tbody></table></div>')
    def sales(phone):
        return ('<section class="mm-card" aria-labelledby="mm-c-sl" style="gap: 14px"><div class="mm-chead"><h2 id="mm-c-sl" class="mm-ctitle">Sales across client stores</h2><button type="button" class="mm-btn mm-ghost" style="height: 28px; margin-right: -8px; padding: 0 8px" onClick="{{trend.toggle}}">{{trend.toggleText}}</button></div>'
                '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px"><sc-for list="{{sales}}" as="sl" hint-placeholder-count="2"><div style="display: flex; flex-direction: column; gap: 2px"><span class="mm-muted" style="font-size: 13px; font-weight: 500">{{sl.label}}</span><span style="font-size: 20px; line-height: 28px; font-weight: 600; font-variant-numeric: tabular-nums">{{sl.value}}</span><span class="mm-muted" style="font-size: 12px">{{sl.note}}</span></div></sc-for></div>'
                '<p class="mm-muted" style="margin: 0; font-size: 12px; font-weight: 500">Last 30 days</p>'
                '<sc-if value="{{trend.asChart}}" hint-placeholder-val="{{true}}">' + bars % ('150px' if phone else '170px') + '</sc-if><sc-if value="{{trend.asTable}}" hint-placeholder-val="{{false}}">' + tbl + '</sc-if></section>').replace('repeat(2, minmax(0, 1fr)); gap: 12px', 'repeat(2,minmax(0,1fr)); gap: 12px')
    free = card('mm-c-fr', 'Free plans', '<sc-if value="{{hasUsage}}" hint-placeholder-val="{{true}}"><ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px"><sc-for list="{{free}}" as="fl" hint-placeholder-count="6"><li style="display: flex; flex-direction: column; gap: 6px">'
                '<span style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 8px; font-size: 13px"><span>{{fl.name}}</span><span style="font-variant-numeric: tabular-nums">{{fl.text}}<sc-if value="{{fl.near}}" hint-placeholder-val="{{false}}"><strong style="margin-left: 8px; color: var(--destructive)">Near the limit</strong></sc-if></span></span>'
                '<span class="mm-meter" aria-hidden="true"><span style="display: block; height: 100%; width: {{fl.pct}}; background: {{fl.color}}"></span></span></li></sc-for></ul>'
                '<p style="margin: 0; font-size: 13px"><span class="mm-muted">Failed messages waiting:</span> {{dead}}</p></sc-if>'
                '<sc-if value="{{noUsage}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">The daily usage check hasn’t written its numbers yet.</p></sc-if>',
                sub='<sc-if value="{{hasUsage}}" hint-placeholder-val="{{true}}">As of the usage check at Oct 29, 6:00 AM. A warning shows at 70%.</sc-if>', gap='14px')
    mfigs = ('<dl class="mm-figs" aria-label="Money" style="margin: 0; grid-template-columns: repeat(3, minmax(0, 1fr))"><sc-for list="{{money}}" as="mn" hint-placeholder-count="3"><div class="mm-fig"><dt>{{mn.label}}</dt><dd>{{mn.value}}</dd><small style="color: {{mn.color}}">{{mn.note}}</small></div></sc-for></dl>')
    cols = 'minmax(0, 1.6fr) repeat(5, minmax(0, 1fr))'
    use_d = table(cols, ['Store', '>Orders this month', '>Products', '>Emails this month', '>Storage', '>Domains'], 'use', 'u',
                  '<a href="{{u.href}}" class="mm-rowlink">{{u.name}}</a><span class="mm-num">{{u.orders}}</span><span class="mm-num">{{u.products}}</span><span class="mm-num">{{u.emails}}</span><span class="mm-num">{{u.storage}}</span><span class="mm-num">{{u.domains}}</span>', 9, 'Use per store')
    use_p = plist('use', 'u', '<a href="{{u.href}}" class="mm-rowlink" style="display: flex; flex-direction: column"><span class="mm-trunc">{{u.name}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; font-weight: 400">{{u.orders}} orders · {{u.products}} products · {{u.storage}}</span></a>', 9, 'Use per store')
    sfigs = figs('stores', 'sf2', 4, 'Stores')
    body_d = '\n'.join(['<section aria-labelledby="mm-h-st" style="display: flex; flex-direction: column; gap: 10px">' + sec_h('mm-h-st', 'Stores') + sfigs + '</section>',
                        '<div class="mm-two" style="grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr)">' + sales(False) + free + '</div>',
                        '<section aria-labelledby="mm-h-mn" style="display: flex; flex-direction: column; gap: 10px">' + sec_h('mm-h-mn', 'Money') + mfigs + '</section>',
                        '<section aria-labelledby="mm-h-us" style="display: flex; flex-direction: column; gap: 10px">' + sec_h('mm-h-us', 'Use per store') + use_d + '</section>'])
    body_p = '\n'.join(['<section aria-labelledby="mm-h-st" style="display: flex; flex-direction: column; gap: 8px">' + sec_h('mm-h-st', 'Stores') + sfigs.replace('repeat(4, minmax(0, 1fr))', 'repeat(2,minmax(0,1fr))') + '</section>',
                        sales(True), free,
                        '<section aria-labelledby="mm-h-mn" style="display: flex; flex-direction: column; gap: 8px">' + sec_h('mm-h-mn', 'Money') + mfigs.replace('repeat(3, minmax(0, 1fr))', 'repeat(2,minmax(0,1fr))') + '</section>',
                        '<section aria-labelledby="mm-h-us" style="display: flex; flex-direction: column; gap: 8px">' + sec_h('mm-h-us', 'Use per store') + use_p + '</section>'])
    ppage('PlatformDashboard', 'dashboard', 'Dashboard', '', body_d, body_p, js=pread('dashboard.js'), crumbs=[('Platform', 'PlatformStores.dc.html'), ('Dashboard', '')])

ALL['dashboard'] = dashboard

def billing():
    acts = ('<button type="button" class="mm-btn mm-outline" aria-haspopup="dialog" onClick="{{openIssuer}}">Our invoice details</button>'
            '<sc-if value="{{canNew}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{openNew}}">' + svg(ICONS['plus']) + 'New invoice</button></sc-if>')
    notes = ('<sc-if value="{{noIssuer}}" hint-placeholder-val="{{false}}"><div role="alert" class="mm-alert mm-alert-bad">' + svg(ICONS['alert']) + '<p style="margin: 0; flex: 1">Our invoice details aren’t set, so no invoice can be issued yet.</p><button type="button" class="mm-btn mm-outline" style="height: 30px; color: var(--foreground)" onClick="{{openIssuer}}">Set them</button></div></sc-if>'
             '<sc-if value="{{forStore}}" hint-placeholder-val="{{false}}"><div class="mm-note" style="align-items: center"><p style="margin: 0; flex: 1">{{forText}} <a href="{{storeHref}}" style="color: var(--foreground); text-decoration: underline; text-underline-offset: 3px">Open the store</a></p><button type="button" class="mm-btn mm-outline" style="height: 30px; background: var(--background)" onClick="{{showAll}}">All stores</button></div></sc-if>')
    cols = 'minmax(0, 1fr) minmax(0, 1.3fr) 104px 116px 104px 104px'
    cells = ('<span style="display: flex; flex-direction: column; min-width: 0"><a href="{{r.href}}" class="mm-rowlink mm-mono" aria-label="{{r.aria}}">{{r.number}}</a><span class="mm-trunc mm-muted" style="font-size: 12px">{{r.period}}</span></span><span class="mm-trunc">{{r.store}}</span><span>' + sbadge('r.chip') + '</span>'
             '<span class="mm-muted" style="font-size: 13px">{{r.due}}</span><span class="mm-num">{{r.total}}</span><span class="mm-num" style="font-weight: 500; color: {{r.owedColor}}">{{r.owed}}</span>')
    bar_d = '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">' + search('Search by number or store', width=280) + RESET + '<span class="mm-muted" style="margin-left: auto; font-size: 13px">{{count}}</span></div>'
    empty = '<sc-if value="{{noRows}}" hint-placeholder-val="{{false}}">' + empty_block('No invoices here.', 'Clear search') + '</sc-if>'
    body_d = notes + ttabs(count=6) + bar_d + '<sc-if value="{{hasRows}}" hint-placeholder-val="{{true}}">' + table(cols, ['Number', 'Store', 'Status', 'Due', '>Total', '>Due now'], 'rows', 'r', cells, 12, 'Invoices') + '</sc-if>' + empty
    pcells = ('<a href="{{r.href}}" class="mm-rowlink" aria-label="{{r.aria}}" style="display: flex; flex-direction: column"><span class="mm-trunc mm-mono">{{r.number}}</span><span class="mm-trunc mm-muted" style="font-size: 13px; font-weight: 400">{{r.store}} · due {{r.due}}</span></a>'
              '<span style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px"><span style="font-weight: 500; font-variant-numeric: tabular-nums">{{r.total}}</span>' + sbadge('r.chip') + '</span>')
    acts_p = '<div style="display: flex; gap: 8px"><button type="button" class="mm-btn mm-outline" style="flex: 1" aria-haspopup="dialog" onClick="{{openIssuer}}">Our invoice details</button><sc-if value="{{canNew}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" style="flex: 1" aria-haspopup="dialog" onClick="{{openNew}}">' + svg(ICONS['plus']) + 'New invoice</button></sc-if></div>'
    body_p = notes + ttabs(count=6, phone=True) + '<div style="display: flex">' + search('Search by number or store', phone=True) + '</div>' + '<sc-if value="{{hasRows}}" hint-placeholder-val="{{true}}">' + plist('rows', 'r', pcells, 12, 'Invoices') + '</sc-if>' + empty
    nw = (radios('mm-l-lk', 'Kind', 'lineKinds', 'lk', 4) + text('mm-nw-en', 'Description in English', 'en', p='nf', invalid='enBad', err=('enBad', 'Describe the line.')) + text('mm-nw-bn', 'Description in Bangla', 'bn', p='nf', optional=True)
          + grid(text('mm-nw-q', 'Quantity', 'qty', p='nf', mode='numeric'), text('mm-nw-p', 'Unit price', 'price', p='nf', prefix='৳', mode='decimal', invalid='priceBad', err=('priceBad', 'Enter a price.'), hint='An adjustment below zero is a credit.'))
          + '<div class="mm-kv" style="padding: 10px 0; border-top: 1px solid var(--border); font-weight: 600"><span>Total</span><span>{{nTotal}}</span></div>'
          + sw('Issue it at once', 'now', 'Otherwise it waits two days as a draft for a second look.', p='nf'))
    iss = ('<p class="mm-muted" style="margin: 0">Printed on every invoice, and shown to stores under How to pay. Each invoice keeps the details it was issued with.</p>'
           + text('mm-is-l', 'Company name', 'legal', p='isf') + text('mm-is-a', 'Address', 'address', p='isf', area=True)
           + grid(text('mm-is-t', 'Trade license number', 'license', p='isf'), text('mm-is-b', 'BIN', 'bin', p='isf'))
           + text('mm-is-v', 'VAT rate', 'vat', p='isf', optional=True, suffix='%', mode='decimal', hint='Leave empty if we are not VAT-registered.')
           + grid(text('mm-is-e', 'Billing email', 'email', p='isf', typ='email'), text('mm-is-p', 'Billing phone', 'phone', p='isf', typ='tel'))
           + '<h3 style="margin: 4px 0 0; font-size: 14px; font-weight: 600">Bank</h3>' + grid(text('mm-is-bn', 'Bank', 'bank', p='isf'), text('mm-is-br', 'Branch', 'branch', p='isf'))
           + grid(text('mm-is-an', 'Account name', 'accName', p='isf'), text('mm-is-ac', 'Account number', 'accNo', p='isf'))
           + text('mm-is-rt', 'Routing number', 'routing', p='isf')
           + '<h3 style="margin: 4px 0 0; font-size: 14px; font-weight: 600">Mobile money</h3>' + grid(text('mm-is-bk', 'bKash merchant number', 'bkash', p='isf', typ='tel'), text('mm-is-ng', 'Nagad number', 'nagad', p='isf', typ='tel')))
    ex = ['\n'.join([panel('pn.nw', 'closeAll', 'mm-nw-t', '{{newTitle}}', '', nw, 'createInv', 'New invoice', phone=ph),
                     panel('pn.issuer', 'closeAll', 'mm-is-t', 'Our invoice details', '', iss, 'saveIssuer', 'Save', phone=ph)]) for ph in (False, True)]
    ppage('PlatformBilling', 'billing', 'Billing', '', body_d, body_p, js=pread('billing.js'), extra_d='\n' + ex[0], extra_p='\n' + ex[1], actions=acts, actions_p=acts_p, crumbs=[('Platform', 'PlatformStores.dc.html'), ('Billing', '')])

ALL['billing'] = billing

def invoice():
    acts = ('<button type="button" class="mm-btn mm-outline" onClick="{{print}}">' + svg(ICONS['printer']) + 'Print</button>'
            '<sc-if value="{{canVoid}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-outline" aria-haspopup="dialog" onClick="{{askVoid}}">Void</button></sc-if>'
            '<sc-if value="{{isDraft}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" onClick="{{issue}}">Issue now</button></sc-if>'
            '<sc-if value="{{isOpen}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{openPay}}">Record a payment</button></sc-if>')
    acts_p = '<div style="display: flex; flex-wrap: wrap; gap: 8px">' + acts.replace('class="mm-btn mm-outline"', 'class="mm-btn mm-outline" style="flex: 1"').replace('class="mm-btn mm-primary"', 'class="mm-btn mm-primary" style="flex: 1 1 100%"') + '</div>'
    notes = ('<sc-if value="{{isDraft}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['clock']) + '<p style="margin: 0">{{issueAfter}}</p></div></sc-if>'
             '<sc-if value="{{overdue}}" hint-placeholder-val="{{false}}"><div class="mm-banner mm-bad" role="note">' + svg(ICONS['alert']) + '<p style="margin: 0">{{overdueText}}</p></div></sc-if>'
             '<sc-if value="{{isVoid}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['ban']) + '<p style="margin: 0">{{voidText}}</p></div></sc-if>')
    meta = '<div style="display: flex; flex-direction: column; gap: 6px; min-width: 220px"><sc-for list="{{meta}}" as="mt" hint-placeholder-count="3"><div class="mm-kv" style="font-size: 13px"><span class="mm-muted">{{mt.k}}</span><span>{{mt.v}}</span></div></sc-for></div>'
    parties = ('<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px">'
               '<div style="display: flex; flex-direction: column; gap: 4px"><h3 class="mm-muted" style="margin: 0; font-size: 12px; font-weight: 500">From</h3><p style="margin: 0; font-size: 13px; white-space: pre-line">{{from}}</p></div>'
               '<div style="display: flex; flex-direction: column; gap: 4px"><h3 class="mm-muted" style="margin: 0; font-size: 12px; font-weight: 500">Billed to</h3><p style="margin: 0; font-size: 13px; white-space: pre-line">{{to}}</p></div></div>')
    tbl = ('<table class="mm-rtab" style="width: 100%"><caption class="mm-sr">Items</caption><thead><tr><th scope="col" style="text-align: left; padding-left: 0">Item</th><th scope="col" style="text-align: right">Qty</th><th scope="col" style="text-align: right">Price</th><th scope="col" style="text-align: right; padding-right: 0">Amount</th></tr></thead>'
           '<tbody><sc-for list="{{lines}}" as="ln" hint-placeholder-count="2"><tr style="border-top: 1px solid var(--border)"><td style="padding-left: 0">{{ln.item}}</td><td style="text-align: right">{{ln.qty}}</td><td style="text-align: right">{{ln.price}}</td><td style="text-align: right; padding-right: 0">{{ln.amount}}</td></tr></sc-for></tbody></table>')
    totals = ('<div style="display: flex; flex-direction: column; gap: 6px; align-self: flex-end; width: 100%; max-width: 280px; font-size: 14px">'
              '<div class="mm-kv"><span class="mm-muted">Subtotal</span><span>{{subtotal}}</span></div><div class="mm-kv" style="font-weight: 600; padding-top: 6px; border-top: 1px solid var(--border)"><span>Total</span><span>{{total}}</span></div>'
              '<sc-if value="{{hasPaid}}" hint-placeholder-val="{{false}}"><div class="mm-kv"><span class="mm-muted">Paid</span><span>−{{paid}}</span></div></sc-if>'
              '<div class="mm-kv" style="font-weight: 600"><span>Due now</span><span>{{due}}</span></div></div>')
    pays = ('<sc-if value="{{hasPayments}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-direction: column; gap: 4px; padding-top: 12px; border-top: 1px solid var(--border)"><h3 class="mm-muted" style="margin: 0; font-size: 12px; font-weight: 500">Payments</h3>'
            '<sc-for list="{{payments}}" as="py" hint-placeholder-count="1"><p style="margin: 0; font-size: 13px">{{py.text}}</p></sc-for></div></sc-if>')
    doc = ('<article class="mm-card" aria-labelledby="mm-iv-h" style="gap: 20px; padding: 24px">'
           '<div style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px"><div style="display: flex; flex-direction: column; gap: 6px"><span style="font-size: 12px; font-weight: 600; letter-spacing: .04em">MANAGEMIND</span><h2 id="mm-iv-h" style="margin: 0; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px">{{title}}' + sbadge('chip') + '</h2></div>' + meta + '</div>'
           + parties + tbl + totals + pays + '</article>')
    pay = (grid(text('mm-py-a', 'Amount', 'amount', p='pf', prefix='৳', mode='decimal', hint='{{amountHint}}', invalid='amtBad', err=('amtBad', 'Enter an amount up to what is due.')), text('mm-py-d', 'Paid on', 'date', p='pf', typ='date'))
           + segs('mm-l-pm', 'Method', 'methods', 'pmm', 4) + text('mm-py-r', 'Reference', 'ref', p='pf', optional=True, hint='The bank or bKash transaction ID.'))
    vd = ('<p class="mm-muted" style="margin: 0">A voided invoice keeps its number and can’t be paid. Make a new one if it was wrong.</p>' + text('mm-vd-w', 'Why', 'why', p='vf', area=True, invalid='whyBad', err=('whyBad', 'Say why, for the audit log.')))
    ex = ['\n'.join([panel('pn.pay', 'closeAll', 'mm-py-t', 'Record a payment', '{{title}} · {{store}}', pay, 'record', 'Record payment', phone=ph),
                     dialog('dl.vd', 'mm-vd-t', 'Void this invoice?', vd, 'closeAll', 'voidIt', 'Void', phone=ph, danger=True)]) for ph in (False, True)]
    ppage('PlatformInvoice', 'billing', '{{title}}', '<a href="{{storeHref}}" style="color: inherit; text-decoration: underline; text-underline-offset: 3px">{{store}}</a>', notes + doc, js=pread('invoice.js'), extra_d='\n' + ex[0], extra_p='\n' + ex[1],
          actions=acts, actions_p=acts_p, back=('PlatformBilling', 'All invoices'), width=860, crumbs=[('Platform', 'PlatformStores.dc.html'), ('Billing', 'PlatformBilling.dc.html'), ('{{title}}', '')])

ALL['invoice'] = invoice

def staff():
    menu = dmenu('r.menuOpen', 'r.toggleMenu', 'r.menuAria', [('Change role', 'r.change', 'users')], width=170)
    cols = 'minmax(0, 1.3fr) minmax(0, 1.4fr) 140px minmax(0, 1fr) 36px'
    name = ('<span style="display: flex; align-items: center; gap: 10px; min-width: 0">' + tile('r.tile') + '<span class="mm-trunc" style="font-weight: 500">{{r.name}}</span><sc-if value="{{r.you}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">You</span></sc-if></span>')
    cells = (name + '<span class="mm-trunc mm-muted">{{r.email}}</span><span>' + sbadge('r.role') + '</span><span>' + sbadge('r.fa') + '</span>'
             + '<sc-if value="{{r.notYou}}" hint-placeholder-val="{{true}}">' + menu + '</sc-if><sc-if value="{{r.you}}" hint-placeholder-val="{{false}}"><span></span></sc-if>')
    note = '<div class="mm-note">' + svg(ICONS['info'] if 'info' in ICONS else ICONS['alert']) + '<p style="margin: 0">To add someone, run <code class="mm-mono" style="font-size: 13px">platform:grant-role</code> from the platform workflow. Without two-factor login, a role can’t open the platform area.</p></div>'
    body_d = note + table(cols, ['Name', 'Email', 'Platform role', 'Two-factor login', ''], 'rows', 'r', cells, 5, 'Platform staff')
    pcells = (tile('r.tile', 36) + '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span style="display: flex; align-items: center; gap: 6px; font-weight: 500"><span class="mm-trunc">{{r.name}}</span><sc-if value="{{r.you}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">You</span></sc-if></span>'
              '<span class="mm-trunc mm-muted" style="font-size: 13px">{{r.email}}</span><span style="display: flex; gap: 6px; margin-top: 4px">' + sbadge('r.role') + '<sc-if value="{{r.noFa}}" hint-placeholder-val="{{false}}"><span class="mm-sbadge" style="background: color-mix(in oklch, var(--warn) 16%, transparent); color: var(--warn)">No two-factor</span></sc-if></span></span>'
              + '<sc-if value="{{r.notYou}}" hint-placeholder-val="{{true}}">' + menu + '</sc-if>')
    body_p = note + plist('rows', 'r', pcells, 5, 'Platform staff')
    db = '<p class="mm-muted" style="margin: 0">They are signed out everywhere and sign in again with the new role.</p>' + radio_list('dl.roles', 'mm-l-pr2', var='pr2', count=3)
    ex = [dialog('dl.open', 'mm-pr-t', '{{dl.title}}', db, 'closeAll', 'dl.save', 'Save', phone=ph) for ph in (False, True)]
    ppage('PlatformStaff', 'staff', 'Platform staff', 'The people who run ManageMind. Only super admins see this page.', body_d, body_p, js=pread('staff.js'), extra_d='\n' + ex[0], extra_p='\n' + ex[1], width=960,
          crumbs=[('Platform', 'PlatformStores.dc.html'), ('Platform staff', '')])

def areas():
    ctl = ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px"><div role="radiogroup" aria-label="Courier" class="mm-tabs" style="height: 36px"><sc-for list="{{couriers}}" as="cr" hint-placeholder-count="2"><button type="button" role="radio" class="mm-tab" aria-checked="{{cr.aria}}" aria-pressed="{{cr.pressed}}" onClick="{{cr.pick}}">{{cr.label}}</button></sc-for></div>'
           '<div style="display: flex; align-items: center; gap: 10px"><button type="button" role="switch" class="mm-switch" aria-labelledby="mm-l-only" aria-checked="{{only.aria}}" onClick="{{only.toggle}}" style="background: {{only.bg}}"><span class="mm-knob" style="transform: translateX({{only.x}})"></span></button><span id="mm-l-only">Only areas without a match</span></div>'
           '<span class="mm-muted" style="margin-left: auto; font-size: 13px">{{count}}</span></div>')
    ro = '<sc-if value="{{readOnlyNote}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['lock']) + '<p style="margin: 0">Only super admins can change matches.</p></div></sc-if>'
    item = ('<li style="display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-top: 1px solid var(--border)"><div style="display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px">'
            '<span style="font-weight: 500">{{ar.name}} <span class="mm-muted" style="font-weight: 400">· {{ar.district}}</span></span><span style="font-size: 13px; color: {{ar.matchColor}}">{{ar.matchText}}</span></div>'
            '<sc-if value="{{canEdit}}" hint-placeholder-val="{{true}}"><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px"><sc-if value="{{ar.noSugs}}" hint-placeholder-val="{{false}}"><span class="mm-muted" style="font-size: 13px">No close names: is the courier’s list fetched yet?</span></sc-if>'
            '<sc-for list="{{ar.sugs}}" as="sg" hint-placeholder-count="3"><button type="button" class="mm-chipq" aria-pressed="{{sg.on}}" onClick="{{sg.pick}}">{{sg.label}}</button></sc-for>'
            '<sc-if value="{{ar.canClear}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-ghost" style="height: 28px; padding: 0 8px" onClick="{{ar.clear}}">Clear</button></sc-if></div></sc-if></li>')
    lst = ('<sc-if value="{{hasAreas}}" hint-placeholder-val="{{true}}"><ul aria-label="Areas" style="list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 12px; background: var(--card); overflow: hidden"><sc-for list="{{areas}}" as="ar" hint-placeholder-count="6">' + item + '</sc-for></ul></sc-if>'
           '<sc-if value="{{noAreas}}" hint-placeholder-val="{{false}}"><div style="padding: 40px 16px; text-align: center; border: 1px dashed var(--border); border-radius: 12px"><p class="mm-muted" style="margin: 0">Every area has a match.</p></div></sc-if>')
    lst = lst.replace('<li style="display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-top: 1px solid var(--border)">', '<li class="mm-area" style="display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-top: 1px solid var(--border)">')
    intro = 'Our areas against each courier’s own. The weekly sync matches names within a district; match the rest here. A match is used by every store.'
    ppage('CourierAreas', 'areas', 'Courier areas', intro, ro + ctl + lst, js=pread('areas.js'), width=860, crumbs=[('Platform', 'PlatformStores.dc.html'), ('Courier areas', '')])

def terms():
    vt = ('<sc-if value="{{hasVersions}}" hint-placeholder-val="{{true}}"><ul style="list-style: none; margin: 0 -20px; padding: 0"><li class="mm-th" style="grid-template-columns: minmax(0, 1fr) 140px 120px; border-radius: 0; padding: 0 20px" aria-hidden="true"><span>Version</span><span>Takes effect</span><span class="mm-num">Stores accepted</span></li>'
          '<sc-for list="{{versions}}" as="v" hint-placeholder-count="3"><li style="display: grid; grid-template-columns: minmax(0, 1fr) 140px 120px; align-items: center; gap: 12px; min-height: 44px; padding: 0 20px; border-top: 1px solid var(--border)"><span style="display: flex; align-items: center; gap: 8px"><span class="mm-mono">{{v.version}}</span><sc-if value="{{v.current}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">Current</span></sc-if></span>'
          '<span class="mm-muted" style="font-size: 13px">{{v.eff}}</span><span class="mm-num" style="color: {{v.accColor}}">{{v.acc}}</span></li></sc-for></ul></sc-if>'
          '<sc-if value="{{noVersions}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">No version published yet.</p></sc-if>')
    tcard = card('mm-c-tv', 'Platform terms', vt, sub='Owners are asked to accept a version from the day it is published. From its effective date, their admin is read-only until one owner of the store accepts.',
                 right='<button type="button" class="mm-btn mm-outline" style="height: 32px" aria-haspopup="dialog" onClick="{{openPub}}">' + svg(ICONS['plus'], 14) + 'Publish version</button>', gap='14px')
    scard = card('mm-c-sp', 'Support and documents', '\n'.join([grid(text('mm-sp-e', 'Support email', 'email', typ='email'), text('mm-sp-w', 'Support WhatsApp', 'whatsapp', mode='numeric', hint='With the country code and no plus: 8801712345678.')),
                 text('mm-sp-a', 'Abuse address', 'abuse', typ='email'), text('mm-sp-h', 'Help guide (link)', 'help', typ='url'), grid(text('mm-sp-p', 'Privacy notice (link)', 'privacy', typ='url'), text('mm-sp-d', 'Data processing agreement (link)', 'dpa', typ='url'))]),
                 sub='Shown in every admin’s help menu. The abuse address also goes in the stores’ privacy page template.')
    pub = (grid(text('mm-pb-v', 'Version', 'version', p='pb'), text('mm-pb-e', 'Takes effect', 'eff', p='pb', typ='date'))
           + text('mm-pb-u', 'Address of the published text', 'url', p='pb', typ='url', invalid='urlBad', err=('urlBad', 'It must be on our own site, managemind.app.'))
           + text('mm-pb-s', 'SHA-256 of the text', 'sha', p='pb', optional=True, hint='Optional: left empty, the page is read and hashed now. It must be on our own site.').replace('class="mm-input"', 'class="mm-input mm-mono"', 1))
    ex = [panel('pn.pub', 'closeAll', 'mm-pb-t', 'Publish version', 'Owners see it as soon as it is published.', pub, 'publish', 'Publish', phone=ph) for ph in (False, True)]
    ppage('PlatformTerms', 'terms', 'Terms', '', tcard + scard, js=pread('terms.js'), extra_d='\n' + ex[0], extra_p='\n' + ex[1], width=860, bar=True, crumbs=[('Platform', 'PlatformStores.dc.html'), ('Terms', '')])

def audit():
    cols = '128px minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 1fr) 96px'
    cells = ('<span class="mm-muted" style="font-size: 13px; font-variant-numeric: tabular-nums">{{r.when}}</span><span class="mm-trunc">{{r.actor}}</span><code class="mm-mono mm-trunc" style="font-size: 13px">{{r.action}}</code>'
             '<span class="mm-trunc"><sc-if value="{{r.hasStore}}" hint-placeholder-val="{{true}}"><a href="{{r.storeHref}}" style="color: var(--foreground); text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 3px">{{r.store}}</a></sc-if><sc-if value="{{r.noStore}}" hint-placeholder-val="{{false}}"><span class="mm-muted">—</span></sc-if></span>'
             '<button type="button" class="mm-btn mm-ghost" style="height: 28px; padding: 0 8px; justify-self: end" aria-expanded="{{r.aria}}" aria-label="{{r.detailsAria}}" onClick="{{r.toggle}}">Details' + svg(ICONS['down'], 14) + '</button>'
             '<sc-if value="{{r.open}}" hint-placeholder-val="{{false}}"><pre class="mm-mono" style="grid-column: 1 / -1; margin: 0 0 8px; padding: 10px 12px; border-radius: 8px; background: var(--muted); font-size: 12px; line-height: 18px; white-space: pre-wrap">{{r.json}}</pre></sc-if>')
    bar_d = ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">' + search('Search actions, people or details', width=300) + dfilter('af', 'Action', list_pop('af', 'Action', 'Nothing found.'), 240) + dfilter('sf', 'Store', list_pop('sf', 'Store', 'Nothing found.'), 230) + RESET
             + '<span class="mm-muted" style="margin-left: auto; font-size: 13px">{{count}}</span></div>')
    empty = '<sc-if value="{{noRows}}" hint-placeholder-val="{{false}}">' + empty_block('No entries match.', 'Clear filters') + '</sc-if>'
    body_d = bar_d + '<sc-if value="{{hasRows}}" hint-placeholder-val="{{true}}">' + table(cols, ['When', 'By', 'Action', 'Store', ''], 'rows', 'r', cells, 11, 'Audit log') + '</sc-if>' + empty
    pitem = ('<li style="display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--border)"><div style="display: flex; align-items: center; gap: 8px"><code class="mm-mono mm-trunc" style="flex: 1; font-size: 13px">{{r.action}}</code>'
             '<button type="button" class="mm-btn mm-ghost mm-icon" style="width: 32px; height: 32px" aria-expanded="{{r.aria}}" aria-label="{{r.detailsAria}}" onClick="{{r.toggle}}">' + svg(ICONS['down'], 16) + '</button></div>'
             '<span class="mm-muted" style="font-size: 13px">{{r.when}} · {{r.actor}} · {{r.store}}</span>'
             '<sc-if value="{{r.open}}" hint-placeholder-val="{{false}}"><pre class="mm-mono" style="margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--muted); font-size: 12px; line-height: 18px; white-space: pre-wrap">{{r.json}}</pre></sc-if></li>')
    body_p = ('<div style="display: flex">' + search('Search actions, people or details', phone=True) + '</div><div style="display: flex; flex-wrap: wrap; gap: 8px">' + dfilter('af', 'Action', list_pop('af', 'Action', 'Nothing found.'), 240) + dfilter('sf', 'Store', list_pop('sf', 'Store', 'Nothing found.'), 230) + RESET + '</div>'
              '<sc-if value="{{hasRows}}" hint-placeholder-val="{{true}}"><ul aria-label="Audit log" style="list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden"><sc-for list="{{rows}}" as="r" hint-placeholder-count="11">' + pitem + '</sc-for></ul></sc-if>' + empty)
    ppage('AuditLog', 'audit', 'Audit log', 'Everything people and the platform changed, newest first. Only super admins see this page.', body_d, body_p, js=pread('audit.js'), crumbs=[('Platform', 'PlatformStores.dc.html'), ('Audit log', '')])

ALL.update({'staff': staff, 'areas': areas, 'terms': terms, 'audit': audit})
