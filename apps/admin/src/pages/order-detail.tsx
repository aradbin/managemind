// One order (phase-4-plan §7): its four statuses, lines with discounts,
// totals, the customer, payments, shipments and the timeline, with only the
// actions the state machines allow (the API lists them). Every command sends
// an Idempotency-Key, kept for the dialog's life, so a retry after a dropped
// connection doesn't do it twice.

import { type CancelCode, type Courier, MANUAL_METHODS } from '@managemind/shared/orders';
import { formatPhone } from '@managemind/shared/phone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  Banknote,
  Check,
  CircleX,
  FileText,
  Link2,
  Package,
  PackageOpen,
  Phone,
  Plus,
  Printer,
  SquarePen,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { BookDialog, CourierPanel } from '../components/courier-booking';
import { Field } from '../components/field';
import { fieldLabel } from '../components/field-styles';
import { RowMenu, RowMenuItem, RowMenuSeparator } from '../components/list-tools';
import { Notice } from '../components/notice';
import { StatusChip } from '../components/order-status';
import { BackLink } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { ScoreBadge, useRiskCounts } from '../components/risk';
import { SendByChat } from '../components/send-by-chat';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { CardSection, cardFrame, cardPadded, cardTitle } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Input, Textarea } from '../components/ui/input';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/returns';
import { RefundDialog } from '../components/refund-dialog';
import { api, unwrap } from '../lib/api';
import { formatPrice, priceInput, readPrice, storeSettingsQuery } from '../lib/catalog';
import { courierName, couriersQuery, orderedCouriers } from '../lib/couriers';
import { useRecordPage } from '../lib/crumb';
import { errorMessage } from '../lib/errors';
import {
  dateTime,
  idempotencyKey,
  lineLabel,
  type OrderDetail,
  orderErrorMessage,
  orderQuery,
  pickText,
  placeLine,
  type Shipment,
  withKey,
} from '../lib/orders';
import { cn } from '../lib/utils';
import { EditOrderDialog } from './order-edit';
import { Thumbnail } from './products';
import { CreateReturnDialog } from './return-detail';
import { ReturnStatusChip } from './returns';

