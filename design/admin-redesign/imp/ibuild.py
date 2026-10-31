import os, sys, re, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'plat'))
from pbuild import *
from pages import empty_block

ICONS['upload'] = '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M12 12v6"></path><path d="m15 15-3-3-3 3"></path>'

KINDS = {
 'customers': dict(board='CustomerImport', title='Import customers', list='Customers', listLabel='Customers', crumbs=[('Customers', 'Customers.dc.html'), ('Import', '')], nav='Customers',
   intro='Add or update customers from a spreadsheet. Customers are matched by phone; a WooCommerce customer export works as it is.',
   help='Columns are recognized in English or Bangla: name (or first and last name), phone, email, address, area, district, tags, note.',
   conf=dict(file='woocommerce-customers.csv', rows=342, valid=331, part=180, need='Phone', missing='The file needs a phone column and a name column.', readyLabel='Customers ready',
     cols=['Name', 'Phone', 'Email', 'Address', 'Area', 'District', 'Tags'], start='Import 331 customers', progress='Importing: 180 of 331 customers…',
     doneText='331 customers imported: 298 added, 33 updated by phone.',
     problems=[[14, 'Phone', 'Not a Bangladeshi mobile number: “01812-34”.'], [27, 'Name', 'Empty. Every customer needs a name.'], [55, 'Phone', 'Same phone as row 12.'], [88, 'Email', 'Not an email address: “nasrin@”.'],
               [130, 'Phone', 'Empty. Customers are matched by phone.'], [171, 'Phone', 'Same phone as row 166.'], [204, 'Name', 'Empty. Every customer needs a name.'], [239, 'Phone', 'Not a Bangladeshi mobile number: “+44 7700 900123”.'],
               [260, 'Email', 'Not an email address: “rumana.gmail.com”.'], [301, 'Phone', 'Same phone as row 12.'], [318, 'Name', 'Longer than 100 characters.']],
     warnings=[[102, 'District', '“Chitagong” isn’t a district we know; the address is kept as written.'], [143, 'Tags', 'More than 10 tags; the first 10 are kept.']])),
 'suppliers': dict(board='SupplierImport', title='Import suppliers', list='Suppliers', listLabel='Suppliers', crumbs=[('Inventory', 'Inventory.dc.html'), ('Suppliers', 'Suppliers.dc.html'), ('Import', '')], nav='suppliers',
   intro='A CSV or Excel file with a row per supplier, and what the store owed each one the day it started here. Nothing is saved until you confirm.',
   help='Columns: name (needed), phone, contact, email, address, city, note, opening balance. Headers in English or Bangla.',
   conf=dict(file='suppliers-opening.xlsx', rows=24, valid=22, part=12, need='Name', missing='The file needs a name column.', readyLabel='Suppliers ready',
     cols=['Name', 'Phone', 'Contact', 'Address', 'City', 'Opening balance'], start='Import 22 rows', progress='Importing: 12 of 22 rows…',
     doneText='21 imported. 1 was already in the store and was skipped.',
     problems=[[9, 'Opening balance', 'Not a number: “৳ 12,000/-”.'], [17, 'Name', 'Empty. Every supplier needs a name.']],
     warnings=[[21, 'Name', 'Rahman Textiles is already in the store; this row is skipped.']])),
 'expenses': dict(board='ExpenseImport', title='Import expenses', list='Expenses', listLabel='Expenses', crumbs=[('Expenses', 'Expenses.dc.html'), ('Import', '')], nav='Expenses',
   intro='Expenses from the months before the store moved here, so a year’s reports are complete. Nothing is saved until you confirm.',
   help='Columns: date (YYYY-MM-DD or DD/MM/YYYY), category, amount (both needed), paid by, paid to, note. Headers in English or Bangla.',
   conf=dict(file='expenses-jan-jun-2026.csv', rows=186, valid=181, part=96, need='Amount', missing='The file needs a date and an amount column.', readyLabel='Expenses ready',
     cols=['Date', 'Category', 'Amount', 'Paid by', 'Paid to', 'Note'], start='Import 181 rows', progress='Importing: 96 of 181 rows…',
     doneText='181 imported. 0 were already in the store and were skipped.',
     problems=[[33, 'Date', 'Not a date: “31/02/2026”.'], [48, 'Amount', 'Empty. Every expense needs an amount.'], [77, 'Amount', 'Not a number: “৳4,500 (approx)”.'], [120, 'Date', 'Empty. Every expense needs a date.'], [158, 'Amount', 'Below zero. Record refunds as their own category.']],
     warnings=[[64, 'Category', 'New category “Generator fuel” will be added.'], [91, 'Paid by', '“Bkash” is read as bKash.'], [140, 'Note', 'Longer than 500 characters; the rest is cut.']])),
}

