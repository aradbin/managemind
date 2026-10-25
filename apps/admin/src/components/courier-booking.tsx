// Couriers on the order page (phase-7-plan §3.4, §3.9): the booking sheet,
// which shows what the courier gets before anything is booked, and each
// courier shipment's panel: its consignment, tracking link, the courier's
// updates, and what staff can do now.
import { COURIER_UPDATES, type Courier, needsAreas } from '@managemind/shared/orders';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/couriers';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { type BookingOutcome, type CourierPlace, courierName } from '../lib/couriers';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateTime, type OrderDetail, type Shipment } from '../lib/orders';
import { ConfirmDialog } from './confirm-dialog';
import { Field } from './field';
import { Notice } from './notice';
import { usePermission } from './permission-gate';
import { useToast } from './toast';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input } from './ui/input';

/** Refreshes what a courier change touches. */
function useRefresh(orderId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['courier-returns'] }),
    ]);
}

/**
 * The booking sheet: the parcel as the courier will get it, the area for
 * couriers that need one, the weight and note staff can change, then Book.
 */
export function BookDialog({
  order: o,
  courier,
  shipmentId,
  onClose,
}: {
  order: OrderDetail;
  courier: Courier;
  shipmentId?: string | undefined;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const refresh = useRefresh(o.id);
  const name = courierName(courier, t);
  const [weight, setWeight] = useState('');
  const [note, setNote] = useState('');
  const [place, setPlace] = useState<CourierPlace | null>(null);
  const [q, setQ] = useState('');
  const [outcome, setOutcome] = useState<BookingOutcome | null>(null);
  const input = {
    courier,
    ...(shipmentId ? { shipmentId } : {}),
    ...(Number(weight) >= 100 ? { weightGrams: Number(weight) } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(place
      ? courier === 'pathao'
        ? { place: { zoneId: place.externalId } }
        : { place: { areaId: place.externalId } }
      : {}),
  };
  const preview = useQuery({
    queryKey: ['booking-preview', o.id, courier, shipmentId ?? null, place?.externalId ?? null],
    queryFn: async () =>
      unwrap(
        await api.POST('/v1/admin/orders/{id}/booking/preview', {
          params: { path: { id: o.id } },
          body: input,
        }),
      ),
  });
  useEffect(() => {
    const w = preview.data?.parcel?.weightGrams;
    if (typeof w === 'number' && !weight) setWeight(String(w));
  }, [preview.data, weight]);
  const places = useQuery({
    queryKey: ['courier-places', courier, q],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/couriers/{courier}/places', {
          params: { path: { courier }, query: { q } },
        }),
      ),
    enabled: needsAreas(courier) && (preview.data?.problems.includes('area_unmatched') || !!place),
  });
  const book = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/orders/{id}/booking', {
          params: { path: { id: o.id } },
          body: input,
        }),
      ),
    onSuccess: async (r) => {
      await refresh();
      if (r.result === 'booked') {
        toast(t('couriers.result.booked', { courier: name, id: r.consignmentId ?? '' }));
        onClose();
      } else setOutcome(r);
    },
  });
  const p = preview.data;
  const parcel = p?.parcel as
    | { address?: string; items?: string; codTaka?: number; phone?: string }
    | null
    | undefined;
  const blocking = p?.problems.filter((x) => x !== 'area_unmatched' || !place) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t('couriers.book', { courier: name })}
    >
      {preview.isPending && <p role="status">{t('loading')}</p>}
      {preview.isError && <Notice tone="error">{errorMessage(preview.error, t)}</Notice>}
      {p && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            book.mutate();
          }}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('couriers.sheet.address')}</dt>
            <dd>{parcel?.address ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('couriers.sheet.items')}</dt>
            <dd>{parcel?.items ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('couriers.sheet.cod')}</dt>
            <dd className="font-semibold">{formatPrice(p.codAmount, locale)}</dd>
          </dl>
          {needsAreas(courier) && (
            <div className="flex flex-col gap-2">
              {p.place && !place ? (
                <p className="text-sm">
                  {t('couriers.sheet.areaMatched', { name: String(p.place.name ?? '') })}
                </p>
              ) : (
                <>
                  <label htmlFor="courier-area" className="text-sm font-medium">
                    {t('couriers.sheet.area', { courier: name })}
                  </label>
                  <Input
                    id="courier-area"
                    placeholder={t('couriers.sheet.areaSearch', { courier: name })}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  <ul className="flex max-h-48 flex-col overflow-y-auto">
                    {places.data?.map((pl) => (
                      <li key={pl.externalId}>
                        <label className="flex min-h-11 items-center gap-3">
                          <input
                            type="radio"
                            name="courier-place"
                            className="size-5"
                            checked={place?.externalId === pl.externalId}
                            onChange={() => setPlace(pl)}
                          />
                          {pl.name}
                          {pl.parent && (
                            <span className="text-muted-foreground">· {pl.parent}</span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <Field
            label={t('couriers.sheet.weight')}
            inputMode="numeric"
            value={weight}
            onChange={(e) => setWeight(e.target.value.replace(/\D/g, ''))}
          />
          <Field
            label={t('couriers.sheet.note')}
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />
          {blocking.map((x) => (
            <Notice key={x} tone="error">
              {t(`couriers.problem.${x}` as AdminKey, { courier: name })}
            </Notice>
          ))}
          {outcome?.result === 'refused' && (
            <Notice tone="error">
              {t('couriers.result.refused', { courier: name, reason: outcome.error ?? '' })}
            </Notice>
          )}
          {outcome?.result === 'unsure' && (
            <Notice tone="error">{t('couriers.result.unsure', { courier: name })}</Notice>
          )}
          {book.error && <Notice tone="error">{saveErrorMessage(book.error, t)}</Notice>}
          <Button type="submit" disabled={book.isPending || blocking.length > 0 || !!outcome}>
            {book.isPending ? t('couriers.sheet.booking') : t('couriers.sheet.confirm')}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

/** A courier shipment's details and actions, inside the order's shipment row. */
export function CourierPanel({
  order: o,
  shipment: s,
}: {
  order: OrderDetail;
  shipment: Shipment;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const refresh = useRefresh(o.id);
  const canWrite = usePermission('orders.write');
  const [dialog, setDialog] = useState<'cancel' | 'letGo' | 'rebook' | null>(null);
  const [inPanel, setInPanel] = useState(false);
  const [fakeStatus, setFakeStatus] = useState<(typeof COURIER_UPDATES)[number]>('picked_up');
  const c = s.courier;
  const name = courierName(c?.courier ?? '', t);
  const sync = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/admin/shipments/{id}/sync', { params: { path: { id: s.id } } })),
    onSuccess: async () => {
      toast(t('couriers.synced', { courier: name }));
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: async (cancelledAtCourier: boolean) =>
      unwrap(
        await api.POST('/v1/admin/shipments/{id}/cancel-booking', {
          params: { path: { id: s.id } },
          body: { cancelledAtCourier },
        }),
      ),
    onSuccess: async () => {
      setDialog(null);
      toast(t('couriers.cancelled'));
      await refresh();
    },
  });
  const received = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/shipments/{id}/return', {
          params: { path: { id: s.id } },
          body: {},
        }),
      ),
    onSuccess: async () => {
      toast(t('couriers.receivedDone'));
      await refresh();
    },
  });
  const move = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/couriers/fake/parcels/{consignmentId}', {
          params: { path: { consignmentId: c?.consignmentId ?? '' } },
          body: {
            status: fakeStatus,
            ...(fakeStatus === 'delivered' || fakeStatus === 'partial_delivered'
              ? { codCollected: c?.codAmount ?? 0 }
              : {}),
          },
        }),
      ),
    onSuccess: async () => {
      toast(t('couriers.fake.moved'));
      await refresh();
    },
  });

  if (!c) {
    // A pending shipment whose booking was refused: the reason, and Book again.
    if (!s.bookingError) return null;
    return (
      <div className="flex flex-col gap-2">
        <Notice tone="error">{t('couriers.bookingError', { reason: s.bookingError })}</Notice>
      </div>
    );
  }
  const error = sync.error ?? cancel.error ?? received.error ?? move.error;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {c.consignmentId && <span>{t('couriers.consignment', { id: c.consignmentId })}</span>}
        {s.trackingUrl && (
          <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="underline">
            {t('couriers.track')}
          </a>
        )}
        {c.place?.name && <span>{t('couriers.place', { name: c.place.name })}</span>}
        {c.codCollected !== null && (
          <span>{t('couriers.collected', { amount: formatPrice(c.codCollected, locale) })}</span>
        )}
        {c.fee !== null && <span>{t('couriers.fee', { amount: formatPrice(c.fee, locale) })}</span>}
      </div>
      {c.bookingState === 'unsure' && (
        <Notice tone="error">
          {t('couriers.unsure', { courier: name, invoice: c.invoice ?? '' })}
        </Notice>
      )}
      {c.returnedByCourierAt && s.status === 'failed' && (
        <Notice>{t('couriers.returnedByCourier', { courier: name })}</Notice>
      )}
      {c.events.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">{t('couriers.events')}</summary>
          <ol className="mt-2 flex flex-col gap-1 border-l border-border pl-3">
            {c.events.map((e) => (
              <li key={`${e.status}-${e.at}`}>
                <span className="font-medium">{t(`couriers.update.${e.update}` as AdminKey)}</span>{' '}
                <span className="text-muted-foreground">
                  {dateTime(locale, e.at)}
                  {(e.message[locale] ?? e.message.en) && ` · ${e.message[locale] ?? e.message.en}`}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {canWrite && o.status !== 'cancelled' && (
        <div className="flex flex-wrap gap-2">
          {c.returnedByCourierAt && s.status === 'failed' && (
            <Button disabled={received.isPending} onClick={() => received.mutate()}>
              {t('couriers.received')}
            </Button>
          )}
          {['booked', 'shipped', 'in_transit', 'failed'].includes(s.status) && (
            <Button variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate()}>
              {t('couriers.sync', { courier: name })}
            </Button>
          )}
          {s.status === 'booked' && (
            <Button variant="quiet" onClick={() => setDialog('cancel')}>
              {t('couriers.cancelBooking')}
            </Button>
          )}
          {c.bookingState === 'unsure' && (
            <>
              <Button variant="secondary" onClick={() => setDialog('rebook')}>
                {t('couriers.bookAgain')}
              </Button>
              <Button variant="quiet" onClick={() => setDialog('letGo')}>
                {t('couriers.letGo', { courier: name })}
              </Button>
            </>
          )}
        </div>
      )}
      {canWrite && c.courier === 'fake' && c.consignmentId && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`fake-${s.id}`} className="sr-only">
            {t('couriers.fake.move')}
          </label>
          <select
            id={`fake-${s.id}`}
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={fakeStatus}
            onChange={(e) => setFakeStatus(e.target.value as typeof fakeStatus)}
          >
            {COURIER_UPDATES.filter((u) => u !== 'unknown' && u !== 'paid_out').map((u) => (
              <option key={u} value={u}>
                {t(`couriers.update.${u}` as AdminKey)}
              </option>
            ))}
          </select>
          <Button variant="secondary" disabled={move.isPending} onClick={() => move.mutate()}>
            {t('couriers.fake.move')}
          </Button>
        </div>
      )}
      {error && <Notice tone="error">{saveErrorMessage(error, t)}</Notice>}
      <ConfirmDialog
        open={dialog === 'cancel'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('couriers.cancelTitle')}
        confirmLabel={t('couriers.cancelBooking')}
        busy={cancel.isPending}
        error={cancel.error ? saveErrorMessage(cancel.error, t) : undefined}
        onConfirm={() => cancel.mutate(inPanel)}
      >
        <p>{t('couriers.cancelBody', { courier: name })}</p>
        <p className="text-sm text-muted-foreground">
          {t('couriers.cancelPanel', { courier: name })}
        </p>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={inPanel}
            onChange={(e) => setInPanel(e.target.checked)}
          />
          {t('couriers.cancelledInPanel', { courier: name })}
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'letGo'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('couriers.letGo', { courier: name })}
        confirmLabel={t('couriers.cancelBooking')}
        busy={cancel.isPending}
        error={cancel.error ? saveErrorMessage(cancel.error, t) : undefined}
        onConfirm={() => cancel.mutate(true)}
      >
        <p>{t('couriers.cancelPanel', { courier: name })}</p>
      </ConfirmDialog>
      {dialog === 'rebook' && (
        <BookDialog
          order={o}
          courier={c.courier as Courier}
          shipmentId={s.id}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
