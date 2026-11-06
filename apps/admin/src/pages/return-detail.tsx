// One return (phase-5a-plan §7): a step bar (approve, receive, inspect,
// resolve), the lines, the shopper's photos, and the action the step allows.
// Inspection says per line how many units are sellable and how many are
// damaged; resolving refunds, gives store credit, exchanges, or closes the
// return with nothing given back. Every command keeps its Idempotency-Key
// for the dialog's life.

import { RETURN_REASONS } from '@managemind/shared/orders';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Check, Package, Phone } from 'lucide-react';
import { useState } from 'react';
import { Field } from '../components/field';
import { fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { BackLink } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { RefundDialog } from '../components/refund-dialog';
import { useToast } from '../components/toast';
import { SecondaryBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { VariantPicker } from '../components/variant-picker';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateTime, idempotencyKey, lineLabel, pickText, withKey } from '../lib/orders';
import {
  photoUrl,
  RETURN_STEPS,
  type ReturnableLine,
  type ReturnDetail,
  returnableQuery,
  returnErrorMessage,
  returnQuery,
} from '../lib/returns';
import { cn } from '../lib/utils';
import { ReturnStatusChip } from './returns';

/** Refreshes the return, its order and the lists after a change. */
function useRefresh(ret: { id: string; orderId: string }) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['return', ret.id] }),
      queryClient.invalidateQueries({ queryKey: ['returns'] }),
      queryClient.invalidateQueries({ queryKey: ['order', ret.orderId] }),
      queryClient.invalidateQueries({ queryKey: ['returnable', ret.orderId] }),
    ]);
}

