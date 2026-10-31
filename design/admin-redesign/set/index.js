var START = { Settings: {}, 'Find a setting': { q: 'cour' }, 'No match': { q: 'printer' } };
var ITEMS = [
  ['Store', 'store', 'Store profile', 'Name, language, and how customers reach you.', 'store', 'SettingsStore', 'Done'],
  ['Store', 'domains', 'Domains', 'Your store’s addresses. Connect your own domain, such as www.yourshop.com.bd.', 'globe', 'SettingsDomains', ''],
  ['Store', 'staff', 'Staff', 'Who can work in this store, and what they can do.', 'users', 'SettingsStaff', ''],
  ['Store', 'location', 'Stock location', 'Where your stock is kept', 'warehouse', 'SettingsLocation', ''],
  ['Selling', 'payments', 'Payments', 'Online payment with your SSLCommerz account', 'card', 'SettingsPayments', 'Done'],
  ['Selling', 'delivery', 'Delivery', 'Zones, fees and the areas each covers', 'truck', 'SettingsDelivery', 'Done'],
  ['Selling', 'couriers', 'Couriers', 'Book parcels with Steadfast, Pathao or RedX, and follow them', 'package', 'SettingsCouriers', ''],
  ['Selling', 'checkout', 'Checkout', 'Checkout fields, cash on delivery, limits and blocked phones', 'cart', 'SettingsCheckout', ''],
  ['Selling', 'confirmation', 'Order confirmation', 'Risky phones, duplicate orders, the confirmation queue and incomplete orders.', 'phone', 'SettingsConfirmation', ''],
  ['Selling', 'vat', 'VAT', 'Whether you charge VAT, and the rates', 'percent', 'SettingsVat', ''],
  ['Selling', 'returns', 'Returns', 'How long customers can return, who pays, and how refunds go', 'undo', 'SettingsReturns', ''],
  ['Messages', 'notifications', 'Notifications', 'Messages to customers, their wording, and the delivery log', 'bell', 'SettingsNotifications', 'To do: email to customers'],
  ['Plan and data', 'billing', 'Plan and billing', 'Your plan, this period’s use, our invoices and how to pay', 'receipt', 'SettingsBilling', '']
];
var GROUPS = ['Store', 'Selling', 'Messages', 'Plan and data'];
class Component extends DCLogic {
  renderVals() {
    var b = boot(this, START, 'Settings');
    var s = b.s, up = b.up, toast = b.toast, vals = b.vals;
    var q = (s.q || '').trim().toLowerCase();
    var hit = ITEMS.filter(function (x) { return !q || (x[2] + ' ' + x[3]).toLowerCase().indexOf(q) !== -1; });
    vals.groups = GROUPS.map(function (g) {
      return { label: g, items: hit.filter(function (x) { return x[0] === g; }).map(function (x) {
        var it = { title: x[2], desc: x[3], href: P(x[5]), status: x[6], hasStatus: Boolean(x[6]), statusColor: x[6] === 'Done' ? 'var(--success)' : 'var(--warn)' };
        ['store', 'globe', 'users', 'warehouse', 'card', 'truck', 'package', 'cart', 'phone', 'percent', 'undo', 'bell', 'receipt'].forEach(function (k) { it['is_' + k] = x[4] === k; });
        return it;
      }) };
    }).filter(function (g) { return g.items.length; });
    vals.none = hit.length === 0;
    vals.q = s.q || ''; vals.onQ = function (e) { up({ q: e.target.value }); };
    vals.clearQ = function () { up({ q: '' }); };
    return vals;
  }
}