def ihead(k, title, crumbs):
    h = dhead_for(None, crumbs, title)
    if k['nav'] == 'suppliers':
        h = h.replace(B.inv_group(None), B.inv_group('suppliers'), 1)
    else:
        h = h.replace(B.inv_group(None), B.m.group(0).replace('href="#"', 'href="Inventory.dc.html"'), 1)
        lab = k['nav']
        m = re.search(r'<li><a href="[^"]*" class="mm-nav">(<svg(?:(?!</svg>).)*</svg>)' + lab + '</a></li>', h)
        h = h.replace(m.group(0), '<li><a href="%s.dc.html" class="mm-nav" aria-current="page">%s%s</a></li>' % (lab, m.group(1), lab), 1)
    i = h.rindex('</style>')
    return h[:i] + OCSS + RCSS + SCSS + WCSS + HCSS + PCSS_PLAT + h[i:]

def body(k, phone):
    steps = '<ol class="mm-steps" aria-label="Steps"><sc-for list="{{steps}}" as="st" hint-placeholder-count="3"><li data-s="{{st.s}}" aria-current="{{st.cur}}"><span class="mm-sdot" aria-hidden="true"><sc-if value="{{st.done}}" hint-placeholder-val="{{false}}">' + svg(ICONS['check'], 12).replace('stroke-width="2"', 'stroke-width="3"') + '</sc-if><sc-if value="{{st.todo}}" hint-placeholder-val="{{true}}">{{st.n}}</sc-if></span><span class="mm-trunc">{{st.label}}</span></li></sc-for></ol>'
    choose = ('<sc-if value="{{isChoose}}" hint-placeholder-val="{{true}}"><section class="mm-card" aria-label="Choose a file" style="gap: 14px"><sc-if value="{{err}}" hint-placeholder-val="{{false}}"><div role="alert" class="mm-alert mm-alert-bad">' + svg(ICONS['alert']) + '<p style="margin: 0">This file couldn’t be read. Save it as .xlsx or .csv and try again.</p></div></sc-if>'
              '<div style="display: flex; flex-direction: column; align-items: center; gap: 10px; padding: %s; border: 1px dashed var(--input); border-radius: 10px; text-align: center"><span class="mm-sico" style="width: 40px; height: 40px; border-radius: 9999px">' % ('24px 16px' if phone else '32px 24px') + svg(ICONS['upload'] if 'upload' in ICONS else ICONS['download'], 18) + '</span>'
              '<p style="margin: 0; font-weight: 600">Drop a spreadsheet here, or choose one</p><p class="mm-muted" style="margin: 0; max-width: 460px; font-size: 13px">' + k['help'] + '</p><button type="button" class="mm-btn mm-primary" onClick="{{choose}}">Choose a file</button></div></section></sc-if>')
    stats = '<dl class="mm-figs" aria-label="Summary" style="margin: 0; grid-template-columns: repeat(3, minmax(0, 1fr))"><sc-for list="{{stats}}" as="sx" hint-placeholder-count="3"><div class="mm-fig"><dt>{{sx.label}}</dt><dd style="color: {{sx.color}}">{{sx.value}}</dd></div></sc-for></dl>'
    if phone:
        stats = stats.replace('repeat(3, minmax(0, 1fr))', 'repeat(3,minmax(0,1fr))').replace('class="mm-fig"', 'class="mm-fig" style="padding: 10px 12px"')
        probs = ('<ul aria-label="Problems" style="list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden"><sc-for list="{{problems}}" as="pr" hint-placeholder-count="6"><li style="display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-top: 1px solid var(--border)">'
                 '<span style="display: flex; align-items: center; gap: 8px; font-size: 13px"><span style="font-weight: 600">Row {{pr.row}}</span><span class="mm-muted">· {{pr.col}}</span><span style="margin-left: auto">' + sbadge('pr.kind') + '</span></span><span style="font-size: 13px">{{pr.text}}</span></li></sc-for></ul>')
    else:
        probs = table('64px 160px minmax(0, 1fr) 96px', ['Row', 'Column', 'Problem', ''], 'problems', 'pr', '<span style="font-variant-numeric: tabular-nums">{{pr.row}}</span><span class="mm-trunc">{{pr.col}}</span><span>{{pr.text}}</span><span style="justify-self: end">' + sbadge('pr.kind') + '</span>', 6, 'Problems')
    check = ('<sc-if value="{{isCheck}}" hint-placeholder-val="{{false}}"><section class="mm-card" aria-labelledby="mm-ck-h" style="gap: 14px"><div class="mm-chead"><h2 id="mm-ck-h" class="mm-ctitle">Before importing</h2><span class="mm-muted mm-trunc" style="font-size: 13px">{{file}} · {{rowsText}}</span></div>'
             '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px"><span class="mm-muted" style="font-size: 13px">Columns found:</span><sc-for list="{{cols}}" as="cl" hint-placeholder-count="6"><span class="mm-badge-sec">{{cl.label}}</span></sc-for></div>'
             '<sc-if value="{{missing}}" hint-placeholder-val="{{false}}"><div role="alert" class="mm-alert mm-alert-bad">' + svg(ICONS['alert']) + '<p style="margin: 0">{{missingText}} Add it to the file and choose it again.</p></div></sc-if>'
             '<sc-if value="{{notMissing}}" hint-placeholder-val="{{true}}">' + stats + '<div class="mm-banner mm-bad" role="note">' + svg(ICONS['alert']) + '<p style="margin: 0">{{summary}}</p></div>' + probs
             + '<button type="button" class="mm-btn mm-outline" style="align-self: flex-start" onClick="{{download}}">' + svg(ICONS['download']) + 'Download the problems (.csv)</button><p class="mm-muted" style="margin: 0; font-size: 13px">Nothing changes until you start.</p></sc-if>'
             '<div style="display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding-top: 4px"><button type="button" class="mm-btn mm-outline"%s onClick="{{cancel}}">Cancel</button><sc-if value="{{canStart}}" hint-placeholder-val="{{true}}"><button type="button" class="mm-btn mm-primary"%s onClick="{{start}}">{{startText}}</button></sc-if></div></section></sc-if>'
             % ((' style="flex: 1"', ' style="flex: 2"') if phone else ('', '')))
    job = ('<sc-if value="{{isJob}}" hint-placeholder-val="{{false}}"><section class="mm-card" aria-label="Import" style="gap: 14px"><sc-if value="{{running}}" hint-placeholder-val="{{true}}"><div style="display: flex; flex-direction: column; gap: 8px"><p role="status" style="margin: 0; font-weight: 500">{{progress}}</p>'
           '<span class="mm-meter" aria-hidden="true"><span style="display: block; height: 100%; width: {{pct}}; background: var(--primary)"></span></span><p class="mm-muted" style="margin: 0; font-size: 13px">You can leave this page; the import keeps going.</p>'
           '<button type="button" class="mm-btn mm-ghost" style="align-self: flex-start; height: 28px; padding: 0 8px; margin-left: -8px" onClick="{{finish}}">Skip to the end</button></div></sc-if>'
           '<sc-if value="{{done}}" hint-placeholder-val="{{false}}"><div style="display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0; text-align: center"><span class="mm-chk" data-done="true" style="width: 40px; height: 40px" aria-hidden="true">' + svg(ICONS['check'], 20).replace('stroke-width="2"', 'stroke-width="3"') + '</span>'
           '<p style="margin: 0; font-weight: 600">{{doneText}}</p><div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 8px"><button type="button" class="mm-btn mm-outline" onClick="{{again}}">Import another file</button><a href="{{listHref}}" class="mm-btn mm-primary">Open {{listLabel}}</a></div></div></sc-if></section></sc-if>')
    denied = '<sc-if value="{{denied}}" hint-placeholder-val="{{false}}"><div class="mm-note">' + svg(ICONS['lock']) + '<p style="margin: 0">You don’t have permission to import these.</p></div></sc-if>'
    return denied + '<sc-if value="{{allowed}}" hint-placeholder-val="{{true}}"><div style="display: flex; flex-direction: column; gap: 16px">' + steps + choose + check + job + '</div></sc-if>'

