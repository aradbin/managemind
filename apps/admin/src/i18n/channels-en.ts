// Settings → Meta (phase-9-plan §3.1.4, §3.1.6).
export const channelsEn = {
  'meta.intro':
    'Show your products on Facebook and Instagram, and tell Meta about your sales so your ads reach buyers.',
  'meta.feed': 'Product feed',
  'meta.feed.intro':
    'Meta reads your products from this address, for your Facebook and Instagram shop and for catalog ads. Each variant is listed with its price, stock and pictures.',
  'meta.feed.on': 'Publish the product feed',
  'meta.feed.urls': 'Feed address',
  'meta.feed.urlDefault': 'In your store’s language',
  'meta.feed.urlBn': 'In Bangla',
  'meta.feed.urlEn': 'In English',
  'meta.feed.steps':
    'In Commerce Manager, open your catalog and choose Data sources → Add items → Data feed → Scheduled feed. Paste the address and choose Hourly.',
  'meta.feed.copy': 'Copy',
  'meta.feed.copied': 'Copied',
  'meta.feed.builtAt': 'Last built {date}: {count} item(s).',
  'meta.feed.notBuilt': 'The feed is being built. Check again in a minute.',
  'meta.feed.pending': 'Changes since {date} will be in the next build, within 15 minutes.',
  'meta.feed.skipped.no_image': '{count} variant(s) left out: no picture.',
  'meta.feed.skipped.no_price': '{count} variant(s) left out: no price.',
  'meta.feed.error': 'The last build failed: {error}',
  'meta.feed.rebuild': 'Rebuild now',
  'meta.feed.rebuilding': 'The feed will be rebuilt in a minute.',
  'meta.feed.rotate': 'Change the address',
  'meta.feed.rotateConfirm':
    'The current address will stop working. You’ll need to paste the new one into Commerce Manager.',
  'meta.feed.rotated': 'The address changed. Paste the new one into Commerce Manager.',
  'meta.events': 'Sales reported to Meta',
  'meta.purchaseAt': 'Report a purchase',
  'meta.purchaseAt.placed': 'When the order is placed, as the pixel does',
  'meta.purchaseAt.confirmed':
    'When the order is confirmed, so ads learn from real orders, not fake ones',
  'meta.deliveredEvent': 'Also report deliveries',
  'meta.deliveredEvent.hint':
    'A custom “Delivered” event with the delivered value, for ads that aim at sales that were paid for.',
  'meta.save': 'Save',
  'meta.saved': 'Saved.',
} as const;
