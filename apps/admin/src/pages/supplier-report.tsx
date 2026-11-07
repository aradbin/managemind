// Suppliers (phase-8-plan §3.7, §3.8), as the canvas draws it (ADR 0034):
// what the store owes in all and what is over 60 days, what it received and
// paid in the range; then each supplier's dues by age, oldest receipt first
// (amber past 60 days, an advance shown apart), and the period's purchases.
// Needs purchasing.pay.
import { AGEING_BUCKETS } from '@managemind/shared/back-office';
import { formatNumber } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Truck } from 'lucide-react';
import { Notice } from '../components/notice';
import { ReportRange, rangeText, useRange } from '../components/report-range';
import { type Cell, ReportBlocks, ReportHeader, type Row, Table } from '../components/report-table';
import { Button } from '../components/ui/button';
import { StatRow } from '../components/ui/stat-row';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';

export function SupplierReportPage() {
  const { t, locale } = useLocale();
  const [range, setRange] = useRange();
  const valid = range.from <= range.to;
  const report = useQuery({
    queryKey: ['reports', 'suppliers', range.from, range.to],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/reports/suppliers', {
          params: { query: { from: range.from, to: range.to } },
        }),
      ),
    enabled: valid,
  });
  const money = (v: number) => formatPrice(v, locale);
  const n = (v: number) => formatNumber(locale, v);
  const r = report.data;
  const dues = r
    ? [...r.dues].filter((d) => d.balance !== 0).sort((a, b) => b.balance - a.balance)
    : [];
  /** An age's amount: a dash for none, amber once it is past 60 days. */
  const aged = (b: (typeof AGEING_BUCKETS)[number], v: number, strong = false): Cell =>
    v
      ? { text: money(v), warn: !strong && (b === '61_90' || b === 'over_90'), strong }
      : { text: strong ? money(0) : '—', muted: !strong };
  const rows: Row[] = r
    ? [
        ...dues.map((d): Cell[] =>
          d.balance < 0
            ? [
                d.name,
                { text: t('supplierReport.advance', { amount: money(-d.balance) }), muted: true },
                ...AGEING_BUCKETS.slice(1).map((): Cell => ({ text: '—', muted: true })),
                { text: t('supplierReport.advance', { amount: money(-d.balance) }), muted: true },
              ]
            : [d.name, ...AGEING_BUCKETS.map((b) => aged(b, d.buckets[b])), money(d.balance)],
        ),
        ...(dues.length
          ? [
              {
                total: true,
                cells: [
                  t('supplierReport.total'),
                  ...AGEING_BUCKETS.map((b) => aged(b, r.duesTotal.buckets[b], true)),
                  money(r.duesTotal.balance),
                ],
              },
            ]
          : []),
      ]
    : [];
  const received = r?.purchases.reduce((a, p) => a + p.received, 0) ?? 0;
  const paid = r?.purchases.reduce((a, p) => a + p.paid, 0) ?? 0;
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <ReportHeader
        title={t('supplierReport.title')}
        description={t('supplierReport.intro')}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/inventory/suppliers">
              <Truck aria-hidden />
              {t('supplierReport.open')}
            </Link>
          </Button>
        }
      />
      <ReportRange value={range} onChange={setRange} />
      {report.isPending && valid && <p role="status">{t('loading')}</p>}
      {report.isError && <Notice tone="error">{errorMessage(report.error, t)}</Notice>}
      {r && (
        <StatRow
          stats={[
            { label: t('supplierReport.owed'), value: money(r.duesTotal.balance) },
            {
              label: t('supplierReport.over60'),
              value: money(r.duesTotal.buckets['61_90'] + r.duesTotal.buckets.over_90),
            },
            { label: t('supplierReport.receivedPeriod'), value: money(received) },
            { label: t('supplierReport.paidPeriod'), value: money(paid) },
          ]}
        />
      )}
      {r && (
        <ReportBlocks>
          <Table
            full
            caption={t('supplierReport.dues')}
            sub={t('supplierReport.duesSub')}
            head={[
              t('supplierReport.supplier'),
              ...AGEING_BUCKETS.map((b) => t(`supplierReport.age.${b}`)),
              t('supplierReport.total'),
            ]}
            rows={rows}
            empty={t('supplierReport.noDues')}
            exportName="supplier-dues"
            exportRows={[
              ...dues.map((d) => [
                d.name,
                ...AGEING_BUCKETS.map((b) => ({ money: d.buckets[b] })),
                { money: d.balance },
              ]),
              [
                t('supplierReport.total'),
                ...AGEING_BUCKETS.map((b) => ({ money: r.duesTotal.buckets[b] })),
                { money: r.duesTotal.balance },
              ],
            ]}
          />
          <Table
            full
            caption={t('supplierReport.purchases')}
            sub={rangeText(range, locale)}
            head={[
              t('supplierReport.supplier'),
              t('supplierReport.receipts'),
              t('supplierReport.received'),
              t('supplierReport.paid'),
            ]}
            rows={r.purchases.map((p) => [
              p.name ?? t('supplierReport.noSupplier'),
              n(p.receipts),
              money(p.received),
              money(p.paid),
            ])}
            empty={t('reports.none')}
            exportName={`supplier-purchases-${range.from}-${range.to}`}
            exportRows={r.purchases.map((p) => [
              p.name ?? t('supplierReport.noSupplier'),
              p.receipts,
              { money: p.received },
              { money: p.paid },
            ])}
          />
        </ReportBlocks>
      )}
    </div>
  );
}