def build(key):
    k = KINDS[key]
    js = 'var CONF = ' + json.dumps(dict(k['conf'], list=k['list'], listLabel=k['listLabel']), ensure_ascii=False) + ';\n' + open('imp/imp.js', encoding='utf-8').read()
    jsall = RSHARED + sread('shared.js') + pread('shared.js') + js
    act = '<button type="button" class="mm-btn mm-outline" onClick="{{sample}}">' + svg(ICONS['download']) + 'Download a sample file</button>'
    head = ('<div style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px"><div style="display: flex; align-items: flex-start; gap: 12px; min-width: 0; flex: 1 1 420px"><a href="%s.dc.html" class="mm-btn mm-ghost mm-icon" aria-label="Back to %s" style="margin-left: -8px">' % (k['list'], k['listLabel'].lower())
            + svg(ICONS['back']) + '</a><div style="display: flex; flex-direction: column; gap: 4px; min-width: 0"><h1 style="margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em">%s</h1><p class="mm-muted" style="margin: 0">%s</p></div></div>%s</div>' % (k['title'], k['intro'], act))
    d = '\n'.join([MAIN, '<div style="display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 760px; margin: 0 auto">', head, body(k, False), '</div>']) + DEND + XEND
    ph = '\n'.join([PROOT % 'var(--background)', phone_back(k['list'] + 'Phone.dc.html', 'Back to ' + k['listLabel'].lower(), k['title']), '<main class="mm-scroll" style="gap: 12px; padding: 12px">',
                    '<p class="mm-muted" style="margin: 0; font-size: 13px">%s</p>' % k['intro'], body(k, True).replace('mm-steps"', 'mm-steps" style="font-size: 12px"').replace('<div class="mm-chead"><h2 id="mm-ck-h"', '<div style="display: flex; flex-direction: column; gap: 2px"><h2 id="mm-ck-h"'),
                    '<button type="button" class="mm-btn mm-ghost" style="align-self: center" onClick="{{sample}}">' + svg(ICONS['download']) + 'Download a sample file</button>', '</main>']) + '\n@@PTOAST0@@\n\n</div>\n</x-dc>\n'
    opts = js_starts(js)
    write(k['board'], ihead(k, k['title'], k['crumbs']), rexpand(d), jsall, props(opts, opts[0]), 'mm mm-root')
    write(k['board'] + 'Phone', pphead(k['title']), expand(ph, True), jsall, props(opts, opts[0], True), 'mm')

if __name__ == '__main__':
    for key in sys.argv[1:] or list(KINDS):
        build(key); print('built', key)
