// A supplier's page (phase-8-plan §3.1, §3.7): the details, its purchase
// orders, and, for those who pay suppliers, the khata: receipts and payments
// with the running balance, and a payment to record.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { readPrice } from '../lib/catalog';
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

  if (supplier.isPending) return <p role="status">{t('loading')}</p>;
  if (supplier.isError) return <Notice tone="error">{errorMessage(supplier.error, t)}</Notice>;
  const s = supplier.data;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        className="mb-0"
        parent={{ to: '/inventory/suppliers', label: t('suppliers.title') }}
        title={s.name}
        description={[s.contactName, ...s.phones].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            {canPay && !s.archived && (
              <Button onClick={() => setPaying(true)}>{t('suppliers.recordPayment')}</Button>
            )}
            {canWrite && !s.archived && (
              <Button variant="secondary" asChild>
                <Link to="/inventory/purchase-orders/new" search={{ supplierId: s.id }}>
                  {t('suppliers.newPurchaseOrder')}
                </Link>
              </Button>
            )}
            {canWrite && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('action.edit')}
              </Button>
            )}
            {canWrite && (
              <Button
                variant="ghost"
                disabled={archive.isPending}
                onClick={() => archive.mutate(!s.archived)}
              >
                {s.archived ? t('suppliers.unarchive') : t('suppliers.archive')}
              </Button>
            )}
          </>
        }
      />
      {s.archived && <Notice tone="info">{t('suppliers.archived')}</Notice>}
      {archive.isError && <Notice tone="error">{saveErrorMessage(archive.error, t)}</Notice>}
      {s.balance !== undefined && (
        <p className="text-xl font-semibold">{balanceText(s.balance, t, locale)}</p>
      )}
      {(s.email || s.address || s.note) && (
        <dl className="grid gap-2 rounded-xl border border-border bg-background p-4 text-sm md:grid-cols-[10rem_1fr]">
          {s.email && (
            <>
              <dt className="text-muted-foreground">{t('suppliers.email')}</dt>
              <dd>{s.email}</dd>
            </>
          )}
          {s.address && (
            <>
              <dt className="text-muted-foreground">{t('suppliers.address')}</dt>
              <dd>{s.address.line1}</dd>
            </>
          )}
          {s.note && (
            <>
              <dt className="text-muted-foreground">{t('suppliers.note')}</dt>
              <dd className="whitespace-pre-line">{s.note}</dd>
            </>
          )}
        </dl>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('po.title')}</h2>
        {orders.data && orders.data.items.length === 0 && (
          <p className="text-muted-foreground">{t('po.empty')}</p>
        )}
        {orders.data && orders.data.items.length > 0 && (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background">
            {orders.data.items.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 p-4">
                <Link
                  to="/inventory/purchase-orders/$id"
                  params={{ id: o.id }}
                  className="font-medium text-primary hover:underline"
                >
                  {o.reference}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {t(`po.status.${o.status}`)} ·{' '}
                  {t('po.progress', { received: o.received, ordered: o.ordered })}
                </span>
                {o.total !== undefined && (
                  <span className="ml-auto">{priceOrDash(o.total, locale)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canPay && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('suppliers.ledger')}</h2>
          {ledger.isError && <Notice tone="error">{errorMessage(ledger.error, t)}</Notice>}
          {ledger.data && <LedgerTable ledger={ledger.data} supplierId={id} />}
        </section>
      )}
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
    return <p className="text-muted-foreground">{t('suppliers.ledgerEmpty')}</p>;
  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border bg-background">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('suppliers.ledger')}</caption>
          <thead className="border-b border-border bg-muted/60 text-sm">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('payment.date')}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('suppliers.ledger')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('payment.amount')}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('suppliers.balance')}
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">{t('inventory.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ledger.entries.map((e, i) => (
              <tr key={e.id ?? `opening-${i}`}>
                <td className="whitespace-nowrap px-4 py-3">{dateOnly(locale, e.on)}</td>
                <td className="px-4 py-3">
                  {e.kind === 'opening'
                    ? t('suppliers.entry.opening')
                    : t(`suppliers.entry.${e.kind}`, { reference: e.reference ?? '' })}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {e.amount < 0
                    ? `−${priceOrDash(-e.amount, locale)}`
                    : priceOrDash(e.amount, locale)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {priceOrDash(e.balance, locale)}
                </td>
                <td className="px-4 py-3 text-right">
                  {e.kind === 'payment' && e.id && (
                    <Button variant="ghost" onClick={() => setRemoving(e)}>
                      {t('action.delete')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
                  className="size-4 accent-primary"
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
