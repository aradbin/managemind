// A supplier's page (phase-8-plan §3.1, §3.7): the details, its purchase
// orders, and, for those who pay suppliers, the khata: receipts and payments
// with the running balance, and a payment to record.
import { formatNumber } from '@managemind/shared/i18n';
import { formatPhone } from '@managemind/shared/phone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Archive, ArchiveRestore, Banknote, Plus, SquarePen, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { RowMenu, RowMenuItem, RowMenuSeparator } from '../components/list-tools';
import { Notice } from '../components/notice';
import { BackLink } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { useToast } from '../components/toast';
import { StatusBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardFrame, cardPadded, cardTitle } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { StatRow } from '../components/ui/stat-row';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { readPrice } from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateOnly, idempotencyKey } from '../lib/orders';
import {
  dhakaToday,
  PURCHASING_KEYS,
  priceOrDash,
  SPEND_METHODS,
  type SpendMethod,
  type SupplierLedger,
  supplierLedgerQuery,
  supplierQuery,
} from '../lib/purchasing';
import { cn } from '../lib/utils';
import { PoStatusChip } from './purchase-orders';
import { balanceText, SupplierDialog } from './suppliers';

export function SupplierDetailPage() {
  const { t, locale } = useLocale();
  const { id } = useParams({ strict: false }) as { id: string };
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('purchasing.write');
  const canPay = usePermission('purchasing.pay');
  const supplier = useQuery(supplierQuery(id));
  const ledger = useQuery({ ...supplierLedgerQuery(id), enabled: canPay });
  const orders = useQuery({
    queryKey: ['purchase-orders', { supplierId: id }] as const,
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/purchase-orders', { params: { query: { supplierId: id } } })),
  });
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const archive = useMutation({
    mutationFn: async (archived: boolean) =>
      unwrap(
        await api.PATCH('/v1/admin/suppliers/{id}', {
          params: { path: { id } },
          body: { archived },
        }),
      ),
    onSuccess: async () => {
      for (const key of PURCHASING_KEYS) await queryClient.invalidateQueries({ queryKey: key });
      toast(t('suppliers.saved'));
    },
  });

  useRecordPage(supplier.data?.name);
  if (supplier.isPending) return <p role="status">{t('loading')}</p>;
  if (supplier.isError) return <Notice tone="error">{errorMessage(supplier.error, t)}</Notice>;
  const s = supplier.data;
  const year = new Date().getFullYear();
  const thisYear = (ledger.data?.entries ?? []).filter(
    (e) => new Date(e.on).getFullYear() === year,
  );
  const received = thisYear.filter((e) => e.kind === 'receipt').reduce((n, e) => n + e.amount, 0);
  const paid = thisYear.filter((e) => e.kind === 'payment').reduce((n, e) => n - e.amount, 0);
  const toReceive = (orders.data?.items ?? []).filter(
    (o) => o.status === 'ordered' || o.status === 'partially_received',
  ).length;
  const sub = [s.contactName, ...s.phones.map((p) => formatPhone(p))].filter(Boolean).join(' · ');
  const details: [string, string][] = [
    ...(s.email ? [[t('suppliers.email'), s.email] as [string, string]] : []),
    ...(s.address ? [[t('suppliers.address'), s.address.line1] as [string, string]] : []),
    ...(s.note ? [[t('suppliers.note'), s.note] as [string, string]] : []),
    [t('suppliers.since'), dateOnly(locale, s.createdAt)],
  ];
  const menu = (trigger: 'outline' | 'ghost') =>
    canWrite && (
      <RowMenu label={t('list.moreActions')} trigger={trigger} page>
        <RowMenuItem onSelect={() => setEditing(true)}>
          <SquarePen aria-hidden />
          {t('suppliers.editDetails')}
        </RowMenuItem>
        <RowMenuSeparator />
        <RowMenuItem disabled={archive.isPending} onSelect={() => archive.mutate(!s.archived)}>
          {s.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {s.archived ? t('suppliers.unarchive') : t('suppliers.archive')}
        </RowMenuItem>
      </RowMenu>
    );
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PhoneRecordHeader
        to="/inventory/suppliers"
        backLabel={t('suppliers.back')}
        title={t('suppliers.one')}
      >
        {menu('ghost')}
      </PhoneRecordHeader>
      <div className="flex flex-wrap items-center gap-3">
        <span className="max-md:hidden">
          <BackLink to="/inventory/suppliers" label={t('suppliers.back')} />
        </span>
        <h1 className="truncate text-xl leading-7 font-semibold tracking-[-0.01em]">{s.name}</h1>
        {s.archived && <StatusBadge tone="outline">{t('suppliers.archivedBadge')}</StatusBadge>}
        <span className="flex-1" />
        {!s.archived && (
          <span className="flex gap-2 max-md:w-full max-md:[&>*]:flex-1">
            {canWrite && (
              <Button variant="secondary" asChild>
                <Link to="/inventory/purchase-orders/new" search={{ supplierId: s.id }}>
                  <Plus aria-hidden />
                  {t('suppliers.newPurchaseOrder')}
                </Link>
              </Button>
            )}
            {canPay && (
              <Button onClick={() => setPaying(true)}>
                <Banknote aria-hidden />
                {t('suppliers.recordPayment')}
              </Button>
            )}
          </span>
        )}
        <span className="max-md:hidden">{menu('outline')}</span>
      </div>
      {sub && <p className="-mt-2 text-muted-foreground">{sub}</p>}
      {s.archived && <Notice>{t('suppliers.archived')}</Notice>}
      {archive.isError && <Notice tone="error">{saveErrorMessage(archive.error, t)}</Notice>}
      <StatRow
        stats={[
          ...(s.balance !== undefined
            ? [{ label: t('suppliers.balance'), value: balanceText(s.balance, t, locale) }]
            : []),
          ...(canPay
            ? [
                { label: t('suppliers.receivedYear'), value: priceOrDash(received, locale) },
                { label: t('suppliers.paidYear'), value: priceOrDash(paid, locale) },
              ]
            : []),
          { label: t('suppliers.toReceive'), value: formatNumber(locale, toReceive) },
        ]}
      />
      <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 md:gap-4">
          {canPay && (
            <section
              aria-labelledby="ledger-h"
              className={cn(cardFrame, 'flex flex-col gap-3 pt-4 pb-2 md:pt-5')}
            >
              <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 md:px-5">
                <h2 id="ledger-h" className={cardTitle}>
                  {t('suppliers.ledger')}
                </h2>
                <span className="text-[13px] text-muted-foreground">
                  {t('suppliers.ledgerHint')}
                </span>
              </div>
              {ledger.isError && <Notice tone="error">{errorMessage(ledger.error, t)}</Notice>}
              {ledger.data && <LedgerTable ledger={ledger.data} supplierId={id} />}
            </section>
          )}
          <section
            aria-labelledby="pos-h"
            className={cn(cardFrame, 'flex flex-col gap-2 pt-4 pb-2 md:pt-5')}
          >
            <div className="flex min-h-5 items-center justify-between gap-3 px-4 md:px-5">
              <h2 id="pos-h" className={cardTitle}>
                {t('po.title')}
              </h2>
              {canWrite && !s.archived && (
                <Button variant="ghost" className="-my-1 -mr-2 h-7 px-2 md:h-7" asChild>
                  <Link to="/inventory/purchase-orders/new" search={{ supplierId: s.id }}>
                    <Plus aria-hidden />
                    {t('suppliers.newShort')}
                  </Link>
                </Button>
              )}
            </div>
            {orders.data && orders.data.items.length === 0 && (
              <p className="px-4 pt-1 pb-3 text-muted-foreground md:px-5">{t('po.empty')}</p>
            )}
            {orders.data && orders.data.items.length > 0 && (
              <ul>
                {orders.data.items.map((o) => (
                  <li
                    key={o.id}
                    className="flex min-h-[52px] items-center gap-3 border-t border-border px-4 md:px-5"
                  >
                    <Link
                      to="/inventory/purchase-orders/$id"
                      params={{ id: o.id }}
                      className="font-mono font-medium tracking-[0.02em]"
                    >
                      {o.reference}
                    </Link>
                    <PoStatusChip status={o.status} />
                    <span className="flex-1 text-[13px] text-muted-foreground">
                      {t('po.progress', { received: o.received, ordered: o.ordered })}
                    </span>
                    {o.total !== undefined && (
                      <span className="font-medium tabular-nums">
                        {priceOrDash(o.total, locale)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <section aria-labelledby="details-h" className={cardPadded}>
          <div className="flex min-h-5 items-center justify-between gap-3">
            <h2 id="details-h" className={cardTitle}>
              {t('suppliers.details')}
            </h2>
            {canWrite && (
              <Button
                variant="ghost"
                className="-my-1 -mr-2 h-7 px-2 md:h-7"
                onClick={() => setEditing(true)}
              >
                {t('order.editShort')}
              </Button>
            )}
          </div>
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="whitespace-pre-line">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      {editing && <SupplierDialog supplier={s} onClose={() => setEditing(false)} />}
      {paying && <PaymentDialog supplierId={id} onClose={() => setPaying(false)} />}
    </div>
  );
}

function LedgerTable({ ledger, supplierId }: { ledger: SupplierLedger; supplierId: string }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<SupplierLedger['entries'][number] | null>(null);
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/v1/admin/supplier-payments/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      for (const key of PURCHASING_KEYS) await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
      toast(t('payment.deleted'));
      setRemoving(null);
    },
  });
  if (!ledger.entries.length)
    return <p className="px-4 pb-3 text-muted-foreground md:px-5">{t('suppliers.ledgerEmpty')}</p>;
  // Newest first, as drawn.
  const entries = [...ledger.entries].reverse();
  const grid =
    'grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[96px_minmax(0,1fr)_110px_110px_36px]';
  return (
    <>
      <div
        aria-hidden
        className={cn(
          grid,
          'h-9 border-y border-border bg-muted pr-3 pl-4 font-medium max-md:hidden md:pl-5',
        )}
      >
        <span>{t('payment.date')}</span>
        <span>{t('suppliers.entry')}</span>
        <span className="text-right">{t('payment.amount')}</span>
        <span className="text-right">{t('suppliers.balance')}</span>
        <span />
      </div>
      <ul aria-label={t('suppliers.ledger')} className="max-md:border-t max-md:border-border">
        {entries.map((e, i) => (
          <li
            key={e.id ?? `opening-${i}`}
            className={cn(
              grid,
              'min-h-12 border-b border-border pr-3 pl-4 last:border-b-0 md:pl-5',
            )}
          >
            <span className="text-muted-foreground tabular-nums">{dateOnly(locale, e.on)}</span>
            <span className="truncate">
              {e.kind === 'opening'
                ? t('suppliers.entry.opening')
                : t(`suppliers.entry.${e.kind}`, { reference: e.reference ?? '' })}
            </span>
            <span
              className={cn('text-right tabular-nums', e.amount < 0 && 'text-success-foreground')}
            >
              {e.amount < 0 ? `−${priceOrDash(-e.amount, locale)}` : priceOrDash(e.amount, locale)}
            </span>
            <span className="text-right font-medium tabular-nums max-md:hidden">
              {priceOrDash(e.balance, locale)}
            </span>
            <span className="flex justify-end max-md:hidden">
              {e.kind === 'payment' && e.id && (
                <RowMenu label={t('suppliers.entry.payment', { reference: e.reference ?? '' })}>
                  <RowMenuItem danger onSelect={() => setRemoving(e)}>
                    <Trash2 aria-hidden />
                    {t('payment.delete')}
                  </RowMenuItem>
                </RowMenu>
              )}
            </span>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('payment.delete')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => removing?.id && remove.mutate(removing.id)}
      >
        <p>{t('payment.deleteBody', { amount: priceOrDash(-(removing?.amount ?? 0), locale) })}</p>
      </ConfirmDialog>
    </>
  );
}

function PaymentDialog({ supplierId, onClose }: { supplierId: string; onClose: () => void }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [paidOn, setPaidOn] = useState(dhakaToday());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SpendMethod>('cash');
  const [reference, setReference] = useState('');
  const [key] = useState(idempotencyKey);
  const value = readPrice(amount);
  const valid = typeof value === 'number' && value > 0 && paidOn !== '';
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/supplier-payments', {
          params: { header: { 'idempotency-key': key } },
          body: {
            supplierId,
            paidOn,
            amount: value as number,
            method,
            reference: reference.trim() || null,
          },
        }),
      ),
    onSuccess: async () => {
      for (const k of PURCHASING_KEYS) await queryClient.invalidateQueries({ queryKey: k });
      toast(t('payment.saved'));
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('payment.title')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <Field
          label={t('payment.date')}
          type="date"
          value={paidOn}
          max={dhakaToday()}
          onChange={(e) => setPaidOn(e.target.value)}
        />
        <Field
          label={t('payment.amount')}
          inputMode="decimal"
          value={amount}
          required
          onChange={(e) => setAmount(e.target.value)}
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{t('payment.method')}</legend>
          <div className="flex flex-wrap gap-x-4">
            {SPEND_METHODS.map((m) => (
              <label key={m} className="flex min-h-10 items-center gap-2 md:min-h-9">
                <input
                  type="radio"
                  name="method"
                  checked={method === m}
                  onChange={() => setMethod(m)}
                />
                {t(`purchasing.method.${m}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label={`${t('payment.reference')} (${t('form.optional')})`}
          hint={t('payment.referenceHint')}
          value={reference}
          maxLength={100}
          onChange={(e) => setReference(e.target.value)}
        />
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={!valid || save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
