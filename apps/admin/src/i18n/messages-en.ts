// Alerts, messages and templates (phase-5a-plan §7), loaded with their screens.
export const messagesEn = {
  'alerts.title': 'Alerts',
  'alerts.intro': 'Choose what this store alerts you about, and how.',
  'alerts.device': 'Alerts on this device',
  'alerts.device.on': 'Turn on alerts on this device',
  'alerts.device.test': 'Send a test alert',
  'alerts.device.tested': 'Test sent to {count} device(s).',
  'alerts.device.remove': 'Remove',
  'alerts.device.unknown': 'Unknown device',
  'alerts.device.none': 'No device gets alerts yet.',
  'alerts.device.this': 'This device',
  'alerts.device.unsupported': 'This browser can’t receive alerts.',
  'alerts.device.ios':
    'On an iPhone or iPad, first add this app to the Home Screen (Share → Add to Home Screen), then open it from there.',
  'alerts.device.denied':
    'Alerts are blocked for this site. Allow notifications in the browser’s settings, then try again.',
  'alerts.device.off': 'Push alerts aren’t set up for the platform yet. Email alerts still work.',
  'alerts.choices': 'What to be alerted about',
  'alerts.channel.push': 'Push',
  'alerts.channel.email': 'Email',
  'alerts.saved': 'Saved.',
  'alerts.event.new_order': 'New order',
  'alerts.event.online_payment': 'Online payment received',
  'alerts.event.shopper_cancelled': 'Shopper cancelled an order',
  'alerts.event.return_requested': 'Return requested',
  'alerts.event.payment_problem': 'A payment needs checking',
} as const;
