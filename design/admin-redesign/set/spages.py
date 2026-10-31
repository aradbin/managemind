from sbuild import *

def index():
    icons = ''.join('<sc-if value="{{it.is_%s}}" hint-placeholder-val="{{false}}">%s</sc-if>' % (k, svg(ICONS[k], 16)) for k in ['store', 'globe', 'users', 'warehouse', 'card', 'truck', 'package', 'cart', 'phone', 'percent', 'undo', 'bell', 'receipt'])
    body = ('<sc-for list="{{groups}}" as="g" hint-placeholder-count="4"><section style="display: flex; flex-direction: column; gap: 10px"><h2 style="margin: 0; font-size: 14px; font-weight: 600; color: var(--muted-foreground)">{{g.label}}</h2>'
            '<div class="mm-scards"><sc-for list="{{g.items}}" as="it" hint-placeholder-count="3"><a href="{{it.href}}" class="mm-scard"><span class="mm-sico">' + icons + '</span>'
            '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 500">{{it.title}}</span><span class="mm-muted" style="font-size: 13px; line-height: 18px">{{it.desc}}</span>'
            '<sc-if value="{{it.hasStatus}}" hint-placeholder-val="{{false}}"><span style="margin-top: 4px; font-size: 12px; font-weight: 500; color: {{it.statusColor}}">{{it.status}}</span></sc-if></span></a></sc-for></div></section></sc-for>'
            '<sc-if value="{{none}}" hint-placeholder-val="{{false}}"><div class="mm-emptybox"><p style="margin: 0">No settings match.</p><button type="button" class="mm-btn mm-outline" onClick="{{clearQ}}">Clear search</button></div></sc-if>')
    d = '\n'.join([MAIN, '<div style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">Settings</h1>' + search('Find a setting', width=280) + '</div>', body]) + DEND + XEND
    ph = '\n'.join([PROOT % 'var(--background)', '@@PHEADER@@', '<main class="mm-scroll" style="gap: 16px; padding: 16px">', '<h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600">Settings</h1>', search('Find a setting', phone=True), body, '</main>', '@@TABBAR@@']) + PXEND
    js = sread('index.js'); opts = js_starts(js)
    jsall = RSHARED + sread('shared.js') + js
    write('Settings', sdhead('index', 'Settings', [('Settings', '')]), rexpand(d), jsall, props(opts, opts[0]), 'mm mm-root')
    write('SettingsPhone', sphead('Settings'), expand(ph.replace('@@TABBAR@@', RTABBAR), True), jsall, props(opts, opts[0], True), 'mm')

def store():
    body = '\n'.join([
        card('mm-c-sp', 'Name and contact', '\n'.join([
            text('mm-sp-name', 'Store name', 'name', invalid='nameAria', err=('nameBad', 'Enter your store’s name.')),
            segs('mm-l-lang', 'Main language for shoppers and emails', 'langs', 'lg', 2),
            DIV, '<p class="mm-label" style="margin: 0">Contact</p>',
            grid(text('mm-sp-em', 'Contact email', 'email', typ='email'), text('mm-sp-ph', 'Contact phone', 'phone', typ='tel', mode='tel')),
            text('mm-sp-l1', 'Address', 'line1'), grid(text('mm-sp-l2', 'Address line 2', 'line2', optional=True), text('mm-sp-city', 'City or district', 'city'))])),
        card('mm-c-bz', 'Business details', '\n'.join([
            text('mm-bz-name', 'Registered business name', 'bizName'), grid(text('mm-bz-tl', 'Trade licence number', 'licence'), text('mm-bz-db', 'Digital Business ID (DBID)', 'dbid')),
            text('mm-bz-bin', 'BIN (VAT registration)', 'bin', hint='Needed before you turn on VAT.')]), sub='Shown in your store’s footer. All optional for now.')])
    spage('SettingsStore', 'store', 'Store profile', 'Name, language, and how customers reach you.', body, js=sread('store.js'))


def chipsb(p, var, count=2, label_id=''):
    return ('<div role="radiogroup"%s class="mm-chips"><sc-for list="{{%s}}" as="%s" hint-placeholder-count="%d"><button type="button" role="radio" class="mm-chipq" aria-checked="{{%s.aria}}" aria-pressed="{{%s.pressed}}" onClick="{{%s.pick}}">{{%s.label}}</button></sc-for></div>'
            % (' aria-labelledby="%s"' % label_id if label_id else '', p, var, count, var, var, var, var))

def statusline(text_hole, meta_hole, tone='ok'):
    ic = svg(ICONS['ok'], 16, 'flex: none; margin-top: 2px; color: var(--success)') if tone == 'ok' else svg(ICONS['alert'], 16, 'flex: none; margin-top: 2px; color: var(--warn)')
    return '<div style="display: flex; gap: 10px">' + ic + '<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span style="font-weight: 500">%s</span><span class="mm-muted" style="font-size: 13px">%s</span></div></div>' % (text_hole, meta_hole)

def domains():
    menu = dmenu('dm.menuOpen', 'dm.toggleMenu', 'dm.menuAria', [('Make primary', 'dm.makePrimary', 'check', 'dm.notPrimary'), ('Check now', 'dm.check', 'refresh', 'dm.pending'), 'sep', ('Disconnect', 'dm.remove', 'x', True)], width=180)
    dns = ('<sc-if value="{{dm.pending}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-radius: 10px; background: var(--muted)">'
           '<p style="margin: 0; font-weight: 500">Add this record at your DNS provider:</p><div class="mm-rwrap" style="border: 1px solid var(--border); border-radius: 8px; background: var(--background)"><table class="mm-rtab"><thead><tr><th style="text-align: left">Type</th><th style="text-align: left">Name</th><th style="text-align: left">Value</th><th></th></tr></thead>'
           '<tbody><tr><td><span class="mm-code2">CNAME</span></td><td><span class="mm-code2">www</span></td><td><span class="mm-code2">stores.managemind.app</span></td><td style="text-align: right"><button type="button" class="mm-btn mm-ghost" style="height: 28px; padding: 0 8px" onClick="{{dm.copy}}">' + svg(ICONS['copy'], 14) + 'Copy</button></td></tr></tbody></table></div>'
           '<p class="mm-muted" style="margin: 0; font-size: 13px">Where to add it: sign in where you bought the domain (for example your registrar or Cloudflare), open DNS settings, add the record, and save. It usually works within an hour, sometimes up to a day.</p>'
           '<div style="display: flex; align-items: center; gap: 8px"><span class="mm-muted" style="flex: 1; font-size: 12px">{{dm.checked}}</span><button type="button" class="mm-btn mm-outline" style="height: 32px; background: var(--background)" onClick="{{dm.check}}">' + svg(ICONS['refresh'], 14) + 'Check now</button></div></div></sc-if>')
    body = '\n'.join([
        card('mm-c-dd', 'Default address', '<div style="display: flex; align-items: center; gap: 10px">' + svg(ICONS['globe'], 16, 'flex: none; color: var(--muted-foreground)') + '<span class="mm-mono" style="flex: 1">nakshi.managemind.app</span><span class="mm-muted" style="font-size: 13px">Always works</span></div>', gap='12px'),
        card('mm-c-dc', 'Your domains', '<ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px"><sc-for list="{{domains}}" as="dm" hint-placeholder-count="2"><li style="display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--border)">'
             '<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap"><span class="mm-mono" style="font-weight: 600">{{dm.host}}</span>' + sbadge('dm.chip') + '<sc-if value="{{dm.primary}}" hint-placeholder-val="{{true}}"><span class="mm-badge-sec">Primary</span></sc-if><span style="flex: 1"></span>' + menu + '</div>' + dns + '</li></sc-for></ul>'
             '<sc-if value="{{canAdd}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline" style="align-self: flex-start" aria-haspopup="dialog" onClick="{{openAdd}}">' + svg(ICONS['plus']) + 'Connect a domain</button></sc-if>'
             '<sc-if value="{{atLimit}}" hint-placeholder-val="{{true}}"><p class="mm-muted" style="margin: 0; font-size: 13px">A store can connect at most 2 domains.</p></sc-if>',
             sub='Shoppers and search engines use the primary address. The others redirect to it.', gap='4px')])
    add_body = ('<div class="mm-field"><label class="mm-label" for="mm-ad-host">Domain</label><input id="mm-ad-host" class="mm-input" placeholder="www.yourshop.com.bd" aria-invalid="{{add.aria}}" value="{{add.host}}" onChange="{{add.onHost}}">'
                '<sc-if value="{{add.bare}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">{{add.bareText}}</p></sc-if><p class="mm-hint">Use the www address, such as www.yourshop.com.bd.</p></div>')
    ab = dfoot_buttons('closeAll', 'add.save', 'Connect')
    extra_d = '\n' + dpanel('add.open', 'closeAll', 'mm-ad-title', 'Connect a domain', 'You add one DNS record next.', add_body, '', ab[0], ab[1]) + '\n' + palert('dl.open', '{{dl.title}}', '<p style="margin: 0">Shoppers can’t reach your store at this domain any more.</p>', 'closeAll', 'dl.confirm', 'Disconnect')
    extra_p = '\n' + pdrawer('add.open', 'closeAll', 'mm-ad-title', 'Connect a domain', '', pbody(add_body), pfoot('closeAll', 'add.save', 'Connect'), tall=False) + '\n' + phalert('dl.open', '{{dl.title}}', '<p style="margin: 0">Shoppers can’t reach your store at this domain any more.</p>', 'closeAll', 'dl.confirm', 'Disconnect')
    spage('SettingsDomains', 'domains', 'Domains', 'Your store’s addresses. Connect your own domain, such as www.yourshop.com.bd.', body, js=sread('domains.js'), extra_d=extra_d, extra_p=extra_p, bar=False)