export function ReturnDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { t, locale } = useLocale();
  const ret = useQuery(returnQuery(id));
  useRecordPage(ret.data ? t('return.title', { number: ret.data.displayNumber }) : undefined);
  if (ret.isPending) return <p role="status">{t('loading')}</p>;
  if (ret.isError) return <Notice tone="error">{errorMessage(ret.error, t)}</Notice>;
  const r = ret.data;
  const title = t('return.title', { number: r.displayNumber });
  const sub = (
    <>
      {t('return.orderWord')}{' '}
      <Link
        to="/orders/$id"
        params={{ id: r.orderId }}
        className="underline-offset-4 hover:underline"
      >
        {r.orderNumber}
      </Link>{' '}
      · {r.customerName} · {t('return.askedAt', { date: dateTime(locale, r.createdAt) })}
    </>
  );
  const history = (
    [
      [r.createdAt, t('return.history.requested')],
      [r.approvedAt, t('return.history.approved')],
      [r.receivedAt, t('return.history.received')],
      [r.inspectedAt, t('return.history.inspected')],
      [
        r.resolvedAt,
        t(r.status === 'rejected' ? 'return.history.rejected' : 'return.history.resolved'),
      ],
    ] as const
  )
    .filter((x): x is readonly [string, string] => Boolean(x[0]))
    .reverse();
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PhoneRecordHeader to="/returns" backLabel={t('return.back')} title={title} />
      <div className="flex flex-wrap items-center gap-3 max-md:hidden">
        <BackLink to="/returns" label={t('return.back')} />
        <h1 className="text-xl leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
        <ReturnStatusChip status={r.status} />
        <span className="flex-1" />
        <Actions ret={r} />
      </div>
      <p className="-mt-2 text-muted-foreground max-md:hidden">{sub}</p>
      <div className="max-md:hidden">
        <Steps ret={r} />
      </div>
      {/* Phones: the board's summary card, with the chip, steps and actions. */}
      <section aria-label={title} className={cn(cardPadded, 'md:hidden')}>
        <div className="flex items-start gap-2.5">
          <ReturnStatusChip status={r.status} />
          <p className="min-w-0 text-[13px] leading-[18px] text-muted-foreground">{sub}</p>
        </div>
        <Steps ret={r} />
        <Actions ret={r} />
      </section>
      {r.status === 'rejected' && (
        <Notice tone="error">
          {t('return.rejectedBecause', { reason: r.rejectReason ?? '—' })}
        </Notice>
      )}
      {r.exchangeOrderId && (
        <Notice>
          {t('return.exchangedFor')}{' '}
          <Link to="/orders/$id" params={{ id: r.exchangeOrderId }} className="underline">
            {t('return.newOrder')}
          </Link>
        </Notice>
      )}
      <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="return-lines" className={cn(cardPadded, 'gap-2.5 md:gap-2.5')}>
          <h2 id="return-lines" className={cardTitle}>
            {t('return.lines')}
          </h2>
          <ul className="flex flex-col">
            {r.lines.map((l) => {
              const options = l.optionLabels
                .map((o) => pickText(o, locale))
                .filter(Boolean)
                .join(' / ');
              return (
                <li
                  key={l.orderLineId}
                  className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Package aria-hidden className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      {l.quantity} × {pickText(l.title, locale)}
                    </span>
                    {(options || l.sku) && (
                      <span className="truncate text-xs text-muted-foreground">
                        {[options, l.sku].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <SecondaryBadge>
                        {t(`return.reason.${l.reason ?? r.reason}` as AdminKey)}
                      </SecondaryBadge>
                      {r.inspectedAt && (
                        <span
                          className={cn(
                            'text-xs font-medium',
                            l.writtenOff ? 'text-danger' : 'text-success-foreground',
                          )}
                        >
                          {t('return.inspected', { sellable: l.restocked, damaged: l.writtenOff })}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{formatPrice(l.value, locale)}</span>
                </li>
              );
            })}
          </ul>
          {(r.note || r.photos.length > 0) && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <span className={fieldLabel}>{t('return.customerSaid')}</span>
              {r.note && (
                <blockquote className="border-l-2 border-border pl-3 whitespace-pre-wrap">
                  {r.note}
                </blockquote>
              )}
              {r.photos.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {r.photos.map((p, i) => (
                    <a key={p.id} href={photoUrl(r.id, p.id)} target="_blank" rel="noopener">
                      <img
                        src={photoUrl(r.id, p.id)}
                        alt={t('return.photo', { n: i + 1 })}
                        className="size-14 rounded-lg border border-border object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
        <div className="flex flex-col gap-3 md:gap-4">
          <section aria-labelledby="return-customer" className={cn(cardPadded, 'gap-3 md:gap-3')}>
            <h2 id="return-customer" className={cardTitle}>
              {t('order.customer')}
            </h2>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{r.customerName}</span>
              <span className="text-[13px] text-muted-foreground tabular-nums">
                {r.customerPhone && `${r.customerPhone} · `}
                {t('return.orderRef')}{' '}
                <Link
                  to="/orders/$id"
                  params={{ id: r.orderId }}
                  className="font-mono text-foreground"
                >
                  {r.orderNumber}
                </Link>
              </span>
            </div>
            {/* A masked phone (no customers.read) has no number to call. */}
            {r.customerPhone && !r.customerPhone.includes('•') && (
              <Button asChild variant="secondary" className="w-full">
                <a href={`tel:${r.customerPhone.replace(/\D/g, '')}`}>
                  <Phone aria-hidden />
                  {t('order.call')}
                </a>
              </Button>
            )}
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <span className={fieldLabel}>{t('return.why')}</span>
              <span>{t(`return.reason.${r.reason}` as AdminKey)}</span>
              {r.shopperPaysReturn !== null && (
                <span className="text-[13px] text-muted-foreground">
                  {t(r.shopperPaysReturn ? 'return.shopperPays' : 'return.storePays')}
                </span>
              )}
              {r.credit > 0 && (
                <span className="text-[13px] text-muted-foreground">
                  {t('return.credit', { amount: formatPrice(r.credit, locale) })}
                </span>
              )}
            </div>
          </section>
          <section aria-labelledby="return-history" className={cardPadded}>
            <h2 id="return-history" className={cardTitle}>
              {t('return.history')}
            </h2>
            <ol className="flex flex-col gap-3">
              {history.map(([when, text]) => (
                <li key={text} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/60"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span>{text}</span>
                    <span className="text-xs text-muted-foreground">{dateTime(locale, when)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

/** The board's step bar: a numbered dot per step, a check once done. */
function Steps({ ret }: { ret: ReturnDetail }) {
  const { t } = useLocale();
  if (ret.status === 'rejected') return null;
  const reached = RETURN_STEPS.indexOf(ret.status as (typeof RETURN_STEPS)[number]);
  return (
    <ol className="flex items-center" aria-label={t('return.progress')}>
      {RETURN_STEPS.map((step, i) => {
        const done = i < reached || (i === reached && i === RETURN_STEPS.length - 1);
        const now = i === reached && !done;
        return (
          <li
            key={step}
            aria-current={now ? 'step' : undefined}
            className={cn(
              'flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground after:mx-2 after:h-px after:min-w-4 after:flex-1 after:bg-border last:after:hidden',
              'flex-1 last:flex-none',
              now && 'font-medium text-foreground',
              done && 'text-foreground',
            )}
          >
            <span
              className={cn(
                'inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold',
                done && 'border-primary bg-primary text-primary-foreground',
                now &&
                  'border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_15%,transparent)]',
              )}
            >
              {done ? <Check aria-hidden className="size-3" /> : i + 1}
            </span>
            <span className="truncate max-md:sr-only">{t(`return.step.${step}` as AdminKey)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Actions({ ret }: { ret: ReturnDetail }) {
  const { t } = useLocale();
  const toast = useToast();
  const refresh = useRefresh(ret);
  const canWrite = usePermission('orders.write');
  const canRefund = usePermission('payments.refund');
  const [key, setKey] = useState(idempotencyKey);
  const [dialog, setDialog] = useState<
    'reject' | 'inspect' | 'refund' | 'exchange' | 'close' | null
  >(null);
  /** What an exchange left to give back, to start the refund from. */
  const [leftover, setLeftover] = useState<number | undefined>(undefined);
  const move = useMutation({
    mutationFn: async (step: 'approve' | 'send' | 'receive') => {
      const path = {
        approve: '/v1/admin/returns/{id}/approve',
        send: '/v1/admin/returns/{id}/send',
        receive: '/v1/admin/returns/{id}/receive',
      } as const;
      return unwrap(
        await api.POST(path[step], { params: { path: { id: ret.id }, ...withKey(key).params } }),
      );
    },
    onSuccess: async () => {
      setKey(idempotencyKey());
      await refresh();
      toast(t('account.saved'));
    },
  });
  if (!canWrite) return null;
  const s = ret.status;
  return (
    <>
      <span className="flex flex-wrap gap-2 max-md:w-full max-md:[&>*]:flex-1">
        {s === 'requested' && (
          <>
            <Button variant="secondary" onClick={() => setDialog('reject')}>
              {t('return.reject')}
            </Button>
            <Button disabled={move.isPending} onClick={() => move.mutate('approve')}>
              <Check aria-hidden />
              {t('return.approve')}
            </Button>
          </>
        )}
        {s === 'approved' && (
          <>
            <Button
              variant="secondary"
              disabled={move.isPending}
              onClick={() => move.mutate('send')}
            >
              {t('return.send')}
            </Button>
            <Button disabled={move.isPending} onClick={() => move.mutate('receive')}>
              {t('return.receive')}
            </Button>
          </>
        )}
        {s === 'in_transit' && (
          <Button disabled={move.isPending} onClick={() => move.mutate('receive')}>
            {t('return.receive')}
          </Button>
        )}
        {s === 'received' && (
          <Button onClick={() => setDialog('inspect')}>{t('return.inspect')}</Button>
        )}
        {s === 'inspected' && (
          <>
            <Button variant="secondary" onClick={() => setDialog('close')}>
              {t('return.close')}
            </Button>
            <Button variant="secondary" onClick={() => setDialog('exchange')}>
              {t('return.exchange')}
            </Button>
            {canRefund && <Button onClick={() => setDialog('refund')}>{t('return.refund')}</Button>}
          </>
        )}
      </span>
      {move.error && (
        <Notice tone="error" className="w-full">
          {returnErrorMessage(move.error, (e) => saveErrorMessage(e, t))}
        </Notice>
      )}
      {dialog === 'reject' && (
        <ReasonDialog ret={ret} kind="reject" onClose={() => setDialog(null)} />
      )}
      {dialog === 'close' && (
        <ReasonDialog ret={ret} kind="close" onClose={() => setDialog(null)} />
      )}
      {dialog === 'inspect' && <InspectDialog ret={ret} onClose={() => setDialog(null)} />}
      {dialog === 'exchange' && (
        <ExchangeDialog
          ret={ret}
          onClose={() => setDialog(null)}
          onRefundDue={(amount) => {
            setLeftover(amount);
            setDialog(canRefund ? 'refund' : null);
          }}
        />
      )}
      {dialog === 'refund' && (
        <RefundDialog
          orderId={ret.orderId}
          returnId={ret.id}
          suggested={leftover}
          onClose={() => {
            setLeftover(undefined);
            setDialog(null);
          }}
        />
      )}
    </>
  );
}

/** Reject a request, or close an inspected return with nothing given back: both say why. */
function ReasonDialog({
  ret,
  kind,
  onClose,
}: {
  ret: ReturnDetail;
  kind: 'reject' | 'close';
  onClose: () => void;
}) {
  const { t } = useLocale();
  const refresh = useRefresh(ret);
  const [key] = useState(idempotencyKey);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST(
          kind === 'reject' ? '/v1/admin/returns/{id}/reject' : '/v1/admin/returns/{id}/close',
          {
            params: { path: { id: ret.id }, ...withKey(key).params },
            body: { reason: reason.trim() },
          },
        ),
      ),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t(kind === 'reject' ? 'return.reject' : 'return.close')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (reason.trim()) save.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          {t(kind === 'reject' ? 'return.rejectHint' : 'return.closeHint')}
        </p>
        <Field
          label={t('return.why')}
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
          error={tried && !reason.trim() ? t('form.required') : undefined}
        />
        {save.error && (
          <Notice tone="error">
            {returnErrorMessage(save.error, (e) => saveErrorMessage(e, t))}
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t(kind === 'reject' ? 'return.reject' : 'return.close')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Every unit back is sellable (restocked) or damaged (written off). */
function InspectDialog({ ret, onClose }: { ret: ReturnDetail; onClose: () => void }) {
  const { t, locale } = useLocale();
  const refresh = useRefresh(ret);
  const [key] = useState(idempotencyKey);
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const counts = ret.lines.map((l) => {
    const d = Number(damaged[l.orderLineId] ?? 0);
    return { line: l, damaged: d, ok: Number.isInteger(d) && d >= 0 && d <= l.quantity };
  });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/returns/{id}/inspect', {
          params: { path: { id: ret.id }, ...withKey(key).params },
          body: {
            lines: counts.map((c) => ({
              orderLineId: c.line.orderLineId,
              sellable: c.line.quantity - c.damaged,
              damaged: c.damaged,
            })),
          },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('return.inspect')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (counts.every((c) => c.ok)) save.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">{t('return.inspectHint')}</p>
        {counts.map(({ line, damaged: d, ok }) => (
          <div key={line.orderLineId} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex-1">
              {lineLabel(line, locale)}
              <span className="block text-xs text-muted-foreground">
                {t('return.sellableOf', {
                  sellable: ok ? line.quantity - d : '—',
                  of: line.quantity,
                })}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span aria-hidden>{t('return.damaged')}</span>
              <Input
                className="w-20"
                inputMode="numeric"
                aria-label={`${t('return.damaged')}: ${lineLabel(line, locale)}`}
                value={damaged[line.orderLineId] ?? '0'}
                aria-invalid={!ok}
                onChange={(e) => setDamaged({ ...damaged, [line.orderLineId]: e.target.value })}
              />
            </span>
          </div>
        ))}
        {save.error && (
          <Notice tone="error">
            {returnErrorMessage(save.error, (e) => saveErrorMessage(e, t))}
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending || !counts.every((c) => c.ok)}>
            {t('return.inspectSave')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** A replacement order at today's prices, with the returned units as credit. */
function ExchangeDialog({
  ret,
  onClose,
  onRefundDue,
}: {
  ret: ReturnDetail;
  onClose: () => void;
  /** The credit was more than the new order: refund the rest now. */
  onRefundDue: (amount: number) => void;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const refresh = useRefresh(ret);
  const [key] = useState(idempotencyKey);
  const [lines, setLines] = useState<{ variantId: string; label: string; quantity: number }[]>([]);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/returns/{id}/exchange', {
          params: { path: { id: ret.id }, ...withKey(key).params },
          body: { lines: lines.map(({ variantId, quantity }) => ({ variantId, quantity })) },
        }),
      ),
    onSuccess: async (done) => {
      await refresh();
      toast(t('return.exchanged', { number: done.order.displayNumber }));
      if (done.refundDue > 0) {
        onRefundDue(done.refundDue);
        return;
      }
      onClose();
      await navigate({ to: '/orders/$id', params: { id: done.order.id } });
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('return.exchange')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t('return.exchangeHint', { amount: formatPrice(ret.credit, locale) })}
        </p>
        <VariantPicker
          onPick={(row) =>
            setLines((now) =>
              now.some((l) => l.variantId === row.variantId)
                ? now
                : [
                    ...now,
                    {
                      variantId: row.variantId,
                      label: lineLabel(
                        { title: row.titles, optionLabels: row.optionLabels },
                        locale,
                      ),
                      quantity: 1,
                    },
                  ],
            )
          }
        />
        <ul className="flex flex-col gap-2 text-sm">
          {lines.map((l, i) => (
            <li key={l.variantId} className="flex items-center gap-3">
              <span className="flex-1">{l.label}</span>
              <Input
                className="w-20"
                inputMode="numeric"
                aria-label={t('order.quantityOf', { item: l.label })}
                value={String(l.quantity)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setLines(lines.map((x, j) => (j === i ? { ...x, quantity: n } : x)));
                }}
              />
              <Button variant="secondary" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                {t('return.remove')}
              </Button>
            </li>
          ))}
        </ul>
        {save.error && (
          <Notice tone="error">
            {returnErrorMessage(save.error, (e) => saveErrorMessage(e, t))}
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            disabled={
              save.isPending ||
              !lines.length ||
              lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1)
            }
            onClick={() => save.mutate()}
          >
            {t('return.exchangeSave')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Staff start a return from the order page: approved at once. */
export function CreateReturnDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lines = useQuery(returnableQuery(orderId));
  const [key] = useState(idempotencyKey);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<(typeof RETURN_REASONS)[number]>('changed_mind');
  const [note, setNote] = useState('');
  const open = (lines.data ?? []).filter((l) => l.returnable > 0);
  const chosen = open
    .map((l) => ({ line: l, quantity: Number(qty[l.orderLineId] ?? 0) }))
    .filter((c) => c.quantity > 0);
  const bad = open.some((l: ReturnableLine) => {
    const n = Number(qty[l.orderLineId] ?? 0);
    return !Number.isInteger(n) || n < 0 || n > l.returnable;
  });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/returns', {
          params: withKey(key).params,
          body: {
            orderId,
            reason,
            ...(note.trim() ? { note: note.trim() } : {}),
            lines: chosen.map((c) => ({ orderLineId: c.line.orderLineId, quantity: c.quantity })),
          },
        }),
      ),
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['returns'] }),
      ]);
      onClose();
      await navigate({ to: '/returns/$id', params: { id: created.id } });
    },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={t('return.create')}>
      {lines.isPending && <p role="status">{t('loading')}</p>}
      {lines.data && open.length === 0 && <Notice>{t('return.nothingReturnable')}</Notice>}
      {open.length > 0 && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!bad && chosen.length) save.mutate();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('return.lines')}</legend>
            {open.map((l) => (
              <div key={l.orderLineId} className="flex items-center gap-3 text-sm">
                <span className="flex-1">
                  {lineLabel(l, locale)}
                  <span className="block text-xs text-muted-foreground">
                    {t('return.returnable', { count: l.returnable })}
                  </span>
                </span>
                <Input
                  className="w-20"
                  inputMode="numeric"
                  aria-label={t('order.quantityOf', { item: lineLabel(l, locale) })}
                  value={qty[l.orderLineId] ?? ''}
                  onChange={(e) => setQty({ ...qty, [l.orderLineId]: e.target.value })}
                />
              </div>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('return.reason')}
            <select
              className="h-10 rounded-lg border border-input bg-transparent px-3 text-base shadow-xs md:h-9 md:text-sm dark:bg-white/[0.045] font-normal"
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              {RETURN_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`return.reason.${r}` as AdminKey)}
                </option>
              ))}
            </select>
          </label>
          <Field
            label={t('return.note')}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          {bad && <Notice tone="error">{t('form.invalid')}</Notice>}
          {save.error && (
            <Notice tone="error">
              {returnErrorMessage(save.error, (e) => saveErrorMessage(e, t))}
            </Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || bad || !chosen.length}>
              {t('return.createSave')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
