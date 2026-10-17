// An order's four statuses as chips (phase-4-plan §3.6, §7): its own, its
// payment, its delivery and, for shipments, the shipment's. Colour is never
// the only signal: each chip says its status in words.
import { type AdminKey, useLocale } from '../i18n';

type Kind = 'order' | 'payment' | 'delivery' | 'shipment';

const PREFIX: Record<Kind, string> = {
  order: 'orderStatus',
  payment: 'paymentStatus',
  delivery: 'deliveryStatus',
  shipment: 'shipmentStatus',
};

const GOOD = new Set(['completed', 'paid', 'delivered', 'confirmed']);
const BAD = new Set(['cancelled', 'failed', 'returned', 'voided']);
const WAITING = new Set(['pending', 'unpaid', 'not_shipped', 'partially_paid']);

export function StatusChip({ kind, status }: { kind: Kind; status: string }) {
  const { t } = useLocale();
  const tone = GOOD.has(status)
    ? 'bg-success/15 text-success'
    : BAD.has(status)
      ? 'bg-danger/10 text-danger'
      : WAITING.has(status)
        ? 'bg-warning text-warning-foreground'
        : 'bg-primary/10 text-primary';
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {t(`${PREFIX[kind]}.${status}` as AdminKey)}
    </span>
  );
}