def staff():
    menu = dmenu('mb.menuOpen', 'mb.toggleMenu', 'mb.menuAria', [('Change role', 'mb.changeRole', 'pencil'), 'sep', ('Remove', 'mb.remove', 'x', True)], width=170)
    mrow_d = ('<sc-for list="{{members}}" as="mb" hint-placeholder-count="4"><li style="display: grid; grid-template-columns: 32px minmax(0, 1fr) 110px 120px 36px; align-items: center; gap: 12px; min-height: 56px; padding: 0 12px 0 20px; border-top: 1px solid var(--border)">'
              '<span class="mm-avatar" style="width: 32px; height: 32px; border-radius: 9999px; display: inline-flex; align-items: center; justify-content: center; background: var(--muted); font-size: 12px; font-weight: 600">{{mb.initials}}</span>'
              '<span style="display: flex; flex-direction: column; min-width: 0"><span style="display: flex; align-items: center; gap: 6px"><span class="mm-trunc" style="font-weight: 500">{{mb.name}}</span><sc-if value="{{mb.you}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">You</span></sc-if></span><span class="mm-trunc mm-muted" style="font-size: 13px">{{mb.email}}</span></span>'
              '<span>{{mb.role}}</span><span class="mm-muted" style="font-size: 13px">{{mb.joined}}</span><sc-if value="{{mb.notYou}}" hint-placeholder-val="{{true}}">' + menu + '</sc-if><sc-if value="{{mb.you}}" hint-placeholder-val="{{false}}"><span></span></sc-if></li></sc-for>')
    mrow_p = ('<sc-for list="{{members}}" as="mb" hint-placeholder-count="4"><li style="display: flex; align-items: center; gap: 10px; min-height: 60px; padding: 0 4px 0 16px; border-top: 1px solid var(--border)">'
              '<span style="flex: none; width: 32px; height: 32px; border-radius: 9999px; display: inline-flex; align-items: center; justify-content: center; background: var(--muted); font-size: 12px; font-weight: 600">{{mb.initials}}</span>'
              '<span style="flex: 1; display: flex; flex-direction: column; min-width: 0"><span style="display: flex; align-items: center; gap: 6px"><span class="mm-trunc" style="font-weight: 500">{{mb.name}}</span><sc-if value="{{mb.you}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">You</span></sc-if></span><span class="mm-trunc mm-muted" style="font-size: 13px">{{mb.role}} · {{mb.email}}</span></span>'
              '<sc-if value="{{mb.notYou}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{mb.menuAria}}" onClick="{{mb.changeRole}}">' + svg(ICONS['pencil'], 16) + '</button></sc-if></li></sc-for>')
    inv = ('<sc-if value="{{hasInvites}}" hint-placeholder-val="{{true}}"><ul style="list-style: none; margin: 0 -20px; padding: 0"><sc-for list="{{invites}}" as="iv2" hint-placeholder-count="1"><li style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-height: 52px; padding: 8px 20px; border-top: 1px solid var(--border)">'
           '<span style="flex: 1; min-width: 160px; display: flex; flex-direction: column"><span class="mm-trunc" style="font-weight: 500">{{iv2.email}}</span><span class="mm-muted" style="font-size: 13px">{{iv2.role}} · expires {{iv2.expires}}</span></span>'
           '<button type="button" class="mm-btn mm-ghost" style="height: 32px" onClick="{{iv2.resend}}">Send again</button><button type="button" class="mm-btn mm-ghost mm-danger" style="height: 32px" onClick="{{iv2.revoke}}">Cancel invitation</button></li></sc-for></ul></sc-if>'
           '<sc-if value="{{noInvites}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">No pending invitations.</p></sc-if>')
    def body(phone):
        return '\n'.join([
            '<section class="mm-card" aria-labelledby="mm-c-mb" style="gap: 8px; padding: 20px 0 0"><div class="mm-chead" style="padding: 0 20px 4px"><h2 id="mm-c-mb" class="mm-ctitle">Members</h2></div>'
            '<ul style="list-style: none; margin: 0; padding: 0">' + (mrow_p if phone else mrow_d) + '</ul></section>',
            card('mm-c-iv', 'Pending invitations', inv, gap='8px'),
            '<button type="button" class="mm-btn mm-ghost mm-danger" style="align-self: flex-start" onClick="{{leave}}">Leave this store</button>'])
    ivb = ('<div class="mm-field"><label class="mm-label" for="mm-iv-em">Email</label><input id="mm-iv-em" class="mm-input" type="email" aria-invalid="{{iv.aria}}" value="{{iv.email}}" onChange="{{iv.onEmail}}" placeholder="name@example.com"><sc-if value="{{iv.bad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">Enter an email address.</p></sc-if><p class="mm-hint">They get an email with a link that works for 7 days.</p></div>'
           + radios('mm-l-ivr', 'Role', 'iv.roles', 'ivr', 4))
    rlb = radios('mm-l-rlr', 'Role', 'rl.roles', 'rlr', 4)
    a, bsave = dfoot_buttons('closeAll', 'iv.save', 'Send invitation')
    c, dsave = dfoot_buttons('closeAll', 'rl.save', 'Change role')
    extra_d = '\n'.join(['', dpanel('iv.open', 'closeAll', 'mm-iv-title', 'Invite someone', 'To Nakshi Fashion', ivb, '', a, bsave), dpanel('rl.open', 'closeAll', 'mm-rl-title', '{{rl.title}}', '', rlb, '', c, dsave),
                         palert('rmv.open', '{{rmv.title}}', '<p style="margin: 0">{{rmv.body}}</p>', 'closeAll', 'rmv.confirm', 'Remove')])
    extra_p = '\n'.join(['', pdrawer('iv.open', 'closeAll', 'mm-iv-title', 'Invite someone', '', pbody(ivb), pfoot('closeAll', 'iv.save', 'Send invitation')), pdrawer('rl.open', 'closeAll', 'mm-rl-title', '{{rl.title}}', '', pbody(rlb), pfoot('closeAll', 'rl.save', 'Change role'), tall=False),
                         phalert('rmv.open', '{{rmv.title}}', '<p style="margin: 0">{{rmv.body}}</p>', 'closeAll', 'rmv.confirm', 'Remove')])
    spage('SettingsStaff', 'staff', 'Staff', 'Who can work in this store, and what they can do.', body(False), body(True), js=sread('staff.js'), extra_d=extra_d, extra_p=extra_p, bar=False,
          actions='<button type="button" class="mm-btn mm-primary" aria-haspopup="dialog" onClick="{{openInvite}}">@@I:plus@@Invite</button>')

def location():
    body = card('mm-c-lc', 'Stock location', '\n'.join([text('mm-lc-n', 'Name', 'name'), text('mm-lc-l1', 'Address', 'line1', optional=True), grid(text('mm-lc-l2', 'Address line 2', 'line2', optional=True), text('mm-lc-c', 'City or district', 'city'))]),
                sub='The name and address of the place your stock is counted.')
    spage('SettingsLocation', 'location', 'Stock location', 'Where your stock is kept.', body, js=sread('location.js'))