/** A command's mutation: refreshes the order, the list and the dashboard after. */
function useCommand<T>(orderId: string, run: (key: string, input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState(idempotencyKey);
  const mutation = useMutation({
    mutationFn: (input: T) => run(key, input),
    onSuccess: async () => {
      setKey(idempotencyKey());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
  });
  return mutation;
}

const section = cardPadded;

export function OrderDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { t } = useLocale();
  const order = useQuery(orderQuery(id));
  useRecordPage(order.data && t('order.title', { number: order.data.displayNumber }));
  if (order.isPending) return <p role="status">{t('loading')}</p>;
  if (order.isError) return <Notice tone="error">{errorMessage(order.error, t)}</Notice>;
  return <OrderView order={order.data} />;
}

// Where each card sits on phones, where the two columns become one (the
// canvas's phone order board); desktops keep the columns' own order.
const phoneOrder = {
  customer: 'max-md:order-1',
  lines: 'max-md:order-2',
  payments: 'max-md:order-3',
  shipments: 'max-md:order-4',
  returns: 'max-md:order-5',
  confirmation: 'max-md:order-6',
  tags: 'max-md:order-7',
  others: 'max-md:order-8',
  timeline: 'max-md:order-9',
} as const;
const slot = (at: keyof typeof phoneOrder) => cn('flex flex-col empty:hidden', phoneOrder[at]);

function OrderView({ order: o }: { order: OrderDetail }) {
  const { t, locale } = useLocale();
  const actions = useOrderActions(o);
  const title = t('order.title', { number: o.displayNumber });
  const placed = t('order.placedOn', {
    date: dateTime(locale, o.placedAt),
    source: t(`source.${o.source}` as AdminKey),
  });
  const chips = (
    <span className="flex flex-wrap gap-1.5">
      <StatusChip kind="order" status={o.status} />
      <StatusChip kind="payment" status={o.paymentStatus} />
      <StatusChip kind="delivery" status={o.deliveryStatus} />
    </span>
  );
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PhoneRecordHeader to="/orders" backLabel={t('order.backToOrders')} title={title}>
        {actions.menu('ghost')}
      </PhoneRecordHeader>
      <div className="flex flex-wrap items-center gap-3 max-md:hidden">
        <BackLink to="/orders" label={t('order.backToOrders')} />
        <h1 className="text-xl leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
        {chips}
        <span className="flex-1" />
        <div className="flex items-center gap-2">
          {actions.primary}
          {actions.menu('outline')}
        </div>
      </div>
      <p className="-mt-2 text-muted-foreground max-md:hidden">{placed}</p>
      <section aria-label={t('order.summary')} className={cn(cardPadded, 'gap-2.5 md:hidden')}>
        {chips}
        <div className="flex flex-col">
          <p className="text-2xl leading-8 font-semibold tracking-[-0.02em] tabular-nums">
            {formatPrice(o.totals.total, locale)}
          </p>
          <p className="text-[13px] text-muted-foreground">{dueLine(o, t, locale)}</p>
        </div>
        <p className="text-xs text-muted-foreground">{placed}</p>
        {actions.primary && <div className="flex [&>button]:flex-1">{actions.primary}</div>}
      </section>
      {actions.overlays}
      {o.flags.includes('payment_risk') && <Notice tone="error">{t('order.flag.risk')}</Notice>}
      {o.flags.includes('flagged_phone') && (
        <Notice tone="error">
          {t('order.flag.phone')}{' '}
          <Link to="/customers/$id" params={{ id: o.customer.id }} className="underline">
            {t('order.flag.phoneLink')}
          </Link>
        </Notice>
      )}
      {o.flags.includes('late_payment') && <Notice tone="error">{t('order.flag.late')}</Notice>}
      {o.flags.includes('possible_duplicate') && o.duplicateOf && <DuplicateBanner order={o} />}
      {o.status === 'cancelled' && (
        <Notice>
          {t(o.cancelledBy === 'shopper' ? 'order.cancelledByShopper' : 'order.cancelledByStaff', {
            reason: o.cancelReason ?? '—',
          })}
          {o.cancelCode && o.cancelledBy !== 'shopper' && ` (${t(`cancelCode.${o.cancelCode}`)})`}
        </Notice>
      )}
      <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 max-md:contents lg:col-start-2 lg:row-start-1">
          <div className={slot('customer')}>
            <CustomerCard order={o} />
          </div>
          <div className={slot('confirmation')}>
            <ConfirmationCard order={o} />
          </div>
          <div className={slot('tags')}>
            <Tags order={o} />
          </div>
          <div className={slot('others')}>
            <OtherOpenOrders order={o} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4 max-md:contents lg:col-start-1 lg:row-start-1">
          <div className={slot('lines')}>
            <Lines order={o} />
          </div>
          <div className={slot('payments')}>
            <Payments order={o} />
          </div>
          <div className={slot('shipments')}>
            <Shipments order={o} />
          </div>
          <div className={slot('returns')}>
            <ReturnsAndRefunds order={o} />
          </div>
          <div className={slot('timeline')}>
            <Timeline order={o} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** What is left to settle, under the total on phones. */
function dueLine(
  o: OrderDetail,
  t: ReturnType<typeof useLocale>['t'],
  locale: ReturnType<typeof useLocale>['locale'],
): string {
  const tt = o.totals;
  const money = (n: number) => formatPrice(n, locale);
  if (o.status === 'cancelled') return t('orderStatus.cancelled');
  if (tt.codDue > 0)
    return o.address
      ? t('order.toCollectLine', { amount: money(tt.codDue) })
      : t('order.stillToPay', { amount: money(tt.codDue) });
  if (tt.refundDue > 0) return t('order.dueBack', { amount: money(tt.refundDue) });
  return t('order.paidInFull');
}

/** The phone's other open orders, when it has any: worth a look before confirming. */
function OtherOpenOrders({ order: o }: { order: OrderDetail }) {
  const { t, locale } = useLocale();
  if (!o.otherOpenOrders.length) return null;
  return (
    <CardSection title={t('risk.otherOpen')}>
      <ul className="-my-2.5 flex flex-col divide-y divide-border">
        {o.otherOpenOrders.map((other) => (
          <li key={other.id} className="flex items-center gap-2 py-2.5">
            <Link
              to="/orders/$id"
              params={{ id: other.id }}
              className="font-mono font-medium tracking-[0.02em]"
            >
              {other.displayNumber}
            </Link>
            <StatusChip kind="order" status={other.status} />
            <span className="ms-auto tabular-nums">{formatPrice(other.total, locale)}</span>
          </li>
        ))}
      </ul>
    </CardSection>
  );
}

/**
 * A possible duplicate (phase-6-plan §3.4): merge it into the older order,
 * cancel it as a duplicate, or say it isn't one. Shoppers hear about none.
 */
function DuplicateBanner({ order: o }: { order: OrderDetail }) {
  const { t } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const canWrite = usePermission('orders.write');
  const other = o.duplicateOf as NonNullable<OrderDetail['duplicateOf']>;
  const merge = useCommand(o.id, async (key) =>
    unwrap(
      await api.POST('/v1/admin/orders/{id}/duplicate/merge', {
        params: { path: { id: o.id }, ...withKey(key).params },
      }),
    ),
  );
  const cancel = useCommand(o.id, async (key) =>
    unwrap(
      await api.POST('/v1/admin/orders/{id}/cancel', {
        params: { path: { id: o.id }, ...withKey(key).params },
        body: {
          reason: t('duplicate.cancelReason', { number: other.displayNumber }),
          code: 'duplicate',
        },
      }),
    ),
  );
  const dismiss = useCommand(o.id, async () =>
    unwrap(
      await api.POST('/v1/admin/orders/{id}/duplicate/dismiss', { params: { path: { id: o.id } } }),
    ),
  );
  const busy = merge.isPending || cancel.isPending || dismiss.isPending;
  const error = merge.error ?? cancel.error ?? dismiss.error;
  return (
    <div role="status" className="rounded-lg bg-warning p-3 text-sm text-warning-foreground md:p-4">
      <span className="flex flex-col gap-3">
        <span>
          {t('duplicate.banner')}{' '}
          <Link to="/orders/$id" params={{ id: other.id }} className="font-medium underline">
            {other.displayNumber}
          </Link>{' '}
          ({t(`orderStatus.${other.status}` as AdminKey)})
        </span>
        {canWrite && o.status !== 'cancelled' && (
          <span className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              // Awaited, not mutate's onSuccess: the refreshed order has no
              // duplicate left, so this banner is gone before that would run.
              onClick={() =>
                merge.mutateAsync(undefined).then(
                  () => {
                    toast(t('duplicate.merged', { number: other.displayNumber }));
                    void navigate({ to: '/orders/$id', params: { id: other.id } });
                  },
                  () => undefined, // shown below from merge.error
                )
              }
            >
              {t('duplicate.merge', { number: other.displayNumber })}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                cancel.mutateAsync(undefined).then(
                  () => toast(t('order.cancelled')),
                  () => undefined,
                )
              }
            >
              {t('duplicate.cancel')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => dismiss.mutate(undefined)}>
              {t('duplicate.dismiss')}
            </Button>
          </span>
        )}
        {error && <span className="text-danger">{orderErrorMessage(error, t)}</span>}
      </span>
    </div>
  );
}

/**
 * The order's next step and its ⋯ menu (the canvas: one primary action plus
 * ⋯). The page places them in the desktop header, and on phones in the
 * record header and the summary card; the panels they open render once.
 */
function useOrderActions(o: OrderDetail) {
  const { t } = useLocale();
  const toast = useToast();
  const [dialog, setDialog] = useState<'cancel' | 'edit' | 'ship' | 'pay' | null>(null);
  const [booking, setBooking] = useState<Courier | null>(null);
  const couriers = useBookingCouriers();
  const confirm = useCommand(o.id, async (key) =>
    unwrap(
      await api.POST('/v1/admin/orders/{id}/confirm', {
        params: { path: { id: o.id }, ...withKey(key).params },
      }),
    ),
  );
  const process = useCommand(o.id, async (key) =>
    unwrap(
      await api.POST('/v1/admin/orders/{id}/process', {
        params: { path: { id: o.id }, ...withKey(key).params },
      }),
    ),
  );
  const has = (a: string) => o.actions.includes(a);
  const error = confirm.error ?? process.error;
  const canShip = has('create_shipment') && o.lines.some((l) => l.shippedQuantity < l.quantity);
  // The next step in the order's life.
  const primary = has('confirm') ? (
    <Button
      disabled={confirm.isPending}
      onClick={() => confirm.mutate(undefined, { onSuccess: () => toast(t('order.confirmed')) })}
    >
      <Check aria-hidden />
      {t('order.confirm')}
    </Button>
  ) : canShip && couriers[0] ? (
    <Button onClick={() => setBooking(couriers[0] as Courier)}>
      <Truck aria-hidden />
      {t('couriers.book', { courier: courierName(couriers[0], t) })}
    </Button>
  ) : canShip ? (
    <Button onClick={() => setDialog('ship')}>{t('order.createShipment')}</Button>
  ) : null;
  const print = (doc: 'invoice' | 'slip') =>
    window.open(`/print/orders?${new URLSearchParams({ ids: o.id, doc })}`, '_blank', 'noopener');
  const menu = (trigger: 'outline' | 'ghost') => (
    <RowMenu label={t('list.moreActions')} trigger={trigger} page>
      {has('edit') && (
        <RowMenuItem onSelect={() => setDialog('edit')}>
          <SquarePen aria-hidden />
          {t('order.editOrder')}
        </RowMenuItem>
      )}
      {has('record_payment') && o.paymentStatus !== 'paid' && (
        <RowMenuItem onSelect={() => setDialog('pay')}>
          <Banknote aria-hidden />
          {t('order.recordPayment')}
        </RowMenuItem>
      )}
      {has('process') && (
        <RowMenuItem
          disabled={process.isPending}
          onSelect={() =>
            process.mutate(undefined, { onSuccess: () => toast(t('order.processed')) })
          }
        >
          <PackageOpen aria-hidden />
          {t('order.startProcessing')}
        </RowMenuItem>
      )}
      {canShip &&
        !has('confirm') &&
        couriers.slice(1).map((c) => (
          <RowMenuItem key={c} onSelect={() => setBooking(c)}>
            <Truck aria-hidden />
            {t('couriers.book', { courier: courierName(c, t) })}
          </RowMenuItem>
        ))}
      {canShip && (has('confirm') || couriers.length > 0) && (
        <RowMenuItem onSelect={() => setDialog('ship')}>
          <Package aria-hidden />
          {t('order.createShipment')}
        </RowMenuItem>
      )}
      <RowMenuItem onSelect={() => print('invoice')}>
        <Printer aria-hidden />
        {t('orders.printInvoice')}
      </RowMenuItem>
      <RowMenuItem onSelect={() => print('slip')}>
        <FileText aria-hidden />
        {t('orders.printSlip')}
      </RowMenuItem>
      {has('cancel') && (
        <>
          <RowMenuSeparator />
          <RowMenuItem danger onSelect={() => setDialog('cancel')}>
            <CircleX aria-hidden />
            {t('orders.cancelOrder')}
          </RowMenuItem>
        </>
      )}
    </RowMenu>
  );
  const overlays = (
    <>
      {error && <Notice tone="error">{orderErrorMessage(error, t)}</Notice>}
      {dialog === 'cancel' && <CancelDialog order={o} onClose={() => setDialog(null)} />}
      {dialog === 'ship' && <ShipmentDialog order={o} onClose={() => setDialog(null)} />}
      {dialog === 'pay' && <PaymentDialog order={o} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <EditOrderDialog order={o} onClose={() => setDialog(null)} />}
      {booking && <BookDialog order={o} courier={booking} onClose={() => setBooking(null)} />}
    </>
  );
  return { primary, menu, overlays };
}

/** The couriers staff can book with, the store's default first (phase-7-plan §3.8). */
function useBookingCouriers(): Courier[] {
  const canWrite = usePermission('orders.write');
  const couriers = useQuery({ ...couriersQuery, enabled: canWrite });
  const store = useQuery({ ...storeSettingsQuery, enabled: canWrite });
  if (!canWrite) return [];
  return orderedCouriers(couriers.data, store.data?.couriers.default ?? null);
}

function Lines({ order: o }: { order: OrderDetail }) {
  const { t, locale } = useLocale();
  const money = (n: number) => formatPrice(n, locale);
  const tt = o.totals;
  const rows: [string, ReactNode][] = [
    [t('order.subtotal'), money(tt.subtotal)],
    ...o.adjustments
      .filter((a) => a.target !== 'delivery')
      .map((a): [string, ReactNode] => [
        [pickText(a.title, locale), a.code ? `(${a.code})` : '', a.reason ? `— ${a.reason}` : '']
          .filter(Boolean)
          .join(' '),
        `−${money(a.amount)}`,
      ]),
    [
      o.zone.name
        ? t('order.deliveryTo', { zone: pickText(o.zone.name, locale) })
        : t('order.delivery'),
      tt.deliveryDiscount
        ? `${money(tt.deliveryFee - tt.deliveryDiscount)} (${t('order.was', { amount: money(tt.deliveryFee) })})`
        : money(tt.deliveryFee),
    ],
    ...(tt.vatTotal
      ? [
          [t(tt.vatIncluded ? 'order.vatIncluded' : 'order.vat'), money(tt.vatTotal)] as [
            string,
            ReactNode,
          ],
        ]
      : []),
    ...(tt.rounding ? [[t('order.rounding'), money(tt.rounding)] as [string, ReactNode]] : []),
  ];
  const canEdit = o.actions.includes('edit');
  const [editing, setEditing] = useState(false);
  const count = o.lines.reduce((n, l) => n + l.quantity, 0);
  const kv = 'flex justify-between gap-3 tabular-nums';
  return (
    <section
      aria-labelledby="lines-title"
      className={cn(cardFrame, 'flex flex-col gap-2 pt-4 pb-4 md:gap-3 md:pt-5')}
    >
      <div className="flex min-h-5 items-center gap-3 px-4 md:px-5">
        <h2 id="lines-title" className={cardTitle}>
          {t('order.items')}
        </h2>
        <span className="flex-1 text-[13px] text-muted-foreground">
          <span className="max-md:hidden">
            {count === 1 ? t('order.oneItem') : t('order.itemCount', { count })}
          </span>
        </span>
        {canEdit && (
          <Button
            variant="ghost"
            className="-my-1 -mr-2 h-7 px-2 md:h-7"
            onClick={() => setEditing(true)}
          >
            {t('order.editShort')}
          </Button>
        )}
      </div>
      <ul aria-label={t('order.items')}>
        {o.lines.map((l) => (
          <li
            key={l.id}
            className="mx-4 grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-2.5 border-b border-border py-2.5 last:border-b-0 md:mx-0 md:min-h-15 md:grid-cols-[40px_minmax(0,1fr)_120px_96px] md:gap-x-3 md:border-t md:border-b-0 md:px-5 md:py-2"
          >
            <Thumbnail file={l.image?.files[0]?.file} size="size-10" />
            <span className="flex min-w-0 flex-col">
              <Link
                to="/products/$id"
                params={{ id: l.productId }}
                className="truncate font-medium"
              >
                {pickText(l.title, locale)}
              </Link>
              <span className="truncate text-xs text-muted-foreground md:hidden">
                {l.quantity} × {money(l.unitPrice)}
              </span>
              <span className="truncate text-[13px] text-muted-foreground max-md:hidden">
                {[
                  l.optionLabels
                    .map((x) => pickText(x, locale))
                    .filter(Boolean)
                    .join(' / '),
                  l.sku,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span className="hidden text-right text-muted-foreground tabular-nums md:block">
              {l.quantity} × {money(l.unitPrice)}
            </span>
            <span className="text-right font-medium tabular-nums">
              {money(l.total)}
              {l.discount > 0 && (
                <span className="block text-xs font-normal text-success-foreground">
                  −{money(l.discount)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="mx-4 border-t border-border pt-2.5 md:mx-0 md:ml-auto md:w-full md:max-w-[340px] md:px-5 md:pt-3">
        <dl className="flex flex-col gap-1.5">
          {rows.map(([label, value]) => (
            <div key={label} className={kv}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <div className={cn(kv, 'mt-1.5 border-t border-border pt-2.5 font-semibold')}>
            <dt>{t('order.total')}</dt>
            <dd>{money(tt.total)}</dd>
          </div>
          {tt.paidTotal > 0 && (
            <div className={kv}>
              <dt className="text-muted-foreground">{t('order.paid')}</dt>
              <dd className="text-success-foreground">−{money(tt.paidTotal)}</dd>
            </div>
          )}
          {tt.codDue > 0 && (
            <div className={cn(kv, 'font-semibold')}>
              <dt>{t('order.codDue')}</dt>
              <dd>{money(tt.codDue)}</dd>
            </div>
          )}
          {tt.refundDue > 0 && (
            <div className={cn(kv, 'font-semibold text-danger')}>
              <dt>{t('order.refundDue')}</dt>
              <dd>{money(tt.refundDue)}</dd>
            </div>
          )}
        </dl>
      </div>
      {editing && <EditOrderDialog order={o} onClose={() => setEditing(false)} />}
    </section>
  );
}

/** Whether a payment link can still be sent for the order. */
const unpaid = (o: OrderDetail) =>
  o.status !== 'cancelled' && o.status !== 'completed' && o.totals.paidTotal < o.totals.total;

function CustomerCard({ order: o }: { order: OrderDetail }) {
  const { t, locale } = useLocale();
  const canCustomers = usePermission('customers.read');
  const canPay = usePermission('payments.read') && usePermission('orders.write');
  const block = 'flex flex-col gap-1 border-t border-border pt-3';
  return (
    <section aria-labelledby="customer-title" className={cn(section, 'gap-3.5 md:gap-3.5')}>
      <h2 id="customer-title" className={cardTitle}>
        {t('order.customer')}
      </h2>
      <div className="flex flex-col gap-0.5">
        {canCustomers ? (
          <Link
            to="/customers/$id"
            params={{ id: o.customer.id }}
            className="font-medium underline decoration-border underline-offset-[3px]"
          >
            {o.contact.name}
          </Link>
        ) : (
          <span className="font-medium">{o.contact.name}</span>
        )}
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {[
            canCustomers ? formatPhone(o.contact.phone) : o.contact.phone,
            o.customer.orderCount <= 1
              ? t('order.firstOrder')
              : t('order.orderCount', {
                  count: o.customer.orderCount,
                  amount: formatPrice(o.customer.totalSpent, locale),
                }),
          ].join(' · ')}
        </span>
        {o.contact.email && (
          <span className="text-[13px] text-muted-foreground">{o.contact.email}</span>
        )}
      </div>
      {canCustomers && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" asChild>
            <a href={`tel:${o.contact.phone}`}>
              <Phone aria-hidden />
              {t('order.call')}
            </a>
          </Button>
          <SendByChat orderId={o.id} canPay={canPay && unpaid(o)} />
        </div>
      )}
      <div className={block}>
        <span className={fieldLabel}>{t('order.deliveryAddress')}</span>
        {o.address ? (
          <>
            <address className="not-italic">
              {o.address.line}, {placeLine(o.address.names, locale)},{' '}
              {pickText(o.address.names.division, locale)}
            </address>
            {o.zone.name && (
              <span className="text-[13px] text-muted-foreground">
                {pickText(o.zone.name, locale)} ·{' '}
                {t('order.deliveryFee', { amount: formatPrice(o.totals.deliveryFee, locale) })}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">{t('order.noDelivery')}</span>
        )}
      </div>
      {o.customerNote && (
        <div className={block}>
          <span className={fieldLabel}>{t('order.customerNoteLabel')}</span>
          <span className="whitespace-pre-line">{o.customerNote}</span>
        </div>
      )}
      {!canCustomers && <p className="text-xs text-muted-foreground">{t('order.masked')}</p>}
    </section>
  );
}

/** Where the order is in the confirmation queue, or how it was confirmed (phase-6-plan §3.5). */
function ConfirmationCard({ order: o }: { order: OrderDetail }) {
  const { t, locale } = useLocale();
  const c = o.confirmation;
  const counts = useRiskCounts();
  const toast = useToast();
  const canWrite = usePermission('orders.write');
  const resend = useCommand(o.id, async () =>
    unwrap(
      await api.POST('/v1/admin/orders/{id}/confirmation/link', { params: { path: { id: o.id } } }),
    ),
  );
  return (
    <section aria-labelledby="confirmation-title" className={cn(section, 'gap-3 md:gap-3')}>
      <h2 id="confirmation-title" className={cardTitle}>
        {t('order.confirmationRecord')}
      </h2>
      {c && (
        <div className="flex flex-col gap-0.5">
          <span>
            {c.confirmedVia
              ? t(`confirmedVia.${c.confirmedVia}` as AdminKey)
              : o.flags.includes('unreachable')
                ? t('queue.tab.unreachable')
                : c.inQueue
                  ? c.dueAt && Date.parse(c.dueAt) > Date.now()
                    ? t('queue.dueAt', { time: dateTime(locale, c.dueAt) })
                    : t('queue.tab.to_call')
                  : t('confirmation.notQueued')}
          </span>
          {c.attempts > 0 && (
            <span className="text-[13px] text-muted-foreground">
              {t('queue.attempts', { count: c.attempts })}
            </span>
          )}
          {c.linkSentAt && (
            <span className="text-[13px] text-muted-foreground">
              {c.linkAnswer
                ? t(
                    c.linkAnswer === 'confirm'
                      ? 'queue.linkConfirmed'
                      : 'confirmation.linkCancelled',
                  )
                : t('confirmation.linkSent', { time: dateTime(locale, c.linkSentAt) })}
            </span>
          )}
        </div>
      )}
      {c?.inQueue && !c.confirmedVia && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <Link to="/orders/confirm">{t('confirmation.openQueue')}</Link>
          </Button>
          {canWrite && c.linkSentAt && !c.linkAnswer && (
            <Button
              variant="ghost"
              disabled={resend.isPending}
              onClick={() =>
                resend.mutate(undefined, { onSuccess: () => toast(t('confirmation.linkResent')) })
              }
            >
              {t('confirmation.resend')}
            </Button>
          )}
        </div>
      )}
      <div className={cn('flex flex-wrap items-center gap-2', c && 'border-t border-border pt-3')}>
        <ScoreBadge risk={o.risk} />
        <span className="text-[13px] text-muted-foreground">{counts(o.risk)}</span>
      </div>
      {resend.error && <Notice tone="error">{orderErrorMessage(resend.error, t)}</Notice>}
    </section>
  );
}

function Shipments({ order: o }: { order: OrderDetail }) {
  const { t } = useLocale();
  const couriers = useBookingCouriers();
  const [dialog, setDialog] = useState(false);
  const [booking, setBooking] = useState<Courier | null>(null);
  const canShip =
    o.actions.includes('create_shipment') && o.lines.some((l) => l.shippedQuantity < l.quantity);
  if (!o.shipments.length && !canShip) return null;
  return (
    <section aria-labelledby="shipments-title" className={cn(section, 'gap-3 md:gap-3')}>
      <h2 id="shipments-title" className={cardTitle}>
        {t('order.shipments')}
      </h2>
      {o.shipments.length > 0 && (
        <ul className="flex flex-col gap-3">
          {o.shipments.map((s, i) => (
            <ShipmentRow key={s.id} order={o} shipment={s} n={i + 1} />
          ))}
        </ul>
      )}
      {canShip && (
        <div className="flex flex-wrap items-center gap-2">
          {o.shipments.length === 0 && (
            <p className="min-w-36 flex-1 text-muted-foreground">{t('order.notShippedYet')}</p>
          )}
          <Button variant="secondary" onClick={() => setDialog(true)}>
            {t('order.createShipment')}
          </Button>
          {couriers[0] && (
            <Button onClick={() => setBooking(couriers[0] as Courier)}>
              <Truck aria-hidden />
              {t('couriers.book', { courier: courierName(couriers[0], t) })}
            </Button>
          )}
        </div>
      )}
      {dialog && <ShipmentDialog order={o} onClose={() => setDialog(false)} />}
      {booking && <BookDialog order={o} courier={booking} onClose={() => setBooking(null)} />}
    </section>
  );
}

function ShipmentRow({
  order: o,
  shipment: s,
  n,
}: {
  order: OrderDetail;
  shipment: Shipment;
  n: number;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const canWrite = usePermission('orders.write');
  const [dialog, setDialog] = useState<'deliver' | 'fail' | 'delete' | 'back' | null>(null);
  const [booking, setBooking] = useState<Courier | null>(null);
  const couriers = useBookingCouriers();
  const [cash, setCash] = useState(true);
  const [reason, setReason] = useState('');
  // What the trip cost (phase-5a-plan §3.11): the delivery fee unless staff say otherwise.
  const [costText, setCostText] = useState(
    priceInput(Math.max(0, o.totals.deliveryFee - o.totals.deliveryDiscount)),
  );
  const cost = readPrice(costText);
  const ship = useCommand(o.id, async (key) =>
    unwrap(
      await api.POST('/v1/admin/shipments/{id}/ship', {
        params: { path: { id: s.id }, ...withKey(key).params },
      }),
    ),
  );
  const back = useCommand(o.id, async (key, returnCost: number) =>
    unwrap(
      await api.POST('/v1/admin/shipments/{id}/return', {
        params: { path: { id: s.id }, ...withKey(key).params },
        body: { returnCost },
      }),
    ),
  );
  const deliver = useCommand(o.id, async (key, cashCollected: boolean) =>
    unwrap(
      await api.POST('/v1/admin/shipments/{id}/deliver', {
        params: { path: { id: s.id }, ...withKey(key).params },
        body: { cashCollected },
      }),
    ),
  );
  const fail = useCommand(o.id, async (key, why: string) =>
    unwrap(
      await api.POST('/v1/admin/shipments/{id}/fail', {
        params: { path: { id: s.id }, ...withKey(key).params },
        body: { reason: why },
      }),
    ),
  );
  const remove = useCommand(o.id, async () =>
    unwrap(await api.DELETE('/v1/admin/shipments/{id}', { params: { path: { id: s.id } } })),
  );
  const error = ship.error ?? back.error;
  const lines = s.lines.map((sl) => {
    const line = o.lines.find((l) => l.id === sl.orderLineId);
    return `${line ? lineLabel(line, locale) : '?'} × ${sl.quantity}`;
  });
  return (
    <li className="flex flex-col gap-2.5 rounded-[10px] border border-border px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t('order.shipmentN', { n })}</span>
        <StatusChip kind="shipment" status={s.status} />
        {s.carrier && <span className="text-sm">{s.carrier}</span>}
        {s.trackingNumber &&
          (s.trackingUrl ? (
            <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="text-sm underline">
              {s.trackingNumber}
            </a>
          ) : (
            <span className="text-sm">{s.trackingNumber}</span>
          ))}
      </div>
      <p className="text-sm">{lines.join(', ')}</p>
      {s.failedReason && <p className="text-sm text-danger">{s.failedReason}</p>}
      <CourierPanel order={o} shipment={s} />
      {canWrite && o.status !== 'cancelled' && (
        <div className="flex flex-wrap gap-2">
          {s.status === 'pending' &&
            !s.courier &&
            couriers.map((c) => (
              <Button key={c} variant="secondary" onClick={() => setBooking(c)}>
                {t('couriers.book', { courier: courierName(c, t) })}
              </Button>
            ))}
          {s.status === 'pending' && !s.courier && (
            <>
              <Button
                disabled={ship.isPending}
                onClick={() =>
                  ship.mutate(undefined, { onSuccess: () => toast(t('order.shipped')) })
                }
              >
                {t('order.markShipped')}
              </Button>
              <Button variant="ghost" onClick={() => setDialog('delete')}>
                {t('action.delete')}
              </Button>
            </>
          )}
          {(s.status === 'shipped' || s.status === 'in_transit') && (
            <>
              <Button onClick={() => setDialog('deliver')}>{t('order.markDelivered')}</Button>
              <Button variant="secondary" onClick={() => setDialog('fail')}>
                {t('order.markFailed')}
              </Button>
            </>
          )}
          {s.status === 'failed' && !s.courier?.returnedByCourierAt && (
            <Button variant="secondary" onClick={() => setDialog('back')}>
              {t('order.markReturned')}
            </Button>
          )}
        </div>
      )}
      {error && <Notice tone="error">{orderErrorMessage(error, t)}</Notice>}
      {booking && (
        <BookDialog
          order={o}
          courier={booking}
          shipmentId={s.id}
          onClose={() => setBooking(null)}
        />
      )}
      <ConfirmDialog
        open={dialog === 'deliver'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('order.markDelivered')}
        confirmLabel={t('order.markDelivered')}
        destructive={false}
        busy={deliver.isPending}
        error={deliver.error ? orderErrorMessage(deliver.error, t) : undefined}
        onConfirm={() =>
          deliver.mutate(cash, {
            onSuccess: () => {
              setDialog(null);
              toast(t('order.delivered'));
            },
          })
        }
      >
        {o.totals.codDue > 0 && (
          <label className="flex min-h-10 items-center gap-3 md:min-h-9">
            <input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} />
            {t('order.cashCollected', { amount: formatPrice(o.totals.codDue, locale) })}
          </label>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'fail'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('order.markFailed')}
        confirmLabel={t('order.markFailed')}
        canConfirm={reason.trim().length > 0}
        busy={fail.isPending}
        error={fail.error ? orderErrorMessage(fail.error, t) : undefined}
        onConfirm={() =>
          fail.mutate(reason.trim(), {
            onSuccess: () => {
              setDialog(null);
              setReason('');
            },
          })
        }
      >
        <Field
          label={t('order.failReason')}
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'back'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('order.markReturned')}
        confirmLabel={t('order.markReturned')}
        destructive={false}
        canConfirm={cost !== undefined && cost !== null}
        busy={back.isPending}
        error={back.error ? orderErrorMessage(back.error, t) : undefined}
        onConfirm={() =>
          back.mutate(cost ?? 0, {
            onSuccess: () => {
              setDialog(null);
              toast(t('order.returned'));
            },
          })
        }
      >
        <Field
          label={t('order.returnCost')}
          hint={t('order.returnCostHint')}
          inputMode="decimal"
          value={costText}
          onChange={(e) => setCostText(e.target.value)}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('order.deleteShipment')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.error ? orderErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => setDialog(null) })}
      />
    </li>
  );
}

function Payments({ order: o }: { order: OrderDetail }) {
  const { t, locale } = useLocale();
  const canLink = usePermission('payments.read') && usePermission('orders.write');
  const [linking, setLinking] = useState(false);
  const [paying, setPaying] = useState(false);
  const canRecord = o.actions.includes('record_payment') && o.paymentStatus !== 'paid';
  const ghost = 'h-7 px-2 has-[>svg]:px-2 md:h-7';
  return (
    <section aria-labelledby="payments-title" className={cn(section, 'gap-2 md:gap-2')}>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <h2 id="payments-title" className={cardTitle}>
          {t('order.payments')}
        </h2>
        <span className="-my-1 -mr-2 flex gap-1 max-md:hidden">
          {canLink && unpaid(o) && (
            <Button variant="ghost" className={ghost} onClick={() => setLinking(true)}>
              <Link2 aria-hidden />
              {t('order.paymentLink')}
            </Button>
          )}
          {canRecord && (
            <Button variant="ghost" className={ghost} onClick={() => setPaying(true)}>
              <Plus aria-hidden />
              {t('order.recordPayment')}
            </Button>
          )}
        </span>
      </div>
      {linking && <PaymentLinkDialog order={o} onClose={() => setLinking(false)} />}
      {paying && <PaymentDialog order={o} onClose={() => setPaying(false)} />}
      {o.payments.length === 0 && <p className="text-muted-foreground">{t('order.noPayments')}</p>}
      <ul className="flex flex-col divide-y divide-border">
        {o.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2.5 py-2.5">
            <span className="flex flex-col">
              <span className="font-medium">{t(`method.${p.method}` as AdminKey)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {[
                  p.reference && `TrxID ${p.reference}`,
                  dateTime(locale, p.settledAt ?? p.createdAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {p.gateway && (p.gateway.valId || p.gateway.link) && (
                <span className="break-all text-xs text-muted-foreground">
                  {[
                    p.gateway.link && t('order.viaLink'),
                    p.gateway.cardType,
                    p.gateway.bankTranId && t('order.bankTran', { id: p.gateway.bankTranId }),
                    p.gateway.valId && t('order.valId', { id: p.gateway.valId }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
              {p.gateway?.risky && (
                <span className="text-xs font-medium text-destructive">{t('order.risky')}</span>
              )}
            </span>
            <span className="flex items-center gap-2 font-medium tabular-nums">
              {p.status !== 'paid' && p.status !== 'succeeded' && (
                <StatusChip kind="payment" status={p.status} />
              )}
              {formatPrice(p.amount, locale)}
            </span>
          </li>
        ))}
      </ul>
      {((canLink && unpaid(o)) || canRecord) && (
        <div className="mt-2 flex gap-2 md:hidden [&>button]:flex-1">
          {canLink && unpaid(o) && (
            <Button variant="secondary" onClick={() => setLinking(true)}>
              {t('order.paymentLink')}
            </Button>
          )}
          {canRecord && (
            <Button variant="secondary" onClick={() => setPaying(true)}>
              {t('order.record')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** A link the shopper pays what's unpaid from (phase-5a-plan §3.3): copy it, or share it. */
function PaymentLinkDialog({ order: o, onClose }: { order: OrderDetail; onClose: () => void }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  // Opening the dialog makes the link; the API reuses one still waiting, so
  // opening it again never asks twice.
  const link = useQuery({
    queryKey: ['payment-link', o.id],
    queryFn: async () => {
      const made = unwrap(
        await api.POST('/v1/admin/orders/{id}/payment-link', { params: { path: { id: o.id } } }),
      );
      await queryClient.invalidateQueries({ queryKey: ['order', o.id] });
      return made;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const message = link.data
    ? t('order.paymentLinkMessage', {
        number: o.displayNumber,
        amount: formatPrice(link.data.amount, locale),
        url: link.data.url,
      })
    : '';
  const phone = o.contact.phone.replace(/\D/g, '');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('order.paymentLink')}>
      <div className="flex flex-col gap-4">
        {link.isPending && <p role="status">{t('loading')}</p>}
        {link.isError && <Notice tone="error">{orderErrorMessage(link.error, t)}</Notice>}
        {link.data && (
          <>
            <p>
              {t('order.paymentLinkIntro', {
                amount: formatPrice(link.data.amount, locale),
                date: dateTime(locale, link.data.expiresAt),
              })}
            </p>
            <Input readOnly value={link.data.url} aria-label={t('order.paymentLink')} />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(message);
                  toast(t('order.copied'));
                }}
              >
                {t('order.copyLink')}
              </Button>
              <a
                className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
                href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp
              </a>
              <a
                className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
                href={`sms:${o.contact.phone}?body=${encodeURIComponent(message)}`}
              >
                SMS
              </a>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Returns and refunds (phase-5a-plan §7): start a return, refund an overpaid order. */
function ReturnsAndRefunds({ order: o }: { order: OrderDetail }) {
  const { t, locale } = useLocale();
  const canWrite = usePermission('orders.write');
  const canRefund = usePermission('payments.refund');
  const [dialog, setDialog] = useState<'return' | 'refund' | null>(null);
  // Something went out; the dialog shows what was delivered and can still come back.
  const canReturn = canWrite && o.status !== 'cancelled' && o.deliveryStatus !== 'not_shipped';
  const overpaid = canRefund && o.totals.refundDue > 0;
  if (!o.returns.length && !o.refunds.length && !canReturn && !overpaid) return null;
  return (
    <section aria-labelledby="returns-title" className={cn(section, 'gap-2 md:gap-2')}>
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-3">
        <h2 id="returns-title" className={cardTitle}>
          {t('order.returnsAndRefunds')}
        </h2>
        <div className="-my-1 -mr-2 flex flex-wrap gap-1">
          {canReturn && (
            <Button
              variant="ghost"
              className="h-7 px-2 has-[>svg]:px-2 md:h-7"
              onClick={() => setDialog('return')}
            >
              <Undo2 aria-hidden />
              {t('return.create')}
            </Button>
          )}
          {overpaid && (
            <Button variant="ghost" className="h-7 px-2 md:h-7" onClick={() => setDialog('refund')}>
              {t('order.refundOverpaid', { amount: formatPrice(o.totals.refundDue, locale) })}
            </Button>
          )}
        </div>
      </div>
      {o.returns.length === 0 && o.refunds.length === 0 && canReturn && (
        <p className="text-muted-foreground">{t('order.noReturns')}</p>
      )}
      {o.returns.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {o.returns.map((r) => (
            <li key={r.id}>
              <Link
                to="/returns/$id"
                params={{ id: r.id }}
                className="flex min-h-11 items-center justify-between gap-2.5 py-2.5"
              >
                <span className="font-mono font-medium tracking-[0.02em]">R{r.number}</span>
                <ReturnStatusChip status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {o.refunds.length > 0 && (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {o.refunds.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-col">
                <span className="font-medium">{t(`refund.method.${f.method}` as AdminKey)}</span>
                <span className="text-xs text-muted-foreground">
                  {[f.reference, f.reason, dateTime(locale, f.createdAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {f.gatewayError && (
                  <span className="text-xs text-destructive">{f.gatewayError}</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs">{t(`refund.status.${f.status}` as AdminKey)}</span>−
                {formatPrice(f.amount, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {dialog === 'return' && <CreateReturnDialog orderId={o.id} onClose={() => setDialog(null)} />}
      {dialog === 'refund' && (
        <RefundDialog orderId={o.id} returnId={null} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}

function Timeline({ order: o }: { order: OrderDetail }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const canWrite = usePermission('orders.write');
  const [body, setBody] = useState('');
  const note = useCommand(o.id, async (_key, text: string) =>
    unwrap(
      await api.POST('/v1/admin/orders/{id}/notes', {
        params: { path: { id: o.id } },
        body: { body: text },
      }),
    ),
  );
  const describe = (e: OrderDetail['timeline'][number]) => {
    if (e.kind === 'note') return e.body ?? '';
    return [historyText(e, t), e.reason].filter(Boolean).join(' — ');
  };
  const actor = (e: OrderDetail['timeline'][number]) =>
    e.kind === 'note' ? t('history.note') : t(`actor.${e.actorType ?? 'system'}` as AdminKey);
  return (
    <section aria-labelledby="timeline-title" className={cn(section, 'gap-3.5 md:gap-3.5')}>
      <h2 id="timeline-title" className={cardTitle}>
        {t('order.timeline')}
      </h2>
      {canWrite && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            note.mutate(body.trim(), {
              onSuccess: () => {
                setBody('');
                toast(t('order.noteAdded'));
              },
            });
          }}
        >
          <label htmlFor="order-note" className="sr-only">
            {t('order.addNote')}
          </label>
          <Textarea
            id="order-note"
            maxLength={2000}
            value={body}
            placeholder={t('order.notePlaceholder')}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-16 md:min-h-16"
          />
          <Button
            type="submit"
            variant="secondary"
            className="self-end"
            disabled={note.isPending || !body.trim()}
          >
            {t('order.saveNote')}
          </Button>
          {note.error && <Notice tone="error">{orderErrorMessage(note.error, t)}</Notice>}
        </form>
      )}
      <ol className="flex flex-col">
        {[...o.timeline].reverse().map((e) => (
          <li
            key={e.id}
            className="relative flex gap-3 pb-3.5 before:absolute before:top-3.5 before:bottom-0 before:left-[5px] before:w-px before:bg-border last:pb-0 last:before:hidden"
          >
            <span
              aria-hidden
              className="mt-1 size-[11px] shrink-0 rounded-full border-2 border-background bg-muted-foreground shadow-[0_0_0_1px_var(--color-border)]"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span
                className={
                  e.kind === 'note'
                    ? 'rounded-lg bg-muted px-2.5 py-2 whitespace-pre-line'
                    : undefined
                }
              >
                {describe(e)}
              </span>
              <span className="text-xs text-muted-foreground">
                {actor(e)} · {dateTime(locale, e.createdAt)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A history row in words: what changed, by the machine it belongs to. */
function historyText(
  e: OrderDetail['timeline'][number],
  t: (key: AdminKey, params?: Record<string, string | number>) => string,
): string {
  const to = e.to ?? '';
  switch (e.machine) {
    case 'order':
      return e.event === 'place'
        ? t('history.placed')
        : t('history.order', { status: t(`orderStatus.${to}` as AdminKey) });
    case 'payment':
      return t('history.payment', { status: t(`paymentStatus.${to}` as AdminKey) });
    case 'delivery':
      return t('history.delivery', { status: t(`deliveryStatus.${to}` as AdminKey) });
    case 'shipment':
      if (!e.to) return t('history.shipmentDeleted');
      if (!e.from) return t('history.shipmentCreated');
      return t('history.shipment', { status: t(`shipmentStatus.${to}` as AdminKey) });
    case 'confirmation': {
      const d = (e.data ?? {}) as { attempts?: number; code?: string };
      const outcome = t(`outcome.${e.event}` as AdminKey);
      return e.event === 'no_answer' && d.attempts
        ? t('history.callAttempt', { outcome, count: d.attempts })
        : t('history.call', { outcome });
    }
    case 'edit': {
      const number = (e.data as { number?: number } | null)?.number;
      if (e.event === 'merged_into') return t('history.mergedInto', { number: number ?? '' });
      if (e.event === 'merged_from') return t('history.mergedFrom', { number: number ?? '' });
      if (e.event === 'duplicate_dismissed') return t('history.duplicateDismissed');
      return t('history.edited');
    }
    default:
      return e.event ?? '';
  }
}

function Tags({ order: o }: { order: OrderDetail }) {
  const { t } = useLocale();
  const canWrite = usePermission('orders.write');
  const [text, setText] = useState('');
  const save = useCommand(o.id, async (_key, tags: string[]) =>
    unwrap(
      await api.PATCH('/v1/admin/orders/{id}', { params: { path: { id: o.id } }, body: { tags } }),
    ),
  );
  const add = () => {
    const tag = text.trim();
    if (!tag || o.tags.includes(tag)) return setText('');
    save.mutate([...o.tags, tag], { onSuccess: () => setText('') });
  };
  return (
    <section aria-labelledby="tags-title" className={cn(section, 'gap-2.5 md:gap-2.5')}>
      <h2 id="tags-title" className={cardTitle}>
        {t('order.tags')}
      </h2>
      {o.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {o.tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex h-6 items-center gap-0.5 rounded-md bg-muted pr-0.5 pl-2 text-xs font-medium"
            >
              {tag}
              {canWrite && (
                <button
                  type="button"
                  aria-label={t('order.removeTag', { tag })}
                  disabled={save.isPending}
                  onClick={() => save.mutate(o.tags.filter((x) => x !== tag))}
                  className="inline-flex size-5 items-center justify-center rounded opacity-60 hover:opacity-100"
                >
                  <X aria-hidden className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <Input
          aria-label={t('order.addTag')}
          placeholder={t('order.addTagHint')}
          value={text}
          disabled={save.isPending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          className="md:h-8"
        />
      ) : (
        o.tags.length === 0 && <p className="text-muted-foreground">—</p>
      )}
      {save.error && <Notice tone="error">{orderErrorMessage(save.error, t)}</Notice>}
    </section>
  );
}

const STAFF_CANCEL_CODES = [
  'shopper_request',
  'no_answer',
  'wrong_number',
  'fake',
  'out_of_stock',
  'other',
] as const satisfies readonly CancelCode[];

export function CancelDialog({ order: o, onClose }: { order: OrderDetail; onClose: () => void }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [code, setCode] = useState<CancelCode | ''>('');
  const cancel = useCommand(o.id, async (key, why: string) =>
    unwrap(
      await api.POST('/v1/admin/orders/{id}/cancel', {
        params: { path: { id: o.id }, ...withKey(key).params },
        body: { reason: why, ...(code ? { code } : {}) },
      }),
    ),
  );
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('order.cancelTitle', { number: o.displayNumber })}
      confirmLabel={t('order.cancel')}
      canConfirm={reason.trim().length > 0 && code !== ''}
      busy={cancel.isPending}
      error={cancel.error ? orderErrorMessage(cancel.error, t) : undefined}
      onConfirm={() =>
        cancel.mutate(reason.trim(), {
          onSuccess: () => {
            toast(t('order.cancelled'));
            onClose();
          },
        })
      }
    >
      <p className="text-sm">
        {t('order.cancelEffects')}
        {o.totals.paidTotal > 0 &&
          ` ${t('order.cancelRefund', { amount: formatPrice(o.totals.paidTotal, locale) })}`}
      </p>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{t('order.cancelCode')}</legend>
        {STAFF_CANCEL_CODES.map((c) => (
          <label key={c} className="flex min-h-10 items-center gap-3 md:min-h-9">
            <input
              type="radio"
              name="cancel-code"
              checked={code === c}
              onChange={() => setCode(c)}
            />
            {t(`cancelCode.${c}`)}
          </label>
        ))}
      </fieldset>
      <Field
        label={t('order.cancelReason')}
        value={reason}
        maxLength={300}
        onChange={(e) => setReason(e.target.value)}
      />
    </ConfirmDialog>
  );
}

function ShipmentDialog({ order: o, onClose }: { order: OrderDetail; onClose: () => void }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const open = o.lines.filter((l) => l.shippedQuantity < l.quantity);
  // Units already in a pending shipment can't go in another.
  const pending = new Map<string, number>();
  for (const s of o.shipments) {
    if (s.status !== 'pending') continue;
    for (const l of s.lines)
      pending.set(l.orderLineId, (pending.get(l.orderLineId) ?? 0) + l.quantity);
  }
  const left = (lineId: string, quantity: number, shipped: number) =>
    Math.max(0, quantity - shipped - (pending.get(lineId) ?? 0));
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((l) => [l.id, String(left(l.id, l.quantity, l.shippedQuantity))])),
  );
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);
  const create = useCommand(o.id, async (key, body: Parameters<typeof createBody>[0]) =>
    unwrap(
      await api.POST('/v1/admin/orders/{id}/shipments', {
        params: { path: { id: o.id }, ...withKey(key).params },
        body: createBody(body),
      }),
    ),
  );
  function submit() {
    const lines = open
      .map((l) => ({ orderLineId: l.id, quantity: Number(qty[l.id] ?? 0) }))
      .filter((l) => l.quantity > 0);
    const bad = open.some((l) => {
      const n = Number(qty[l.id] ?? 0);
      return !Number.isInteger(n) || n < 0 || n > left(l.id, l.quantity, l.shippedQuantity);
    });
    if (bad || !lines.length || (url && !/^https?:\/\//.test(url.trim()))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    create.mutate(
      { lines, carrier, trackingNumber: tracking, trackingUrl: url },
      {
        onSuccess: () => {
          toast(t('order.shipmentCreated'));
          onClose();
        },
      },
    );
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={t('order.createShipment')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('order.shipmentLines')}</legend>
          {open.map((l) => (
            <div key={l.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1">
                {lineLabel(l, locale)}
                <span className="block text-xs text-muted-foreground">
                  {t('order.toShip', { count: left(l.id, l.quantity, l.shippedQuantity) })}
                </span>
              </span>
              <Input
                className="w-20"
                inputMode="numeric"
                aria-label={t('order.quantityOf', { item: lineLabel(l, locale) })}
                value={qty[l.id] ?? ''}
                onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
              />
            </div>
          ))}
        </fieldset>
        <Field
          label={t('order.carrier')}
          value={carrier}
          maxLength={60}
          onChange={(e) => setCarrier(e.target.value)}
          hint={t('order.carrierHint')}
        />
        <Field
          label={t('order.trackingNumber')}
          value={tracking}
          maxLength={100}
          onChange={(e) => setTracking(e.target.value)}
        />
        <Field
          label={t('order.trackingUrl')}
          type="url"
          value={url}
          maxLength={500}
          onChange={(e) => setUrl(e.target.value)}
        />
        {invalid && <Notice tone="error">{t('order.shipmentInvalid')}</Notice>}
        {create.error && <Notice tone="error">{orderErrorMessage(create.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {t('order.createShipment')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function createBody(v: {
  lines: { orderLineId: string; quantity: number }[];
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
}) {
  return {
    lines: v.lines,
    ...(v.carrier.trim() ? { carrier: v.carrier.trim() } : {}),
    ...(v.trackingNumber.trim() ? { trackingNumber: v.trackingNumber.trim() } : {}),
    ...(v.trackingUrl.trim() ? { trackingUrl: v.trackingUrl.trim() } : {}),
  };
}

function PaymentDialog({ order: o, onClose }: { order: OrderDetail; onClose: () => void }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const due = Math.max(0, o.totals.total - o.totals.paidTotal);
  const [method, setMethod] = useState<(typeof MANUAL_METHODS)[number]>('bkash');
  const [amount, setAmount] = useState(String(due / 100));
  const [reference, setReference] = useState('');
  const [invalid, setInvalid] = useState(false);
  const pay = useCommand(
    o.id,
    async (key, body: { method: typeof method; amount: number; reference?: string }) =>
      unwrap(
        await api.POST('/v1/admin/orders/{id}/payments', {
          params: { path: { id: o.id }, ...withKey(key).params },
          body,
        }),
      ),
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t('order.recordPayment')}
      description={t('order.recordPaymentHint', { amount: formatPrice(due, locale) })}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const value = readPrice(amount);
          if (!value) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          pay.mutate(
            { method, amount: value, ...(reference.trim() ? { reference: reference.trim() } : {}) },
            {
              onSuccess: () => {
                toast(t('order.paymentRecorded'));
                onClose();
              },
            },
          );
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('order.method')}
          <select
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-base shadow-xs md:h-9 md:text-sm dark:bg-white/[0.045] font-normal"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            {MANUAL_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`method.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <Field
          label={t('order.amount')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={invalid ? t('form.invalid') : undefined}
        />
        <Field
          label={t('order.reference')}
          hint={t('order.referenceHint')}
          value={reference}
          maxLength={100}
          onChange={(e) => setReference(e.target.value)}
        />
        {pay.error && <Notice tone="error">{orderErrorMessage(pay.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={pay.isPending}>
            {t('order.recordPayment')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
