# Re-apply cross-board navigation links on every board (safe to run any time).
import glob, re
P = 'canvas/project/'
SVG = r'(<svg(?:(?!</svg>).)*</svg>)'
DESK = [('Home', 'Home.dc.html', SVG + 'Home</a></li>'), ('Orders', 'Orders.dc.html', SVG + r'(<span style="flex: 1">Orders</span>)'),
        ('Reports', 'Reports.dc.html', SVG + r'(<span style="flex: 1">Reports</span>)'), ('Inventory', 'Inventory.dc.html', SVG + r'(<span style="flex: 1">Inventory</span>)'),
        ('Settings', 'Settings.dc.html', SVG + 'Settings</a></li>'),
        ('Customers', 'Customers.dc.html', SVG + 'Customers</a></li>'), ('Promotions', 'Promotions.dc.html', SVG + 'Promotions</a></li>'), ('Expenses', 'Expenses.dc.html', SVG + 'Expenses</a></li>'), ('Online store', 'OnlineStore.dc.html', SVG + r'(<span style="flex: 1">Online store</span>)')]
TABS = [('M15 21', 'HomePhone.dc.html'), ('M6 2', 'OrdersPhone.dc.html')]
n = 0
for f in glob.glob(P + '*.dc.html'):
    t = open(f, encoding='utf-8').read(); o = t
    for name, href, tail in DESK:
        t = re.sub(r'<li><a href="#" class="mm-nav"( aria-expanded="[^"]*")?>' + tail, lambda m: '<li><a href="%s" class="mm-nav"%s>' % (href, m.group(1) or '') + m.group(0).split('>', 2)[2], t)
    for path, href in TABS:
        t = re.sub(r'<a href="#" class="mm-tabitem"( aria-current="page")?><span class="mm-pill"><svg([^>]*)><path d="' + path, lambda m: '<a href="%s" class="mm-tabitem"%s><span class="mm-pill"><svg%s><path d="%s' % (href, m.group(1) or '', m.group(2), path), t)
    if t != o:
        open(f, 'w', encoding='utf-8').write(t); n += 1
print('wired', n)
# The phone Menu's flat rows.
MROWS = {'Home': 'HomePhone.dc.html', 'Customers': 'CustomersPhone.dc.html', 'Promotions': 'PromotionsPhone.dc.html', 'Expenses': 'ExpensesPhone.dc.html', 'Settings': 'SettingsPhone.dc.html'}
for f in glob.glob(P + '*Phone.dc.html') + [P + 'Phone.dc.html']:
    t = open(f, encoding='utf-8').read(); o = t
    for lab, href in MROWS.items():
        t = re.sub(r'<a href="#" class="mm-mrow"([^>]*)>((?:(?!</a>).)*?)' + lab + '<', lambda m: '<a href="%s" class="mm-mrow"%s>%s%s<' % (href, m.group(1), m.group(2), lab), t)
    if t != o:
        open(f, 'w', encoding='utf-8').write(t); print('menu rows', f)

# Main's Online store sub-items and the phone menu's store items.
f = P + 'Main.dc.html'; t = open(f, encoding='utf-8').read(); o = t
for lab, href in [('Theme', 'Theme'), ('Pages', 'StorePages'), ('Store settings', 'StoreSettings')]:
    t = t.replace('<li><a href="#" class="mm-subbtn">%s</a></li>' % lab, '<li><a href="%s.dc.html" class="mm-subbtn">%s</a></li>' % (href, lab))
if t != o: open(f, 'w', encoding='utf-8').write(t); print('main store items')
f = P + 'Phone.dc.html'; t = open(f, encoding='utf-8').read(); o = t
t = t.replace("store: { title: 'Online store', items: [\n    { label: 'Theme' }, { label: 'Pages' }, { label: 'Store settings' }", "store: { title: 'Online store', items: [\n    { label: 'Theme', href: 'ThemePhone.dc.html' }, { label: 'Pages', href: 'StorePagesPhone.dc.html' }, { label: 'Store settings', href: 'StoreSettingsPhone.dc.html' }")
if t != o: open(f, 'w', encoding='utf-8').write(t); print('phone store items')
# Main's Platform sub-items and the phone menu's platform items.
PLAT = [('Stores', 'PlatformStores'), ('Dashboard', 'PlatformDashboard'), ('Billing', 'PlatformBilling'), ('Courier areas', 'CourierAreas'), ('Terms', 'PlatformTerms'), ('Platform staff', 'PlatformStaff'), ('Audit log', 'AuditLog')]
f = P + 'Main.dc.html'; t = open(f, encoding='utf-8').read(); o = t
i = t.find('<h2 id="mm-platform-label"')
if i != -1:
    j = t.find('</ul></sc-if>', i)
    seg = t[i:j]
    for lab, href in PLAT:
        seg = seg.replace('<li><a href="#" class="mm-subbtn">%s</a></li>' % lab, '<li><a href="%s.dc.html" class="mm-subbtn">%s</a></li>' % (href, lab))
    t = t[:i] + seg + t[j:]
if t != o: open(f, 'w', encoding='utf-8').write(t); print('main platform items')
f = P + 'Phone.dc.html'; t = open(f, encoding='utf-8').read(); o = t
t = t.replace("platform: { title: 'Platform', items: [\n    " + ", ".join("{ label: '%s' }" % l for l, _ in PLAT), "platform: { title: 'Platform', items: [\n    " + ", ".join("{ label: '%s', href: '%sPhone.dc.html' }" % (l, h) for l, h in PLAT))
if t != o: open(f, 'w', encoding='utf-8').write(t); print('phone platform items')
# The Import buttons on Customers, Suppliers and Expenses open their import pages.
for name, target in [('Customers', 'CustomerImport'), ('Suppliers', 'SupplierImport'), ('Expenses', 'ExpenseImport')]:
    f = P + name + '.dc.html'; t = open(f, encoding='utf-8').read(); o = t
    t = re.sub(r'<a href="#" class="mm-btn mm-outline">(<svg(?:(?!</svg>).)*?<path d="m15 15-3-3-3 3"></path></svg>)Import</a>', lambda m: '<a href="%s.dc.html" class="mm-btn mm-outline">%sImport</a>' % (target, m.group(1)), t)
    if t != o: open(f, 'w', encoding='utf-8').write(t); print('import link', name)
f = P + 'CustomersPhone.dc.html'; t = open(f, encoding='utf-8').read(); o = t
t = re.sub(r'<a href="#"([^>]*)>(<svg(?:(?!</svg>).)*?</svg>)Import customers</a>', lambda m: '<a href="CustomerImportPhone.dc.html"%s>%sImport customers</a>' % (m.group(1), m.group(2)), t)
if t != o: open(f, 'w', encoding='utf-8').write(t); print('import link customers phone')
# The header avatar opens the signed-in owner's account.
AV_OLD = '<button type="button" class="mm-avatar" aria-label="Account menu for Rahim Ahmed" title="Rahim Ahmed">RA</button>'
AV_NEW = '<a href="Account.dc.html" class="mm-avatar" aria-label="Your account: Rafiq Ahmed" title="Rafiq Ahmed" style="text-decoration: none">RA</a>'
n = 0
for f in glob.glob(P + '*.dc.html'):
    t = open(f, encoding='utf-8').read()
    if AV_OLD in t:
        open(f, 'w', encoding='utf-8').write(t.replace(AV_OLD, AV_NEW)); n += 1
if n: print('avatar links', n)