def vat():
    rates = ('<ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px"><sc-for list="{{rates}}" as="rt" hint-placeholder-count="2"><li style="display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) 96px auto 32px; align-items: center; gap: 8px">'
             '<input class="mm-input" aria-label="Key" placeholder="Key" value="{{rt.key}}" onChange="{{rt.onKey}}" disabled="{{readOnly}}"><input class="mm-input" aria-label="Name" placeholder="Name" value="{{rt.name}}" onChange="{{rt.onName}}" disabled="{{readOnly}}">'
             '<label class="mm-affix mm-affix-r"><input class="mm-input" aria-label="Rate (%)" inputMode="decimal" value="{{rt.rate}}" onChange="{{rt.onRate}}" disabled="{{rt.exempt}}"><span aria-hidden="true" style="top: @@AFFIX@@">%</span></label>'
             '<label style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; white-space: nowrap; cursor: pointer"><button type="button" role="checkbox" class="mm-check" aria-checked="{{rt.ex.aria}}" onClick="{{rt.ex.toggle}}" style="background: {{rt.ex.box}}; border-color: {{rt.ex.edge}}"><sc-if value="{{rt.ex.on}}" hint-placeholder-val="{{false}}">' + CHECK + '</sc-if></button>Exempt</label>'
             '<button type="button" class="mm-btn mm-ghost mm-icon" aria-label="{{rt.removeAria}}" onClick="{{rt.remove}}" style="width: 32px; height: 32px">' + svg(ICONS['x']) + '</button></li></sc-for></ul>'
             '<button type="button" class="mm-addrow" onClick="{{addRate}}">' + svg(ICONS['plus']) + 'Add a rate</button>')
    body = '\n'.join([
        card('mm-c-vt', 'VAT', '\n'.join([sw('Charge VAT', 'on'),
             '<sc-if value="{{vatOn}}" hint-placeholder-val="{{true}}">' + '\n'.join([text('mm-vt-r', 'Rate (%)', 'rate', suffix='%', mode='decimal', hint='Bangladesh’s standard rate is 15%.'), radios('mm-l-vp', 'Your prices', 'prices', 'vp', 2),
             '<p class="mm-note" style="margin: 0; font-size: 13px">' + svg(ICONS['info']) + '<span>{{example}}</span></p>']) + '</sc-if>']), sub='Turn VAT on if your business is VAT-registered. Check the rates with your accountant.'),
        '<sc-if value="{{vatOn}}" hint-placeholder-val="{{true}}">' + card('mm-c-vr', 'Other rates', rates, sub='For products taxed differently: a reduced rate, or exempt.') + '</sc-if>'])
    spage('SettingsVat', 'vat', 'VAT', 'Whether you charge VAT, and the rates.', body, js=sread('vat.js'))

def payments():
    form_html = ('<sc-if value="{{editing}}" hint-placeholder-val="{{false}}">' + '\n'.join([
        '<div class="mm-field"><label class="mm-label" for="mm-py-id">Store ID</label><input id="mm-py-id" class="mm-input" value="{{p.id}}" onChange="{{p.onId}}" placeholder="nakshi0live"></div>',
        '<div class="mm-field"><label class="mm-label" for="mm-py-pw">Store password</label><input id="mm-py-pw" class="mm-input" type="password" value="{{p.pw}}" onChange="{{p.onPw}}"><p class="mm-hint">From SSLCommerz’s welcome email. It’s encrypted and never shown again.</p></div>',
        '<div class="mm-field"><span class="mm-label" id="mm-l-pm">Account</span>' + chipsb('p.modes', 'pmd', 2, 'mm-l-pm') + '</div>',
        '<sc-if value="{{p.refused}}" hint-placeholder-val="{{false}}"><div class="mm-alert mm-alert-bad" role="alert">' + svg(ICONS['alert']) + '<p style="margin: 0">{{p.refusedText}}</p></div></sc-if>',
        '<div style="display: flex; gap: 8px"><sc-if value="{{p.notChecking}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" onClick="{{p.save}}">Check and save</button></sc-if><sc-if value="{{p.checking}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-primary" disabled="{{true}}">' + svg(ICONS['refresh'], 16) + 'Checking with the provider…</button></sc-if><button type="button" class="mm-btn mm-ghost" onClick="{{cancelEdit}}">Cancel</button></div>']) + '</sc-if>')
    body = '\n'.join([
        card('mm-c-ssl', 'SSLCommerz', '\n'.join([
            '<sc-if value="{{conn}}" hint-placeholder-val="{{true}}">' + statusline('{{status}}', '{{meta}}') + '<div style="display: flex; gap: 8px"><button type="button" class="mm-btn mm-outline" onClick="{{change}}">Change</button><button type="button" class="mm-btn mm-ghost mm-danger" onClick="{{askRemove}}">Remove</button></div></sc-if>',
            '<sc-if value="{{notConn}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">Not connected. Customers can only pay on delivery.</p><button type="button" class="mm-btn mm-primary" style="align-self: flex-start" onClick="{{connect}}">Connect SSLCommerz</button></sc-if>', form_html]),
             sub='Customers pay by card, bKash, Nagad or bank through your own SSLCommerz account. The money goes straight to you.'),
        '<p class="mm-muted" style="margin: 0; font-size: 13px">To ask some customers for the delivery charge in advance, see <a href="@@CHECKOUT@@" style="color: var(--foreground); text-decoration: underline; text-underline-offset: 3px">Checkout</a>.</p>'])
    extra_d = '\n' + palert('dl.open', 'Disconnect SSLCommerz?', '<p style="margin: 0">Customers won’t be able to pay online. Orders already paid are not affected.</p>', 'closeAll', 'dl.confirm', 'Disconnect')
    extra_p = '\n' + phalert('dl.open', 'Disconnect SSLCommerz?', '<p style="margin: 0">Customers won’t be able to pay online. Orders already paid are not affected.</p>', 'closeAll', 'dl.confirm', 'Disconnect')
    spage('SettingsPayments', 'payments', 'Payments', 'Online payment with your SSLCommerz account.', body.replace('@@CHECKOUT@@', 'SettingsCheckout.dc.html'), body.replace('@@CHECKOUT@@', 'SettingsCheckoutPhone.dc.html'), js=sread('payments.js'), extra_d=extra_d, extra_p=extra_p, bar=False)


def inp(id_, label, val, on, typ='text', hint='', optional=False, prefix=None, suffix=None, mode=None, ph=''):
    lab = opt(label) if optional else label
    m = ' inputMode="%s"' % mode if mode else ''
    i = '<input id="%s" class="mm-input" type="%s"%s value="{{%s}}" onChange="{{%s}}" placeholder="%s">' % (id_, typ, m, val, on, ph)
    if prefix: i = '<label class="mm-affix"><span aria-hidden="true" style="top: @@AFFIX@@">%s</span>%s</label>' % (prefix, i)
    if suffix: i = '<label class="mm-affix mm-affix-r">%s<span aria-hidden="true" style="top: @@AFFIX@@">%s</span></label>' % (i, suffix)
    h = '<p class="mm-hint">%s</p>' % hint if hint else ''
    return '<div class="mm-field"><label class="mm-label" for="%s">%s</label>%s%s</div>' % (id_, lab, i, h)

def flagsw(label, p, hint=''):
    hh = '<span>%s</span>' % hint if hint else ''
    return ('<div class="mm-swrow" style="align-items: flex-start"><span class="mm-swtext"><span>%s</span>%s</span><button type="button" role="switch" class="mm-switch" aria-label="%s" aria-checked="{{%s.aria}}" onClick="{{%s.toggle}}" style="background: {{%s.bg}}; margin-top: 2px"><span class="mm-knob" style="transform: translateX({{%s.x}})"></span></button></div>'
            % (label, hh, label, p, p, p, p))

