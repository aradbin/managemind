// One order (phase-4-plan §7): its four statuses, lines with discounts,
// totals, the customer, payments, shipments and the timeline, with only the
// actions the state machines allow (the API lists them). Every command sends
// an Idempotency-Key, kept for the dialog's life, so a retry after a dropped
// connection doesn't do it twice.
import { type CancelCode, MANUAL_METHODS } from '@managemind/shared/orders';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ChevronRight, MessageCircle, Phone } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { StatusChip } from '../components/order-status';
import { usePermission } from '../components/permission-gate';
import { RiskPanel } from '../components/risk';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/returns';
import { RefundDialog } from '../components/refund-dialog';
import { api, unwrap } from '../lib/api';
import { formatPrice, priceInput, readPrice } from '../lib/catalog';
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
import { EditOrderDialog } from './order-edit';
import { PrintLinks } from './orders';
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

const section = 'flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5';

export function OrderDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { t, locale } = useLocale();
  const order = useQuery(orderQuery(id));
  if (order.isPending) return <p role="status">{t('loading')}</p>;
  if (order.isError) return <Notice tone="error">{errorMessage(order.error, t)}</Notice>;
  const o = order.data;
  return (
    <div className="flex flex-col gap-5 pb-20 md:pb-0">
      <nav aria-label={t('nav.breadcrumb')} className="flex items-center gap-1.5 text-sm">
        <Link to="/orders" className="font-medium text-primary hover:underline">
          {t('nav.orders')}
        </Link>
        <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">{o.displayNumber}</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('order.title', { number: o.displayNumber })}
            </h1>
            <div className="flex flex-wrap gap-1.5">
              <StatusChip kind="order" status={o.status} />
              <StatusChip kind="payment" status={o.paymentStatus} />
              <StatusChip kind="delivery" status={o.deliveryStatus} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('order.placedOn', {
              date: dateTime(locale, o.placedAt),
              source: t(`source.${o.source}` as AdminKey),
            })}
          </p>
        </div>
        <OrderActions order={o} />
      </div>
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
        <Notice tone="error">
          {t(o.cancelledBy === 'shopper' ? 'order.cancelledByShopper' : 'order.cancelledByStaff', {
            reason: o.cancelReason ?? '—',
          })}
          {o.cancelCode && o.cancelledBy !== 'shopper' && ` (${t(`cancelCode.${o.cancelCode}`)})`}
        </Notice>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* The customer first on phones, where calling them is the next step; beside the items on desktops. */}
        <div className="flex flex-col gap-5 lg:col-start-2 lg:row-start-1">
          <CustomerCard order={o} />
          <RiskPanel risk={o.risk} atPlacement={o.phoneScoreAtPlacement}>
            {o.otherOpenOrders.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-semibold">{t('risk.otherOpen')}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {o.otherOpenOrders.map((other) => (
                    <li key={other.id} className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/orders/$id"
                        params={{ id: other.id }}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {other.displayNumber}
                      </Link>
                      <StatusChip kind="order" status={other.status} />
                      <span className="ms-auto tabular-nums">
                        {formatPrice(other.total, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </RiskPanel>
        </div>
        <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Lines order={o} />
          <Payments order={o} />
          <Shipments order={o} />
          <ReturnsAndRefunds order={o} />
          <Timeline order={o} />
        </div>
        <div className="lg:col-start-2 lg:row-start-2">
          <Tags order={o} />
        </div>
      </div>
    </div>
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
              onClick={() =>
                merge.mutate(undefined, {
                  onSuccess: () => {
                    toast(t('duplicate.merged', { number: other.displayNumber }));
                    void navigate({ to: '/orders/$id', params: { id: other.id } });
                  },
                })
              }
            >
              {t('duplicate.merge', { number: other.displayNumber })}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                cancel.mutate(undefined, { onSuccess: () => toast(t('order.cancelled')) })
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

function OrderActions({ order: o }: { order: OrderDetail }) {
  const { t } = useLocale();
  const toast = useToast();
  const [dialog, setDialog] = useState<'cancel' | 'edit' | 'ship' | 'pay' | null>(null);
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
  // The next step in the order's life: on phones it is pinned above the tab bar.
  const primary = has('confirm') ? (
    <Button
      disabled={confirm.isPending}
      onClick={() => confirm.mutate(undefined, { onSuccess: () => toast(t('order.confirmed')) })}
    >
      {t('order.confirm')}
    </Button>
  ) : canShip ? (
    <Button onClick={() => setDialog('ship')}>{t('order.createShipment')}</Button>
  ) : null;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <PrintLinks ids={[o.id]} />
        {has('edit') && (
          <Button variant="secondary" onClick={() => setDialog('edit')}>
            {t('order.edit')}
          </Button>
        )}
        {has('cancel') && (
          <Button variant="quiet" onClick={() => setDialog('cancel')}>
            {t('order.cancel')}
          </Button>
        )}
        {has('record_payment') && o.paymentStatus !== 'paid' && (
          <Button variant="secondary" onClick={() => setDialog('pay')}>
            {t('order.recordPayment')}
          </Button>
        )}
        {has('process') && (
          <Button
            variant="secondary"
            disabled={process.isPending}
            onClick={() =>
              process.mutate(undefined, { onSuccess: () => toast(t('order.processed')) })
            }
          >
            {t('order.process')}
          </Button>
        )}
        {has('confirm') && canShip && (
          <Button variant="secondary" onClick={() => setDialog('ship')}>
            {t('order.createShipment')}
          </Button>
        )}
        {primary && <div className="hidden md:contents">{primary}</div>}
      </div>
      {primary && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex border-t border-border bg-background p-3 md:hidden [&>button]:min-h-12 [&>button]:flex-1 [&>button]:text-base">
          {primary}
        </div>
      )}
      {error && <Notice tone="error">{orderErrorMessage(error, t)}</Notice>}
      {dialog === 'cancel' && <CancelDialog order={o} onClose={() => setDialog(null)} />}
      {dialog === 'ship' && <ShipmentDialog order={o} onClose={() => setDialog(null)} />}
      {dialog === 'pay' && <PaymentDialog order={o} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <EditOrderDialog order={o} onClose={() => setDialog(null)} />}
    </div>
  );
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
  return (
    <section aria-labelledby="lines-title" className={section}>
      <h2 id="lines-title" className="font-semibold">
        {t('order.items')}
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {o.lines.map((l) => (
          <li key={l.id} className="flex gap-3 py-2">
            <Thumbnail file={l.image?.files[0]?.file} />
            <div className="flex flex-1 flex-col">
              <Link
                to="/products/$id"
                params={{ id: l.productId }}
                className="underline-offset-2 hover:underline"
              >
                {lineLabel(l, locale)}
              </Link>
              <span className="text-xs text-muted-foreground">
                {[l.sku, t('order.shippedOf', { shipped: l.shippedQuantity, count: l.quantity })]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className="flex flex-col items-end text-sm">
              <span>
                {money(l.unitPrice)} × {l.quantity}
              </span>
              {l.discount > 0 && <span className="text-success">−{money(l.discount)}</span>}
              <span className="font-medium">{money(l.total)}</span>
            </div>
          </li>
        ))}
      </ul>
      <dl className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 text-base font-semibold">
          <dt>{t('order.total')}</dt>
          <dd>{money(tt.total)}</dd>
        </div>
        {tt.paidTotal > 0 && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('order.paid')}</dt>
            <dd>{money(tt.paidTotal)}</dd>
          </div>
        )}
        {tt.codDue > 0 && (
          <div className="flex justify-between gap-4 font-medium">
            <dt>{t('order.codDue')}</dt>
            <dd>{money(tt.codDue)}</dd>
          </div>
        )}
        {tt.refundDue > 0 && (
          <div className="flex justify-between gap-4 font-medium text-danger">
            <dt>{t('order.refundDue')}</dt>
            <dd>{money(tt.refundDue)}</dd>
          </div>
        )}
      </dl>
      {o.customerNote && (
        <p className="rounded-md bg-muted p-3 text-sm">
          <span className="font-medium">{t('order.customerNote')}: </span>
          {o.customerNote}
        </p>
      )}
    </section>
  );
}

