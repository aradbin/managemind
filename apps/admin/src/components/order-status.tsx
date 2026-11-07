// An order's four statuses as chips (phase-4-plan §3.6, §7): its own, its
// payment, its delivery and, for shipments, the shipment's. Colour is never
// the only signal: each chip says its status in words.
import { type AdminKey, useLocale } from '../i18n';
import { StatusBadge, type Tone } from './ui/badge';

type Kind = 'order' | 'payment' | 'delivery' | 'shipment';

const PREFIX: Record<Kind, string> = {
  order: 'orderStatus',
  payment: 'paymentStatus',
  delivery: 'deliveryStatus',
  shipment: 'shipmentStatus',
};

const TONE: Record<string, Tone> = {
  pending: 'waiting',
  partially_paid: 'waiting',
  requested: 'waiting',
  unpaid: 'ended',
  not_shipped: 'ended',
  confirmed: 'progress',
  processing: 'progress',
  booked: 'progress',
  approved: 'progress',
  received: 'progress',
  inspected: 'progress',
  shipped: 'moving',
  in_transit: 'moving',
  partially_shipped: 'moving',
  completed: 'good',
  paid: 'good',
  delivered: 'good',
  resolved: 'good',
  failed: 'bad',
  returned: 'bad',
  rejected: 'bad',
  cancelled: 'ended',
  voided: 'ended',
  refunded: 'ended',
  partially_refunded: 'ended',
};

export function StatusChip({ kind, status }: { kind: Kind; status: string }) {
  const { t } = useLocale();
  return (
    <StatusBadge tone={TONE[status] ?? 'progress'}>
      {t(`${PREFIX[kind]}.${status}` as AdminKey)}
    </StatusBadge>
  );
}