def delivery():
    zlist = ('<ul style="list-style: none; margin: 0 -20px; padding: 0"><sc-for list="{{zones}}" as="z" hint-placeholder-count="4"><li style="display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 12px 10px 20px; border-top: 1px solid var(--border)">'
             '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px"><span style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap"><span style="font-weight: 500">{{z.name}}</span><sc-if value="{{z.fallback}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec">Fallback</span></sc-if><sc-if value="{{z.off}}" hint-placeholder-val="{{false}}"><span class="mm-badge-sec" style="color: var(--muted-foreground)">off</span></sc-if></span>'
             '<span class="mm-trunc mm-muted" style="font-size: 13px">{{z.cover}} · {{z.eta}}</span><span class="mm-muted" style="font-size: 12px">{{z.weight}}</span></span>'
             '<span style="font-weight: 600; font-variant-numeric: tabular-nums">{{z.fee}}</span><button type="button" class="mm-btn mm-ghost" style="height: 32px" aria-label="{{z.aria}}" aria-haspopup="dialog" onClick="{{z.edit}}">Edit</button></li></sc-for></ul>')
    calc = '\n'.join([grid(inp('mm-dc-d', 'District', 'calc.district', 'calc.onDistrict'), inp('mm-dc-a', 'Area', 'calc.area', 'calc.onArea'), inp('mm-dc-kg', 'Weight (kg)', 'calc.kg', 'calc.onKg', mode='decimal'), cols=3),
        '<div class="mm-note" role="status"><span style="display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 600">{{calc.result}}</span><span class="mm-muted" style="font-size: 13px">{{calc.why}}</span></span></div>'])
    body = '\n'.join([
        '<sc-if value="{{noFallback}}" hint-placeholder-val="{{false}}"><div class="mm-banner mm-bad" role="alert">' + svg(ICONS['alert']) + '<p style="margin: 0">No active fallback zone: shoppers outside your zones can’t order.</p></div></sc-if>',
        card('mm-c-zn', 'Zones', zlist, sub='An area listed in a zone wins over its district; the fallback zone covers everywhere else.', gap='8px',
             right='<button type="button" class="mm-btn mm-outline" style="height: 32px" aria-haspopup="dialog" onClick="{{addZone}}">' + svg(ICONS['plus']) + 'Add zone</button>'),
        card('mm-c-fc', 'Fee calculator', calc, sub='Check what a shopper would pay.')])
    zb = '\n'.join([
        grid(inp('mm-zn-en', 'Name (English)', 'zn.en', 'zn.onEn'), inp('mm-zn-bn', 'Name (Bangla)', 'zn.bn', 'zn.onBn')),
        inp('mm-zn-fee', 'Fee', 'zn.fee', 'zn.onFee', prefix='৳', mode='decimal'),
        flagsw('Charge more for heavy orders', 'zn.byWeight'),
        '<sc-if value="{{zn.weightOn}}" hint-placeholder-val="{{true}}">' + grid(inp('mm-zn-fk', 'Weight included (kg)', 'zn.freeKg', 'zn.onFreeKg', mode='decimal'), inp('mm-zn-pk', 'Each extra kg', 'zn.perKg', 'zn.onPerKg', prefix='৳', mode='decimal')) + '</sc-if>',
        grid(inp('mm-zn-eta', 'Delivery time (English)', 'zn.eta', 'zn.onEta', ph='1–2 days'), inp('mm-zn-etab', 'Delivery time (Bangla)', 'zn.etaBn', 'zn.onEtaBn')),
        '<p class="mm-hint" style="margin-top: -8px">Shown at checkout.</p>', DIV,
        flagsw('Fallback: covers everywhere no other zone does', 'zn.fallback'),
        '<sc-if value="{{zn.fallbackTaken}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err" style="margin: -8px 0 0">Another zone is already the fallback.</p></sc-if>',
        '<sc-if value="{{zn.notFallback}}" hint-placeholder-val="{{true}}"><div class="mm-field"><span class="mm-label" id="mm-l-zd">{{zn.districtsTitle}}</span><div role="group" aria-labelledby="mm-l-zd" class="mm-chips"><sc-for list="{{zn.districts}}" as="zd" hint-placeholder-count="8"><button type="button" class="mm-chipq" aria-pressed="{{zd.pressed}}" onClick="{{zd.toggle}}">{{zd.label}}</button></sc-for></div></div>'
        '<div class="mm-field"><label class="mm-label" for="mm-zn-aq">{{zn.areasTitle}}</label><div class="mm-tagrow"><sc-for list="{{zn.areas}}" as="za" hint-placeholder-count="2"><span class="mm-tagx">{{za.label}}<button type="button" aria-label="{{za.aria}}" onClick="{{za.remove}}">' + svg(ICONS['x'], 12) + '</button></span></sc-for></div><input id="mm-zn-aq" class="mm-input" placeholder="Type an area and press Enter" value="{{zn.areaQ}}" onChange="{{zn.onAreaQ}}" onKeyDown="{{zn.areaKey}}"><p class="mm-hint">An area here wins over its district’s zone.</p></div></sc-if>',
        DIV, flagsw('Zone is on', 'zn.active'),
        '<sc-if value="{{zn.bad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err" role="alert" style="margin: 0">Give the zone a name, a fee, and at least one district or area.</p></sc-if>'])
    left = '<sc-if value="{{zn.isEdit}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost mm-danger" onClick="{{zn.del}}" style="margin-left: -8px; padding: 0 8px">Delete</button></sc-if>'
    a, sv = dfoot_buttons('closeAll', 'zn.save', 'Save zone')
    extra_d = '\n' + dpanel('zn.open', 'closeAll', 'mm-zn-title', '{{zn.title}}', '', zb, left, a, sv) + '\n' + palert('dz.open', '{{dz.title}}', '<p style="margin: 0">Past orders keep the zone’s name and fee.</p>', 'closeAll', 'dz.confirm', 'Delete')
    extra_p = '\n' + pdrawer('zn.open', 'closeAll', 'mm-zn-title', '{{zn.title}}', '', pbody(zb + left), pfoot('closeAll', 'zn.save', 'Save zone')) + '\n' + phalert('dz.open', '{{dz.title}}', '<p style="margin: 0">Past orders keep the zone’s name and fee.</p>', 'closeAll', 'dz.confirm', 'Delete')
    spage('SettingsDelivery', 'delivery', 'Delivery', 'Each zone has a fee, and may charge more for heavy orders.', body, js=sread('delivery.js'), extra_d=extra_d, extra_p=extra_p, bar=False)

def couriers():
    hook = ('<sc-if value="{{cr.hook}}" hint-placeholder-val="{{true}}"><details style="border-top: 1px solid var(--border); padding-top: 10px"><summary style="cursor: pointer; font-weight: 500; font-size: 13px">Status updates</summary><div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px">'
            '<p class="mm-muted" style="margin: 0; font-size: 13px">In {{cr.name}}’s merchant panel, open the webhook settings and paste this URL and secret.</p>'
            '<div class="mm-readonly" style="font-size: 12px"><span class="mm-trunc mm-mono" style="flex: 1">{{cr.url}}</span><button type="button" class="mm-btn mm-ghost" style="height: 26px; padding: 0 6px" onClick="{{cr.copy}}">Copy</button></div>'
            '<div class="mm-readonly" style="font-size: 12px"><span class="mm-trunc mm-mono" style="flex: 1">{{cr.secret}}</span><button type="button" class="mm-btn mm-ghost" style="height: 26px; padding: 0 6px" aria-label="{{cr.showAria}}" onClick="{{cr.show}}">Show</button><button type="button" class="mm-btn mm-ghost" style="height: 26px; padding: 0 6px" onClick="{{cr.copy}}">Copy</button></div>'
            '<button type="button" class="mm-btn mm-ghost" style="align-self: flex-start; height: 28px; margin-left: -8px; padding: 0 8px" onClick="{{cr.rotate}}">Make a new secret</button></div></details></sc-if>')
    clist = ('<div style="display: flex; flex-direction: column; gap: 12px"><sc-for list="{{couriers}}" as="cr" hint-placeholder-count="3"><div style="display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 10px">'
             '<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">' + svg(ICONS['truck'], 16, 'flex: none; color: var(--muted-foreground)') + '<span style="font-weight: 600">{{cr.name}}</span>' + sbadge('cr.chip') + '<span style="flex: 1"></span>'
             '<sc-if value="{{cr.conn}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost" style="height: 30px; padding: 0 8px" onClick="{{cr.change}}">Change keys</button><button type="button" class="mm-btn mm-ghost mm-danger" style="height: 30px; padding: 0 8px" onClick="{{cr.remove}}">Disconnect</button></sc-if>'
             '<sc-if value="{{cr.notConn}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline" style="height: 30px" aria-haspopup="dialog" onClick="{{cr.connect}}">Connect</button></sc-if></div>'
             '<p class="mm-muted" style="margin: 0; font-size: 13px">{{cr.meta}}</p>' + hook + '</div></sc-for></div>')
    defaults = '\n'.join([segs('mm-l-cf', 'Courier offered first', 'firsts', 'cf', 3), grid(text('mm-cd-g', 'Weight when products have none (grams)', 'grams', mode='numeric'), text('mm-cd-n', 'Note on every parcel', 'note', optional=True)),
                          sw('Book with the default courier when an order is confirmed', 'autoBook')])
    body = '\n'.join([card('mm-c-cs', 'Couriers', clist, sub='Each courier sends its updates by itself once connected; we also ask twice a day.', gap='12px'), card('mm-c-cd', 'Parcel defaults', defaults)])
    kb = ('<sc-for list="{{kp.fields}}" as="kf" hint-placeholder-count="2"><div class="mm-field"><label class="mm-label" for="{{kf.id}}">{{kf.label}}</label><input id="{{kf.id}}" class="mm-input" type="{{kf.secret}}" value="{{kf.value}}" onChange="{{kf.on}}"></div></sc-for>'
          '<sc-if value="{{kp.isPathao}}" hint-placeholder-val="{{false}}"><p class="mm-hint" style="margin: -8px 0 0">Pathao’s API signs in with the merchant panel’s login. Use a separate Pathao user for it if Pathao lets you.</p></sc-if>'
          '<div class="mm-field"><span class="mm-label" id="mm-l-km">Mode</span>' + chipsb('kp.modes', 'km', 2, 'mm-l-km') + '</div>')
    a, sv = dfoot_buttons('closeAll', 'kp.save', 'Check keys')
    extra_d = '\n' + dpanel('kp.open', 'closeAll', 'mm-kp-title', '{{kp.title}}', 'Keys are encrypted and never shown again.', kb, '', a, sv) + '\n' + palert('dc.open', '{{dc.title}}', '<p style="margin: 0">{{dc.body}}</p>', 'closeAll', 'dc.confirm', 'Disconnect')
    extra_p = '\n' + pdrawer('kp.open', 'closeAll', 'mm-kp-title', '{{kp.title}}', '', pbody(kb), pfoot('closeAll', 'kp.save', 'Check keys'), tall=False) + '\n' + phalert('dc.open', '{{dc.title}}', '<p style="margin: 0">{{dc.body}}</p>', 'closeAll', 'dc.confirm', 'Disconnect')
    spage('SettingsCouriers', 'couriers', 'Couriers', 'Book parcels from the order page and follow them here.', body, js=sread('couriers.js'), extra_d=extra_d, extra_p=extra_p)

