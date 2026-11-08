// Reports → COD reconciliation (phase-7-plan §3.7): for a range of delivery
// dates, what each courier collected, charged and paid out, the parcels
// still unpaid, and the differences. Owners and managers import a courier's
// payout statement or record a payout by hand, checked before it is saved.
import { formatNumber } from '@managemind/shared/i18n';
import { COURIERS, type Courier, LIVE_COURIERS } from '@managemind/shared/orders';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { BackLink } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { dhakaDay, ReportRange, rangeText, useRange } from '../components/report-range';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardFrame, cardTitle } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Segmented } from '../components/ui/segmented';
import { StatRow } from '../components/ui/stat-row';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/couriers';
import '../i18n/orders';
import '../i18n/back-office-reports';
import '../i18n/returns';
import { DateField } from '../components/date-field';
import { ReportBlocks, ReportControls, Table } from '../components/report-table';
import { Select } from '../components/ui/select';
import { api, unwrap } from '../lib/api';
import { formatPrice, readPrice } from '../lib/catalog';
import { courierName } from '../lib/couriers';
import { useRecordPage } from '../lib/crumb';
import { formatDateTime } from '../lib/dates';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { type Parsed, parseFile } from '../lib/sheet';
import { cn } from '../lib/utils';

export function CodReportPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canRecord = usePermission('payments.reconcile');
  const [range, setRange] = useRange();
  const { from, to } = range;
  const [courier, setCourier] = useState<Courier | ''>('');
  const [dialog, setDialog] = useState<'import' | 'record' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  useRecordPage(t('cod.title'));
  const key = ['reports', 'cod', from, to, courier] as const;
  const report = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/reports/cod', {
          params: { query: { from, to, ...(courier ? { courier } : {}) } },
        }),
      ),
    enabled: from <= to,
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
  const minus = (n: number) => (n ? `−${money(n)}` : money(0));
  const count = (n: number) => formatNumber(locale, n);
  const short = (iso: string) =>
    formatDateTime(locale, new Date(iso), { day: 'numeric', month: 'short' });
  const r = report.data;
  const sum = (
    k: 'delivered' | 'codAsked' | 'collected' | 'fees' | 'net' | 'paidOut' | 'outstanding',
  ) => r?.couriers.reduce((a, c) => a + c[k], 0) ?? 0;
  const actions = canRecord ? (
    <>
      <Button variant="secondary" onClick={() => setDialog('import')}>
        <FileUp aria-hidden />
        {t('cod.import')}
      </Button>
      <Button onClick={() => setDialog('record')}>
        <Plus aria-hidden />
        {t('cod.record')}
      </Button>
    </>
  ) : undefined;
  const parcel = (o: { displayNumber: string; courier: string; consignmentId: string | null }) =>
    [o.displayNumber, [courierName(o.courier, t), o.consignmentId].filter(Boolean).join(' ')].join(
      ' · ',
    );
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PhoneRecordHeader to="/reports" backLabel={t('nav.reports')} title={t('cod.title')} />
      <div className="flex flex-wrap items-start gap-3 max-md:hidden">
        <BackLink to="/reports" label={t('nav.reports')} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-xl leading-7 font-semibold tracking-[-0.01em]">{t('cod.title')}</h1>
          <p className="text-muted-foreground">{t('cod.description')}</p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {actions && <div className="flex gap-2 md:hidden [&>*]:flex-1">{actions}</div>}
      <ReportRange value={range} onChange={setRange} />
      <ReportControls>
        <Segmented<Courier | ''>
          label={t('cod.courier')}
          showLabel
          value={courier}
          options={[
            { value: '', label: t('cod.allCouriers') },
            ...LIVE_COURIERS.map((c) => ({ value: c, label: courierName(c, t) })),
          ]}
          onChange={setCourier}
        />
      </ReportControls>
      {report.isPending && from <= to && <p role="status">{t('loading')}</p>}
      {report.isError && <Notice tone="error">{errorMessage(report.error, t)}</Notice>}
      {r && (
        <StatRow
          stats={[
            { label: t('cod.collected'), value: money(sum('collected')) },
            { label: t('cod.net'), value: money(sum('net')) },
            { label: t('cod.paidOut'), value: money(sum('paidOut')) },
            { label: t('cod.outstanding'), value: money(sum('outstanding')) },
          ]}
        />
      )}
      {r && (
        <ReportBlocks>
          <Table
            full
            caption={t('cod.summary')}
            sub={t('cod.summarySub', { range: rangeText(range, locale) })}
            head={[
              t('cod.courier'),
              t('cod.delivered'),
              t('cod.asked'),
              t('cod.collected'),
              t('cod.fees'),
              t('cod.net'),
              t('cod.paidOut'),
              t('cod.outstanding'),
            ]}
            rows={[
              ...r.couriers.map((c) => [
                courierName(c.courier, t),
                count(c.delivered),
                money(c.codAsked),
                money(c.collected),
                minus(c.fees),
                money(c.net),
                money(c.paidOut),
                { text: money(c.outstanding), strong: true },
              ]),
              ...(r.couriers.length > 1
                ? [
                    {
                      total: true,
                      cells: [
                        t('reports.total'),
                        count(sum('delivered')),
                        money(sum('codAsked')),
                        money(sum('collected')),
                        minus(sum('fees')),
                        money(sum('net')),
                        money(sum('paidOut')),
                        money(sum('outstanding')),
                      ],
                    },
                  ]
                : []),
            ]}
            empty={t('cod.none')}
            exportName="cod-summary"
            exportRows={r.couriers.map((c) => [
              courierName(c.courier, t),
              c.delivered,
              { money: c.codAsked },
              { money: c.collected },
              { money: c.fees },
              { money: c.net },
              { money: c.paidOut },
              { money: c.outstanding },
              c.returned,
              { money: c.returnCharges },
            ])}
          />
          <Table
            full
            caption={t('cod.outstandingList')}
            head={[
              t('cod.parcel'),
              t('cod.delivered'),
              t('cod.collected'),
              t('cod.fee'),
              t('codOut.days'),
            ]}
            rows={r.outstanding.map((o) => [
              parcel(o),
              short(o.deliveredAt),
              money(o.collected),
              { text: minus(o.fee), muted: true },
              {
                text: t('cod.days', { n: count(o.days) }),
                warn: o.days > 14 && o.days <= 30,
                danger: o.days > 30,
                strong: o.days > 14,
              },
            ])}
            empty={t('cod.none')}
            exportName="cod-outstanding-parcels"
            exportRows={r.outstanding.map((o) => [
              parcel(o),
              o.deliveredAt.slice(0, 10),
              { money: o.collected },
              { money: o.fee },
              o.days,
            ])}
          />
          <Table
            caption={t('cod.differences')}
            head={[t('order.number'), t('cod.courier'), t('cod.what')]}
            rows={r.differences.map((d) => [
              `${d.displayNumber}${d.consignmentId ? ` · ${d.consignmentId}` : ''}`,
              courierName(d.courier, t),
              {
                text:
                  d.kind === 'collected'
                    ? t('cod.diff.collected', {
                        collected: money(d.collected),
                        asked: money(d.asked),
                      })
                    : t('cod.diff.paid', {
                        paid: money(d.paidNet ?? 0),
                        expected: money(d.expectedNet),
                      }),
                danger: true,
              },
            ])}
            empty={t('cod.noDifferences')}
            exportName="cod-differences"
          />
          <section className={cn(cardFrame, 'flex min-w-0 flex-col gap-3 pt-4')}>
            <h2 className={cn(cardTitle, 'px-4')}>{t('cod.payouts')}</h2>
            {r.payouts.length === 0 ? (
              <p className="px-4 pb-4 text-muted-foreground">{t('cod.noPayouts')}</p>
            ) : (
              <ul className="pb-1">
                {r.payouts.map((p) => (
                  <li
                    key={p.id}
                    className="flex min-h-10 flex-wrap items-center gap-x-3 border-t border-border px-4 py-1.5 text-[13px]"
                  >
                    <span className="w-14 tabular-nums">{short(p.paidAt)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {courierName(p.courier, t)}{' '}
                      <span className="text-muted-foreground">
                        {p.reference} · {t(`cod.source.${p.source}` as AdminKey)}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{money(p.amount)}</span>
                    {canRecord && (
                      <Button
                        variant="ghost"
                        className="-mr-2 h-7 px-2 md:h-7"
                        onClick={() => setDeleting(p.id)}
                      >
                        {t('cod.delete')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </ReportBlocks>
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
  const [paidAt, setPaidAt] = useState(dhakaDay(new Date()));
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
      <Select
        id={`payout-col-${key}`}
        value={String(cols[key])}
        onChange={(next) => {
          setCols((c) => ({ ...c, [key]: Number(next) }));
          check.reset();
        }}
        options={[
          ...(optional ? [{ value: '-1', label: t('cod.import.none') }] : []),
          ...(parsed?.header.map((h, i) => ({ value: String(i), label: h || `#${i + 1}` })) ?? []),
        ]}
      />
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
          <Select
            id="payout-courier"
            value={courier}
            onChange={(next) => {
              setCourier(next as Courier);
              check.reset();
            }}
            options={COURIERS.map((c) => ({ value: c, label: courierName(c, t) }))}
          />
        </div>
        <Field
          label={t('cod.reference')}
          value={reference}
          maxLength={100}
          onChange={(e) => setReference(e.target.value)}
        />
        <DateField label={t('cod.paidAt')} value={paidAt} onChange={setPaidAt} />
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