function CustomerCard({ order: o }: { order: OrderDetail }) {
  const { t, locale } = useLocale();
  const canCustomers = usePermission('customers.read');
  return (
    <section aria-labelledby="customer-title" className={section}>
      <h2 id="customer-title" className="font-semibold">
        {t('order.customer')}
      </h2>
      <div className="flex flex-col gap-1 text-sm">
        {canCustomers ? (
          <Link
            to="/customers/$id"
            params={{ id: o.customer.id }}
            className="font-medium underline-offset-2 hover:underline"
          >
            {o.contact.name}
          </Link>
        ) : (
          <span className="font-medium">{o.contact.name}</span>
        )}
        {canCustomers ? (
          <a href={`tel:${o.contact.phone}`} className="underline-offset-2 hover:underline">
            {o.contact.phone}
          </a>
        ) : (
          <span>{o.contact.phone}</span>
        )}
        {o.contact.email && <span>{o.contact.email}</span>}
        <span className="text-muted-foreground">
          {o.customer.orderCount <= 1
            ? t('order.firstOrder')
            : t('order.orderCount', { count: o.customer.orderCount })}
        </span>
      </div>
      {canCustomers && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" asChild>
            <a href={`tel:${o.contact.phone}`}>
              <Phone aria-hidden className="size-4" />
              {t('order.call')}
            </a>
          </Button>
          <Button variant="secondary" asChild>
            <a
              href={`https://wa.me/${o.contact.phone.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle aria-hidden className="size-4" />
              {t('order.whatsapp')}
            </a>
          </Button>
        </div>
      )}
      <h3 className="text-sm font-semibold">{t('order.address')}</h3>
      {o.address ? (
        <address className="text-sm not-italic">
          {o.address.line}
          <br />
          {placeLine(o.address.names, locale)}, {pickText(o.address.names.division, locale)}
        </address>
      ) : (
        <p className="text-sm text-muted-foreground">{t('order.noDelivery')}</p>
      )}
      {!canCustomers && <p className="text-xs text-muted-foreground">{t('order.masked')}</p>}
    </section>
  );
}

function Shipments({ order: o }: { order: OrderDetail }) {
  const { t } = useLocale();
  if (!o.shipments.length) return null;
  return (
    <section aria-labelledby="shipments-title" className={section}>
      <h2 id="shipments-title" className="font-semibold">
        {t('order.shipments')}
      </h2>
      <ul className="flex flex-col gap-3">
        {o.shipments.map((s, i) => (
          <ShipmentRow key={s.id} order={o} shipment={s} n={i + 1} />
        ))}
      </ul>
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
    <li className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
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
      {canWrite && o.status !== 'cancelled' && (
        <div className="flex flex-wrap gap-2">
          {s.status === 'pending' && (
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
          {s.status === 'shipped' && (
            <>
              <Button onClick={() => setDialog('deliver')}>{t('order.markDelivered')}</Button>
              <Button variant="secondary" onClick={() => setDialog('fail')}>
                {t('order.markFailed')}
              </Button>
            </>
          )}
          {s.status === 'failed' && (
            <Button variant="secondary" onClick={() => setDialog('back')}>
              {t('order.markReturned')}
            </Button>
          )}
        </div>
      )}
      {error && <Notice tone="error">{orderErrorMessage(error, t)}</Notice>}
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
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={cash}
              onChange={(e) => setCash(e.target.checked)}
            />
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
  const unpaid =
    o.status !== 'cancelled' && o.status !== 'completed' && o.totals.paidTotal < o.totals.total;
  if (!o.payments.length && !unpaid) return null;
  return (
    <section aria-labelledby="payments-title" className={section}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="payments-title" className="font-semibold">
          {t('order.payments')}
        </h2>
        {canLink && unpaid && (
          <Button variant="secondary" onClick={() => setLinking(true)}>
            {t('order.paymentLink')}
          </Button>
        )}
      </div>
      {linking && <PaymentLinkDialog order={o} onClose={() => setLinking(false)} />}
      <ul className="flex flex-col divide-y divide-border text-sm">
        {o.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex flex-col">
              <span className="font-medium">{t(`method.${p.method}` as AdminKey)}</span>
              <span className="text-xs text-muted-foreground">
                {[p.reference, dateTime(locale, p.settledAt ?? p.createdAt)]
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
            <span className="flex items-center gap-2">
              <StatusChip kind="payment" status={p.status} />
              {formatPrice(p.amount, locale)}
            </span>
          </li>
        ))}
      </ul>
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
    <section aria-labelledby="returns-title" className={section}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="returns-title" className="font-semibold">
          {t('order.returnsAndRefunds')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {canReturn && (
            <Button variant="secondary" onClick={() => setDialog('return')}>
              {t('return.create')}
            </Button>
          )}
          {overpaid && (
            <Button variant="secondary" onClick={() => setDialog('refund')}>
              {t('order.refundOverpaid', { amount: formatPrice(o.totals.refundDue, locale) })}
            </Button>
          )}
        </div>
      </div>
      {o.returns.length > 0 && (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {o.returns.map((r) => (
            <li key={r.id}>
              <Link
                to="/returns/$id"
                params={{ id: r.id }}
                className="flex min-h-11 items-center justify-between gap-2 py-2 hover:underline"
              >
                <span>R{r.number}</span>
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
    <section aria-labelledby="timeline-title" className={section}>
      <h2 id="timeline-title" className="font-semibold">
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
          <label htmlFor="order-note" className="text-sm font-medium">
            {t('order.addNote')}
          </label>
          <textarea
            id="order-note"
            rows={2}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="rounded-lg border border-border bg-background p-3 text-base"
          />
          <div>
            <Button type="submit" variant="secondary" disabled={note.isPending || !body.trim()}>
              {t('order.saveNote')}
            </Button>
          </div>
          {note.error && <Notice tone="error">{orderErrorMessage(note.error, t)}</Notice>}
        </form>
      )}
      <ol className="flex flex-col gap-3 border-l border-border pl-4">
        {[...o.timeline].reverse().map((e) => (
          <li key={e.id} className="flex flex-col text-sm">
            <span className={e.kind === 'note' ? 'whitespace-pre-wrap' : 'font-medium'}>
              {describe(e)}
            </span>
            <span className="text-xs text-muted-foreground">
              {actor(e)} · {dateTime(locale, e.createdAt)}
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
  const [text, setText] = useState(o.tags.join(', '));
  const save = useCommand(o.id, async (_key, tags: string[]) =>
    unwrap(
      await api.PATCH('/v1/admin/orders/{id}', { params: { path: { id: o.id } }, body: { tags } }),
    ),
  );
  return (
    <section aria-labelledby="tags-title" className={section}>
      <h2 id="tags-title" className="font-semibold">
        {t('order.tags')}
      </h2>
      {canWrite ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              text
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            );
          }}
        >
          <Input
            aria-label={t('order.tags')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('order.tagsHint')}
          />
          <div>
            <Button type="submit" variant="secondary" disabled={save.isPending}>
              {t('action.save')}
            </Button>
          </div>
          {save.isSuccess && <p className="text-sm text-muted-foreground">{t('account.saved')}</p>}
          {save.error && <Notice tone="error">{orderErrorMessage(save.error, t)}</Notice>}
        </form>
      ) : (
        <p className="text-sm">{o.tags.join(', ') || '—'}</p>
      )}
    </section>
  );
}

/** The codes staff pick from the order page; duplicates have their own actions, expiry is the system's. */
const STAFF_CANCEL_CODES = [
  'shopper_request',
  'no_answer',
  'wrong_number',
  'fake',
  'out_of_stock',
  'other',
] as const satisfies readonly CancelCode[];

function CancelDialog({ order: o, onClose }: { order: OrderDetail; onClose: () => void }) {
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
          <label key={c} className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="cancel-code"
              className="size-5"
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
            className="min-h-11 rounded-lg border border-input bg-background px-3 text-base font-normal"
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