def checkout():
    bl = ('<div style="display: grid; grid-template-columns: 160px minmax(0, 1fr) auto; gap: 8px"><input class="mm-input" type="tel" aria-label="Phone" placeholder="Phone" value="{{bp}}" onChange="{{onBp}}"><input class="mm-input" aria-label="Reason" placeholder="Reason (optional)" value="{{br}}" onChange="{{onBr}}"><button type="button" class="mm-btn mm-outline" onClick="{{block}}">' + svg(ICONS['ban']) + 'Block</button></div>'
          '<sc-if value="{{hasBlocked}}" hint-placeholder-val="{{true}}"><ul style="list-style: none; margin: 0 -20px; padding: 0"><sc-for list="{{blocked}}" as="bk2" hint-placeholder-count="2"><li style="display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 12px 6px 20px; border-top: 1px solid var(--border)"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-mono" style="font-weight: 500">{{bk2.phone}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{bk2.reason}} · {{bk2.when}}</span></span><button type="button" class="mm-btn mm-ghost" style="height: 32px" onClick="{{bk2.unblock}}">Unblock</button></li></sc-for></ul></sc-if>'
          '<sc-if value="{{noBlocked}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">No blocked phones.</p></sc-if>')
    body = '\n'.join([
        card('mm-c-co', 'Checkout', '\n'.join([segs('mm-l-ce', 'Email address', 'emails', 'ce', 3), grid(text('mm-co-mq', 'Most units of one item in a cart', 'maxQty', mode='numeric', hint='Larger orders can still be entered by staff.'), '<div class="mm-field"><label class="mm-label" for="mm-co-px">Order number prefix</label><input id="mm-co-px" class="mm-input" value="{{f.prefix.value}}" onChange="{{f.prefix.on}}"><p class="mm-hint">{{prefixHint}}</p></div>'),
             DIV, sw('Ask shoppers to accept the terms', 'terms', 'Needs a published terms page.'), sw('Shopper accounts', 'accounts', 'Shoppers can sign in with a code sent to their email, to see their orders and keep addresses. Guests can still order.')])),
        card('mm-c-cod', 'Cash on delivery', '\n'.join([sw('Offer cash on delivery', 'cod'),
             '<sc-if value="{{codOff}}" hint-placeholder-val="{{false}}"><div class="mm-banner" role="note" style="font-size: 13px">' + svg(ICONS['alert']) + '<p style="margin: 0">With cash on delivery off, only shoppers paying online can order.</p></div></sc-if>',
             '<sc-if value="{{codOn}}" hint-placeholder-val="{{true}}">' + '\n'.join([text('mm-co-cm', 'Highest order total for cash on delivery', 'codMax', prefix='৳', mode='decimal', hint='Leave empty for no limit.'),
             radios('mm-l-ca', 'Advance delivery charge', 'advances', 'ca', 3, hint='Paid online at checkout through SSLCommerz. Charges under ৳10 are left for delivery.'),
             radios('mm-l-ot', 'Confirm the phone with a code', 'otps', 'ot', 4, hint='The customer gets a code by SMS before the order is placed. Each code is one SMS from your gateway.')]) + '</sc-if>'])),
        card('mm-c-ol', 'Order limits', grid(text('mm-ol-h', 'Per phone, per hour', 'perHour', mode='numeric'), text('mm-ol-d', 'Per phone, per day', 'perDay', mode='numeric'), text('mm-ol-ip', 'Per connection, per hour', 'perIp', mode='numeric'), cols=3), sub='Orders placed on the storefront. Staff orders aren’t limited.'),
        card('mm-c-bl', 'Blocked phones', bl, sub='A blocked phone can’t order on the storefront. Staff are warned before entering an order for it.', gap='12px')])
    spage('SettingsCheckout', 'checkout', 'Checkout', 'What shoppers fill in, how they pay, and the limits that stop fake orders.', body, js=sread('checkout.js'))

def confirmation():
    script = ('<div style="display: flex; align-items: center; gap: 8px">' + chipsb('langs', 'lgs', 2) + '<span style="flex: 1"></span><button type="button" class="mm-btn mm-ghost" style="height: 30px; padding: 0 8px" onClick="{{togglePreview}}">' + svg(ICONS['eye'], 14) + 'Preview</button></div>'
              '<sc-if value="{{isBn}}" hint-placeholder-val="{{true}}"><textarea class="mm-textarea" aria-label="Call script in Bangla" style="min-height: 96px" value="{{f.scriptBn.value}}" onChange="{{f.scriptBn.on}}"></textarea></sc-if>'
              '<sc-if value="{{isEn}}" hint-placeholder-val="{{false}}"><textarea class="mm-textarea" aria-label="Call script in English" style="min-height: 96px" value="{{f.scriptEn.value}}" onChange="{{f.scriptEn.on}}"></textarea></sc-if>'
              '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px"><span class="mm-muted" style="font-size: 12px">Insert</span><sc-for list="{{placeholders}}" as="ph2" hint-placeholder-count="6"><button type="button" class="mm-chipq" style="height: 26px; font-family: ui-monospace, monospace; font-size: 12px" onClick="{{ph2.insert}}">{{ph2.label}}</button></sc-for></div>'
              '<sc-if value="{{preview}}" hint-placeholder-val="{{false}}"><p class="mm-script" style="margin: 0">{{previewText}}</p></sc-if>')
    body = '\n'.join([
        card('mm-c-cq', 'Confirmation queue', '\n'.join([sw('New cash-on-delivery orders wait in the queue to be called', 'queue', 'Staff call each one from Orders → Confirm and record what the customer said.'),
             '<sc-if value="{{queueOn}}" hint-placeholder-val="{{true}}">' + '\n'.join([sw('Orders paid in full online wait in the queue too', 'includePaid'),
             grid(text('mm-cq-ma', 'Unanswered calls before an order is unreachable', 'maxAttempts', mode='numeric'), text('mm-cq-ra', 'Minutes before an unanswered order is due again', 'retry', mode='numeric')),
             sw('Cancel an order when it becomes unreachable', 'cancelUnreachable', 'Off: the order waits under Unreachable for staff to decide.'), DIV,
             sw('Text new orders a link to confirm or cancel', 'smsLink', 'One SMS per order from your gateway. The link works for 48 hours.'), sw('Still call risky phones that confirm by link', 'callRisky', 'Their orders stay in the queue, marked “Confirmed by SMS: call first”.'),
             radios('mm-l-au', 'Confirm without a call', 'autos', 'au', 2)]) + '</sc-if>'])),
        card('mm-c-sc', 'Call script', script, sub='Shown in the call panel in the order’s language.', gap='12px'),
        card('mm-c-ic', 'Incomplete orders', '\n'.join([sw('Save checkouts shoppers leave, for staff to call', 'incomplete', 'Once a shopper types a valid mobile number. Nothing is ever sent to the shopper.'),
             '<sc-if value="{{incOn}}" hint-placeholder-val="{{true}}">' + grid(text('mm-ic-sa', 'Minutes after the last change before it shows', 'showAfter', mode='numeric'), text('mm-ic-kd', 'Days a saved checkout is kept', 'keepDays', mode='numeric', hint='30 at most.')) + '</sc-if>'])),
        card('mm-c-rp', 'Risky phones', grid(text('mm-rp-f', 'Deliveries that came back before a phone is risky', 'failedFlag', mode='numeric'), text('mm-rp-s', 'Lowest delivery score', 'minScore', suffix='%', mode='numeric', hint='Leave empty for no threshold.'), text('mm-rp-d', 'Orders needed before the score counts', 'minDecided', mode='numeric'), cols=3),
             sub='A risky phone is asked for the delivery charge in advance or a code by SMS, as you choose in Checkout.'),
        card('mm-c-du', 'Duplicate orders', text('mm-du-m', 'Minutes in which the same items from the same phone are a possible duplicate', 'dupMinutes', mode='numeric', hint='0 turns the check off. Staff merge, cancel or keep each one.'))])
    spage('SettingsConfirmation', 'confirmation', 'Order confirmation', 'How the store checks cash-on-delivery orders before they are sent.', body, js=sread('confirmation.js'))

