// Reports → COD reconciliation (phase-7-plan §3.7): for a range of delivery
// dates, what each courier collected, charged and paid out, the parcels
// still unpaid, and the differences. Owners and managers import a courier's
// payout statement or record a payout by hand, checked before it is saved.
import { COURIERS, type Courier } from '@managemind/shared/orders';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/couriers';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice, readPrice } from '../lib/catalog';
import { courierName } from '../lib/couriers';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateTime } from '../lib/orders';
import { type Parsed, parseFile } from '../lib/sheet';
import { Table } from './reports';

const DHAKA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' });
const day = (d: Date) => DHAKA_DAY.format(d);

export function CodReportPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canRecord = usePermission('payments.reconcile');
  const [from, setFrom] = useState(day(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(day(new Date()));
  const [courier, setCourier] = useState<Courier | ''>('');
  const [dialog, setDialog] = useState<'import' | 'record' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const key = ['reports', 'cod', from, to, courier] as const;
  const report = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/reports/cod', {
          params: { query: { from, to, ...(courier ? { courier } : {}) } },
        }),
      ),
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/v1/admin/courier-payouts/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ['reports', 'cod'] });
    },
  });
  const money = (n: number) => formatPrice(n, locale);
  const r = report.data;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        parent={{ to: '/reports', label: t('nav.reports') }}
        title={t('cod.title')}
        description={t('cod.description')}
        actions={
          canRecord ? (
            <>
              <Button variant="secondary" onClick={() => setDialog('record')}>
                {t('cod.record')}
              </Button>
              <Button onClick={() => setDialog('import')}>{t('cod.import')}</Button>
            </>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={t('reports.from')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          label={t('reports.to')}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="cod-courier" className="text-sm font-medium">
            {t('cod.courier')}
          </label>
          <select
            id="cod-courier"
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={courier}
            onChange={(e) => setCourier(e.target.value as Courier | '')}
          >
            <option value="">{t('cod.allCouriers')}</option>
            {COURIERS.map((c) => (
              <option key={c} value={c}>
                {courierName(c, t)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {report.isPending && <p role="status">{t('loading')}</p>}
      {report.isError && <Notice tone="error">{errorMessage(report.error, t)}</Notice>}
      {r && (
        <>
          <Table
            caption={t('cod.summary')}
            head={[
              t('cod.courier'),
              t('cod.delivered'),
              t('cod.asked'),
              t('cod.collected'),
              t('cod.fees'),
              t('cod.net'),
              t('cod.paidOut'),
              t('cod.outstanding'),
              t('cod.returned'),
              t('cod.returnCharges'),
            ]}
            rows={r.couriers.map((c) => [
              courierName(c.courier, t),
              c.delivered,
              money(c.codAsked),
              money(c.collected),
              money(c.fees),
              money(c.net),
              money(c.paidOut),
              money(c.outstanding),
              c.returned,
              money(c.returnCharges),
            ])}
            empty={t('cod.none')}
          />
          <Table
            caption={t('cod.outstandingList')}
            head={[t('order.number'), t('cod.courier'), t('cod.net'), t('order.delivered')]}
            rows={r.outstanding.map((o) => [
              `${o.displayNumber}${o.consignmentId ? ` · ${o.consignmentId}` : ''}`,
              courierName(o.courier, t),
              money(o.net),
              t('cod.days', { n: o.days }),
            ])}
            empty={t('cod.none')}
          />
          <Table
            caption={t('cod.differences')}
            head={[t('order.number'), t('cod.courier'), t('cod.differences')]}
            rows={r.differences.map((d) => [
              `${d.displayNumber}${d.consignmentId ? ` · ${d.consignmentId}` : ''}`,
              courierName(d.courier, t),
              d.kind === 'collected'
                ? t('cod.diff.collected', { collected: money(d.collected), asked: money(d.asked) })
                : t('cod.diff.paid', {
                    paid: money(d.paidNet ?? 0),
                    expected: money(d.expectedNet),
                  }),
            ])}
            empty={t('cod.none')}
          />
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5">
            <h2 className="font-semibold">{t('cod.payouts')}</h2>
            {r.payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('cod.none')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {r.payouts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{courierName(p.courier, t)}</span> ·{' '}
                      {p.reference} · {dateTime(locale, p.paidAt)} ·{' '}
                      {t(`cod.source.${p.source}` as AdminKey)}
                    </span>
                    <span className="tabular-nums">
                      {money(p.amount)} · {p.parcels}
                    </span>
                    {canRecord && (
                      <Button variant="quiet" onClick={() => setDeleting(p.id)}>
                        {t('cod.delete')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-sm">
            <Link to="/orders/courier-returns" className="underline">
              {t('couriers.returns.title')}
            </Link>
          </p>
        </>
      )}
      {dialog && (
        <PayoutDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            toast(t('cod.saved'));
            await queryClient.invalidateQueries({ queryKey: ['reports', 'cod'] });
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('cod.deleteTitle')}
        confirmLabel={t('cod.delete')}
        busy={remove.isPending}
        error={remove.error ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        <p>{t('cod.deleteBody')}</p>
      </ConfirmDialog>
    </div>
  );
}

/** A statement's rows, or consignments typed by hand: checked first, then recorded as one payout. */
function PayoutDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: 'import' | 'record';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useLocale();
  const [courier, setCourier] = useState<Courier>('steadfast');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(day(new Date()));
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [cols, setCols] = useState({ consignment: 0, collected: -1, fee: -1 });
  const [typed, setTyped] = useState('');
  const amount = (s: string | undefined) => {
    const p = s ? readPrice(s.replace(/[৳,\s]/g, '')) : null;
    return p ?? undefined;
  };
  const rows =
    mode === 'import'
      ? (parsed?.rows ?? [])
          .map((row) => ({
            consignmentId: String(row[cols.consignment] ?? '').trim(),
            ...(cols.collected >= 0 && amount(row[cols.collected]) !== undefined
              ? { collected: amount(row[cols.collected]) }
              : {}),
            ...(cols.fee >= 0 && amount(row[cols.fee]) !== undefined
              ? { fee: amount(row[cols.fee]) }
              : {}),
          }))
          .filter((x) => x.consignmentId)
      : typed
          .split(/\s*[\n,]\s*/)
          .map((x) => x.trim())
          .filter(Boolean)
          .map((consignmentId) => ({ consignmentId }));
  const body = (preview: boolean) => ({
    courier,
    reference: reference.trim(),
    paidAt: new Date(`${paidAt}T12:00:00+06:00`).toISOString(),
    source: mode === 'import' ? ('import' as const) : ('manual' as const),
    rows: rows as { consignmentId: string; collected?: number; fee?: number }[],
    preview,
  });
  const check = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/admin/courier-payouts', { body: body(true) })),
  });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/admin/courier-payouts', { body: body(false) })),
    onSuccess: onSaved,
  });
  const p = check.data;
  const columnSelect = (label: AdminKey, key: keyof typeof cols, optional: boolean) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`payout-col-${key}`} className="text-sm font-medium">
        {t(label)}
      </label>
      <select
        id={`payout-col-${key}`}
        className="min-h-11 rounded-md border border-input bg-background px-3"
        value={cols[key]}
        onChange={(e) => {
          setCols((c) => ({ ...c, [key]: Number(e.target.value) }));
          check.reset();
        }}
      >
        {optional && <option value={-1}>{t('cod.import.none')}</option>}
        {parsed?.header.map((h, i) => (
          <option key={`${h}-${i}`} value={i}>
            {h || `#${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={mode === 'import' ? t('cod.import') : t('cod.record')}
      description={mode === 'import' ? t('cod.import.intro') : undefined}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="payout-courier" className="text-sm font-medium">
            {t('cod.courier')}
          </label>
          <select
            id="payout-courier"
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={courier}
            onChange={(e) => {
              setCourier(e.target.value as Courier);
              check.reset();
            }}
          >
            {COURIERS.map((c) => (
              <option key={c} value={c}>
                {courierName(c, t)}
              </option>
            ))}
          </select>
        </div>
        <Field
          label={t('cod.reference')}
          value={reference}
          maxLength={100}
          onChange={(e) => setReference(e.target.value)}
        />
        <Field
          label={t('cod.paidAt')}
          type="date"
          value={paidAt}
          onChange={(e) => setPaidAt(e.target.value)}
        />
        {mode === 'import' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t('cod.import.file')}</span>
              <input
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    setFileError(null);
                    const result = await parseFile(file);
                    setParsed(result);
                    const find = (re: RegExp) => result.header.findIndex((h) => re.test(h));
                    setCols({
                      consignment: Math.max(0, find(/consign|tracking|cid|parcel/i)),
                      collected: find(/collect|cod|cash/i),
                      fee: find(/fee|charge/i),
                    });
                    check.reset();
                  } catch (err) {
                    setFileError(String(err));
                  }
                }}
              />
            </label>
            {fileError && <Notice tone="error">{fileError}</Notice>}
            {parsed && (
              <>
                {columnSelect('cod.import.columnConsignment', 'consignment', false)}
                {columnSelect('cod.import.columnCollected', 'collected', true)}
                {columnSelect('cod.import.columnFee', 'fee', true)}
              </>
            )}
          </>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t('cod.record.consignments')}</span>
            <textarea
              className="min-h-28 rounded-md border border-input bg-background p-3"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                check.reset();
              }}
            />
          </label>
        )}
        {p && (
          <div className="flex flex-col gap-1 text-sm" aria-live="polite">
            <p className="font-medium">
              {t('cod.matched', { n: p.matched.length, net: formatPrice(p.totals.net, locale) })}
            </p>
            {p.unknown.length > 0 && <p>{t('cod.unknown', { list: p.unknown.join(', ') })}</p>}
            {p.alreadyPaid.length > 0 && (
              <p>{t('cod.alreadyPaid', { list: p.alreadyPaid.join(', ') })}</p>
            )}
            {p.notDelivered.length > 0 && (
              <p>{t('cod.notDelivered', { list: p.notDelivered.join(', ') })}</p>
            )}
          </div>
        )}
        {(check.error ?? save.error) && (
          <Notice tone="error">{saveErrorMessage((check.error ?? save.error) as Error, t)}</Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!rows.length || !reference.trim() || check.isPending}
            onClick={() => check.mutate()}
          >
            {t('cod.preview')}
          </Button>
          <Button disabled={!p?.matched.length || save.isPending} onClick={() => save.mutate()}>
            {t('cod.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
