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

/** Each tone is a background and text pair from the colour tokens. */
const TONES = {
  waiting: 'bg-warning text-warning-foreground',
  progress: 'bg-info text-info-foreground',
  moving: 'bg-shipped text-shipped-foreground',
  good: 'bg-success-soft text-success',
  bad: 'bg-danger-soft text-danger',
  ended: 'bg-muted text-muted-foreground',
};

const TONE: Record<string, keyof typeof TONES> = {
  pending: 'waiting',
  unpaid: 'waiting',
  not_shipped: 'waiting',
  partially_paid: 'waiting',
  requested: 'waiting',
  confirmed: 'progress',
  processing: 'progress',
  shipped: 'moving',
  partially_shipped: 'moving',
  completed: 'good',
  paid: 'good',
  delivered: 'good',
  failed: 'bad',
  returned: 'bad',
  cancelled: 'ended',
  voided: 'ended',
  refunded: 'ended',
  partially_refunded: 'ended',
};

export function StatusChip({ kind, status }: { kind: Kind; status: string }) {
  const { t } = useLocale();
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium before:size-1.5 before:rounded-full before:bg-current ${TONES[TONE[status] ?? 'progress']}`}
    >
      {t(`${PREFIX[kind]}.${status}` as AdminKey)}
    </span>
  );
}