def returns_s():
    body = card('mm-c-rs', 'Returns', '\n'.join([sw('Customers can ask for a return from the tracking page', 'requests'),
        '<sc-if value="{{reqOn}}" hint-placeholder-val="{{true}}">' + text('mm-rs-d', 'Days after delivery', 'days', mode='numeric', hint='1 to 90. Staff can start a return any time.') + '</sc-if>', DIV,
        multi('mm-l-sp', 'The customer pays the return delivery when the reason is', 'reasons', 'rsn', 6, hint='For other reasons the store pays.'),
        sw('Refund the delivery fee too', 'fee', 'Only when the whole order comes back for a reason the store pays for.'), DIV,
        checks('mm-l-rm', 'Refund methods offered', 'methods', 'rm', 7) + '<sc-if value="{{methodsBad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err" style="margin: -8px 0 0">Offer at least one.</p></sc-if>', DIV,
        multi('mm-l-ex', 'Not returnable', 'cats', 'ex', 6, hint='Products in these categories show “not returnable”, such as innerwear or food.')]))
    spage('SettingsReturns', 'returns', 'Returns', 'What customers can return from the tracking page, and how they get their money back.', body, js=sread('returns.js'))

def swb(p, aria, dis=None):
    d = ' disabled="{{%s}}"' % dis if dis else ''
    return '<button type="button" role="switch" class="mm-switch" aria-label="{{%s}}" aria-checked="{{%s.aria}}"%s onClick="{{%s.toggle}}" style="background: {{%s.bg}}"><span class="mm-knob" style="transform: translateX({{%s.x}})"></span></button>' % (aria, p, d, p, p, p)

def notifications():
    links = ('<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px"><a href="@@TPL@@" class="mm-scard" style="border: 1px solid var(--border); border-radius: 12px"><span class="mm-sico">' + svg(ICONS['pencil'], 16) + '</span><span style="display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 500">Message wording</span><span class="mm-muted" style="font-size: 13px">Change what each message says, in Bangla and English</span></span></a>'
             '<a href="@@LOG@@" class="mm-scard" style="border: 1px solid var(--border); border-radius: 12px"><span class="mm-sico">' + svg(ICONS['file'], 16) + '</span><span style="display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 500">Delivery log</span><span class="mm-muted" style="font-size: 13px">What was sent, skipped or failed in the last 90 days</span></span></a></div>')
    table = ('<div style="margin: 0 -20px"><div style="display: grid; grid-template-columns: minmax(0, 1fr) 64px 64px; align-items: center; height: 36px; padding: 0 20px; background: var(--muted); border-top: 1px solid var(--border); font-size: 13px; font-weight: 500; color: var(--muted-foreground)"><span>Update</span><span style="text-align: center">Email</span><span style="text-align: center">SMS</span></div>'
             '<sc-for list="{{events}}" as="ev2" hint-placeholder-count="10"><div style="display: grid; grid-template-columns: minmax(0, 1fr) 64px 64px; align-items: center; min-height: 44px; padding: 0 20px; border-top: 1px solid var(--border)"><span>{{ev2.label}}</span><span style="display: flex; justify-content: center">' + swb('ev2.email', 'ev2.emailAria') + '</span><span style="display: flex; justify-content: center">' + swb('ev2.sms', 'ev2.smsAria', 'ev2.smsDis') + '</span></div></sc-for></div>'
             '<sc-if value="{{smsOff}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; font-size: 13px">SMS goes out once you connect an SMS gateway.</p></sc-if>')
    email = ('<sc-if value="{{emailConn}}" hint-placeholder-val="{{true}}">' + statusline('{{emailText}}', '{{emailMeta}}') + '<div style="display: flex; gap: 8px"><button type="button" class="mm-btn mm-outline" onClick="{{openEmail}}">Change</button><button type="button" class="mm-btn mm-ghost mm-danger" onClick="{{removeEmail}}">Remove</button></div></sc-if>'
             '<sc-if value="{{emailOff}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline" style="align-self: flex-start" onClick="{{openEmail}}">' + svg(ICONS['mail']) + 'Use your own address</button></sc-if>')
    sms = ('<sc-if value="{{smsOn}}" hint-placeholder-val="{{true}}">' + statusline('{{smsText}}', '{{smsMeta}}') + '<div style="display: flex; gap: 8px"><button type="button" class="mm-btn mm-outline" onClick="{{openSms}}">Change</button><button type="button" class="mm-btn mm-ghost mm-danger" onClick="{{removeSms}}">Remove</button></div></sc-if>'
           '<sc-if value="{{smsOff}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0">Not connected. Order updates go by email only, and phone codes at checkout are off.</p><button type="button" class="mm-btn mm-primary" style="align-self: flex-start" onClick="{{openSms}}">Connect an SMS gateway</button></sc-if>')
    body = '\n'.join([links, card('mm-c-nu', 'Customer updates', table, sub='Email goes only to customers who gave an address. Each SMS costs you per message.', gap='12px'),
                      card('mm-c-ne', 'Your own email sender', email, sub='Send from your own address with your Resend or Brevo account. Without one, email goes from the platform’s address.', gap='12px'),
                      card('mm-c-ns', 'SMS gateway', sms, sub='Your own sms.net.bd or BulkSMSBD account, or any gateway that takes one HTTPS request per message.', gap='12px')])
    eb = '\n'.join(['<div class="mm-field"><span class="mm-label" id="mm-l-ep">Provider</span>' + chipsb('ep.providers', 'epv', 2, 'mm-l-ep') + '</div>',
                    '<div class="mm-field"><label class="mm-label" for="mm-ep-k">API key</label><input id="mm-ep-k" class="mm-input" type="password"></div>',
                    '<div class="mm-field"><label class="mm-label" for="mm-ep-f">From address</label><input id="mm-ep-f" class="mm-input" type="email" value="orders@nakshifashion.com.bd"><p class="mm-hint">Its domain must be verified with the provider.</p></div>',
                    '<div class="mm-field"><label class="mm-label" for="mm-ep-n">' + opt('From name') + '</label><input id="mm-ep-n" class="mm-input" placeholder="Nakshi Fashion"><p class="mm-hint">Your store’s name if empty.</p></div>'])
    sb = '\n'.join([radios('mm-l-sp2', 'Provider', 'sp.providers', 'spv', 3),
                    '<sc-if value="{{sp.notHttp}}" hint-placeholder-val="{{true}}"><div class="mm-field"><label class="mm-label" for="mm-sp-k">API key</label><input id="mm-sp-k" class="mm-input" type="password"></div><div class="mm-field"><label class="mm-label" for="mm-sp-s">' + opt('Sender ID') + '</label><input id="mm-sp-s" class="mm-input" value="NAKSHI"></div></sc-if>',
                    '<sc-if value="{{sp.isBulk}}" hint-placeholder-val="{{false}}"><div class="mm-banner" style="font-size: 13px">' + svg(ICONS['alert']) + '<p style="margin: 0">Turn off “IP whitelist” for the API in your BulkSMSBD account: the platform sends from changing addresses.</p></div></sc-if>',
                    '<sc-if value="{{sp.isHttp}}" hint-placeholder-val="{{false}}"><div class="mm-field"><label class="mm-label" for="mm-sp-u">Gateway URL</label><input id="mm-sp-u" class="mm-input" placeholder="https://"><p class="mm-hint">Must start with https://</p></div>'
                    '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px"><div class="mm-field"><label class="mm-label" for="mm-sp-t">Field for the number</label><input id="mm-sp-t" class="mm-input" value="to"></div><div class="mm-field"><label class="mm-label" for="mm-sp-m">Field for the text</label><input id="mm-sp-m" class="mm-input" value="message"></div></div>'
                    '<div class="mm-field"><label class="mm-label" for="mm-sp-ok">' + opt('Success text') + '</label><input id="mm-sp-ok" class="mm-input"><p class="mm-hint">Counted as sent only when the answer contains this.</p></div></sc-if>'])
    a, sv = dfoot_buttons('closeAll', 'ep.save', 'Check and save'); c, sv2 = dfoot_buttons('closeAll', 'sp.save', 'Check and save')
    extra_d = '\n' + dpanel('ep.open', 'closeAll', 'mm-ep-title', 'Your own email sender', '', eb, '', a, sv) + '\n' + dpanel('sp.open', 'closeAll', 'mm-sp-title', 'SMS gateway', 'Each message is charged to your account.', sb, '', c, sv2)
    extra_p = '\n' + pdrawer('ep.open', 'closeAll', 'mm-ep-title', 'Your own email sender', '', pbody(eb), pfoot('closeAll', 'ep.save', 'Check and save')) + '\n' + pdrawer('sp.open', 'closeAll', 'mm-sp-title', 'SMS gateway', '', pbody(sb), pfoot('closeAll', 'sp.save', 'Check and save'))
    spage('SettingsNotifications', 'notifications', 'Notifications', 'What customers hear about their orders, and how.', body.replace('@@TPL@@', 'SettingsTemplates.dc.html').replace('@@LOG@@', 'SettingsLog.dc.html'),
          body.replace('@@TPL@@', 'SettingsTemplatesPhone.dc.html').replace('@@LOG@@', 'SettingsLogPhone.dc.html').replace('grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px"><a', 'grid-template-columns: minmax(0, 1fr); gap: 8px"><a'), js=sread('notifications.js'), extra_d=extra_d, extra_p=extra_p)

def templates():
    msgs_d = ('<nav aria-label="Messages" style="display: flex; flex-direction: column; gap: 1px"><sc-for list="{{msgs}}" as="mg" hint-placeholder-count="8"><button type="button" class="mm-snav-a" aria-current="{{mg.cur}}" onClick="{{mg.pick}}">{{mg.label}}</button></sc-for></nav>')
    msgs_p = ('<nav aria-label="Messages" style="margin: 0 -12px; padding: 0 12px; overflow-x: auto; scrollbar-width: none"><div class="mm-tabs" style="height: 40px"><sc-for list="{{msgs}}" as="mg" hint-placeholder-count="8"><button type="button" class="mm-tab" aria-pressed="{{mg.on}}" onClick="{{mg.pick}}" style="height: 34px; padding: 0 12px">{{mg.label}}</button></sc-for></div></nav>')
    editor = '\n'.join([
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px"><div class="mm-field" style="gap: 6px"><span class="mm-label" id="mm-l-tc">Channel</span>' + chipsb('channels', 'tch', 2, 'mm-l-tc') + '</div><div class="mm-field" style="gap: 6px"><span class="mm-label" id="mm-l-tl">Language</span>' + chipsb('langs', 'tlg', 2, 'mm-l-tl') + '</div></div>',
        '<sc-if value="{{isEmail}}" hint-placeholder-val="{{false}}"><div class="mm-field"><label class="mm-label" for="mm-tp-s">Subject</label><input id="mm-tp-s" class="mm-input" value="{{subject.value}}" onChange="{{subject.on}}"></div></sc-if>',
        '<div class="mm-field"><label class="mm-label" for="mm-tp-b">Message</label><textarea id="mm-tp-b" class="mm-textarea" style="min-height: 110px" value="{{body.value}}" onChange="{{body.on}}"></textarea>'
        '<sc-if value="{{bad}}" hint-placeholder-val="{{false}}"><p class="mm-hint mm-err">{{badText}}</p></sc-if></div>',
        '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px"><span class="mm-muted" style="font-size: 12px">Insert</span><sc-for list="{{vars}}" as="tv" hint-placeholder-count="4"><button type="button" class="mm-chipq" style="height: 26px; font-family: ui-monospace, monospace; font-size: 12px" onClick="{{tv.insert}}">{{tv.label}}</button></sc-for></div>',
        '<div style="display: flex; align-items: center; gap: 8px"><span class="mm-muted" style="flex: 1; font-size: 13px">{{state}}</span><sc-if value="{{custom}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-ghost" style="height: 30px; padding: 0 8px" onClick="{{reset}}">' + svg(ICONS['undo'], 14) + 'Back to default</button></sc-if></div>'])
    preview = ('<section class="mm-card" aria-labelledby="mm-c-tpv" style="gap: 12px; background: var(--muted)"><h2 id="mm-c-tpv" class="mm-ctitle" style="font-size: 14px">Preview</h2>'
               '<sc-if value="{{isEmail}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-radius: 10px; background: var(--background); border: 1px solid var(--border)"><span style="font-weight: 600">{{previewSubject}}</span><span style="white-space: pre-line">{{preview}}</span></div></sc-if>'
               '<sc-if value="{{isSms}}" hint-placeholder-val="{{true}}"><div style="align-self: flex-start; max-width: 320px; padding: 10px 14px; border-radius: 16px 16px 16px 4px; background: var(--background); border: 1px solid var(--border); white-space: pre-line">{{preview}}</div><span class="mm-muted" style="font-size: 12px">{{smsCount}}</span></sc-if></section>')
    body_d = '<div style="display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 16px; align-items: start">' + '<section class="mm-card" style="padding: 8px">' + msgs_d + '</section><div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">' + card('mm-c-tp', '{{msgTitle}}', editor, gap='14px') + preview + '</div></div>'
    body_p = msgs_p + card('mm-c-tp', '{{msgTitle}}', editor, gap='14px') + preview
    spage('SettingsTemplates', 'templates', 'Message wording', 'Words in braces, like {order_number}, are filled in for each order.', body_d, body_p, js=sread('templates.js').replace("vals.isEmail = ch === 'email';", "vals.isEmail = ch === 'email'; vals.isSms = ch !== 'email';"), wide=True)

def log():
    filters = ('<div style="display: flex; flex-wrap: wrap; gap: 12px 20px"><div style="display: flex; align-items: center; gap: 8px"><span class="mm-label" style="font-size: 13px">Status</span>' + chipsb('statuses', 'lst', 5) + '</div>'
               '<div style="display: flex; align-items: center; gap: 8px"><span class="mm-label" style="font-size: 13px">Channel</span>' + chipsb('channels', 'lch', 4) + '</div></div>')
    rows_d = ('<div style="border: 1px solid var(--border); border-radius: 12px; background: var(--card)"><div style="display: grid; grid-template-columns: 120px minmax(0, 1fr) minmax(0, 1fr) 64px 110px 104px; align-items: center; gap: 12px; height: 38px; padding: 0 12px 0 16px; background: var(--muted); border-radius: 12px 12px 0 0; font-size: 13px; font-weight: 500; color: var(--muted-foreground)"><span>When</span><span>Message</span><span>To</span><span>Channel</span><span>Status</span><span></span></div>'
              '<sc-for list="{{rows}}" as="lg" hint-placeholder-count="10"><div style="display: grid; grid-template-columns: 120px minmax(0, 1fr) minmax(0, 1fr) 64px 110px 104px; align-items: center; gap: 12px; min-height: 52px; padding: 6px 12px 6px 16px; border-top: 1px solid var(--border); font-size: 13px">'
              '<span class="mm-muted" style="font-variant-numeric: tabular-nums">{{lg.when}}</span><span style="display: flex; flex-direction: column; min-width: 0"><span class="mm-trunc" style="font-weight: 500">{{lg.event}}</span><a href="Order.dc.html" class="mm-mono mm-muted" style="font-size: 12px">{{lg.order}}</a></span>'
              '<span class="mm-trunc">{{lg.to}}</span><span>{{lg.channel}}</span><span style="display: flex; flex-direction: column; gap: 2px; align-items: flex-start">' + sbadge('lg.chip') + '<sc-if value="{{lg.hasReason}}" hint-placeholder-val="{{false}}"><span class="mm-muted" style="font-size: 11px; line-height: 14px">{{lg.reason}}</span></sc-if></span>'
              '<span style="display: flex; justify-content: flex-end"><sc-if value="{{lg.failed}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline" style="height: 30px" onClick="{{lg.resend}}">Send again</button></sc-if></span></div></sc-for>'
              '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; padding: 24px 16px; text-align: center">No messages here.</p></sc-if></div>'
              '<button type="button" class="mm-btn mm-outline" style="align-self: center" onClick="{{more}}">Show more</button>')
    rows_p = ('<ul class="mm-plist" aria-label="Messages"><sc-for list="{{rows}}" as="lg" hint-placeholder-count="10"><li><div class="mm-prow" style="align-items: flex-start; gap: 10px; padding: 10px 12px">'
              '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px"><span style="display: flex; align-items: center; gap: 8px"><span class="mm-trunc" style="font-weight: 500">{{lg.event}}</span>' + sbadge('lg.chip') + '</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{lg.channel}} · {{lg.to}}</span><span class="mm-muted" style="font-size: 12px">{{lg.order}} · {{lg.when}}</span>'
              '<sc-if value="{{lg.hasReason}}" hint-placeholder-val="{{false}}"><span style="font-size: 12px; color: var(--destructive)">{{lg.reason}}</span></sc-if></span>'
              '<sc-if value="{{lg.failed}}" hint-placeholder-val="{{false}}"><button type="button" class="mm-btn mm-outline" style="height: 32px; flex: none" onClick="{{lg.resend}}">Send again</button></sc-if></div></li></sc-for></ul>'
              '<sc-if value="{{empty}}" hint-placeholder-val="{{false}}"><p class="mm-muted" style="margin: 0; padding: 24px 16px; text-align: center">No messages here.</p></sc-if>')
    spage('SettingsLog', 'log', 'Delivery log', 'Every message from the last 90 days. A failed one can be sent again.', filters + rows_d, filters.replace('display: flex; align-items: center; gap: 8px"><span', 'display: flex; align-items: center; gap: 8px; overflow-x: auto"><span') + rows_p, js=sread('log.js'), bar=False, wide=True)

def billing():
    plan = ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px"><div style="display: flex; flex-direction: column; gap: 2px"><span style="display: flex; align-items: center; gap: 8px"><span style="font-size: 18px; font-weight: 600">{{plan.name}}</span>' + sbadge('plan.chip') + '</span><span class="mm-muted" style="font-size: 13px">{{plan.price}} · {{plan.day}}</span></div></div>'
            '<sc-if value="{{overdue}}" hint-placeholder-val="{{false}}"><div class="mm-banner mm-bad" role="alert" style="font-size: 13px">' + svg(ICONS['alert']) + '<p style="margin: 0">Invoice INV-2026-0042 is overdue. Pay it to keep taking orders after 4 Nov.</p></div></sc-if>')
    meters = ('<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px"><sc-for list="{{meters}}" as="mt" hint-placeholder-count="6"><div style="display: flex; flex-direction: column; gap: 6px"><div class="mm-kv" style="font-size: 13px"><span>{{mt.label}}</span><span style="font-weight: 500">{{mt.text}}</span></div>'
              '<span class="mm-meter" role="img" aria-label="{{mt.label}}: {{mt.text}}"><span style="width: {{mt.pct}}; background: {{mt.color}}"></span></span><sc-if value="{{mt.hasNote}}" hint-placeholder-val="{{false}}"><span style="font-size: 12px; font-weight: 500; color: {{mt.noteColor}}">{{mt.note}}</span></sc-if></div></sc-for></div>')
    invs = ('<ul style="list-style: none; margin: 0 -20px; padding: 0"><sc-for list="{{invoices}}" as="in2" hint-placeholder-count="4"><li style="display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 6px 12px 6px 20px; border-top: 1px solid var(--border)">'
            '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column"><span class="mm-mono" style="font-weight: 500">{{in2.number}}</span><span class="mm-trunc mm-muted" style="font-size: 13px">{{in2.period}} · due {{in2.due}}</span></span>' + sbadge('in2.chip') +
            '<span style="width: 72px; text-align: right; font-weight: 500; font-variant-numeric: tabular-nums">{{in2.amount}}</span><button type="button" class="mm-btn mm-ghost" style="height: 32px" aria-label="{{in2.aria}}" aria-haspopup="dialog" onClick="{{in2.view}}">View</button></li></sc-for></ul>')
    pay = ('<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px">'
           + ''.join('<div style="display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px"><span class="mm-label">%s</span><span style="font-size: 13px; white-space: pre-line">%s</span></div>' % (a, b2) for a, b2 in [('Bank transfer', 'ManageMind Ltd.\nCity Bank, Gulshan\nA/C 1502 7781 0042'), ('bKash', 'Merchant 01755-000555\nPayment, not send money'), ('Nagad', 'Merchant 01755-000555')])
           + '</div>')
    body = '\n'.join([card('mm-c-bp', 'Plan', plan, gap='12px'), card('mm-c-bu', 'Use this period', meters, sub='5 Oct to 4 Nov, counted up to yesterday.'), card('mm-c-bi', 'Invoices', invs, gap='8px'),
                      card('mm-c-bh', 'How to pay', pay, sub='Pay by bank transfer, bKash or Nagad, with the invoice number as the reference. We mark the invoice paid when the money arrives.')])
    ib = ('<dl class="mm-dl" style="grid-template-columns: 100px minmax(0, 1fr)"><dt>Period</dt><dd>{{iv.period}}</dd><dt>Plan</dt><dd>Growth</dd><dt>Amount</dt><dd style="font-weight: 600">{{iv.amount}}</dd><dt>Due</dt><dd>{{iv.due}}</dd></dl>'
          '<p class="mm-muted" style="margin: 0; font-size: 13px">Paid just now? It can take a minute to show here.</p>')
    extra_d = '\n' + ('<sc-if value="{{iv.open}}" hint-placeholder-val="{{false}}"><div style="position: fixed; inset: 0; z-index: 80"><button type="button" tabindex="-1" class="mm-scrim" aria-label="Close" onClick="{{closeInv}}" style="position: absolute; background: rgb(0 0 0 / .5)"></button>'
                      '<div role="dialog" aria-modal="true" aria-labelledby="mm-iv-t" class="mm-dialog" style="max-width: 440px; gap: 16px"><h2 id="mm-iv-t" style="margin: 0; font-size: 18px; font-weight: 600">{{iv.title}}</h2>' + ib +
                      '<div style="display: flex; flex-wrap: wrap-reverse; justify-content: flex-end; gap: 8px"><button type="button" class="mm-btn mm-outline" onClick="{{closeInv}}">Close</button><button type="button" class="mm-btn mm-outline" onClick="{{iv.print}}">' + svg(ICONS['printer']) + 'Print</button>'
                      '<sc-if value="{{iv.isOpen}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" onClick="{{iv.pay}}">{{iv.payText}}</button></sc-if></div></div></div></sc-if>')
    extra_p = '\n' + pdrawer('iv.open', 'closeInv', 'mm-iv-t', '{{iv.title}}', '', pbody(ib), '<div style="flex: none; display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border)"><button type="button" class="mm-btn mm-outline" style="flex: 1" onClick="{{iv.print}}">Print</button><sc-if value="{{iv.isOpen}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary" style="flex: 2" onClick="{{iv.pay}}">{{iv.payText}}</button></sc-if></div>', tall=False)
    spage('SettingsBilling', 'billing', 'Plan and billing', 'Your plan, this period’s use, our invoices and how to pay.', body, js=sread('billing.js'), extra_d=extra_d, extra_p=extra_p, bar=False, crumbs=[('Settings', 'Settings.dc.html'), ('Plan and billing', '')])

ALL = {'index': index, 'store': store, 'domains': domains, 'staff': staff, 'location': location, 'vat': vat, 'payments': payments,
       'delivery': delivery, 'couriers': couriers, 'checkout': checkout, 'confirmation': confirmation, 'returns': returns_s,
       'notifications': notifications, 'templates': templates, 'log': log, 'billing': billing}
