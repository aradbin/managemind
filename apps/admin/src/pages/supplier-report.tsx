// Suppliers (phase-8-plan §3.7, §3.8): what the store owes each supplier
// today, aged oldest receipt first, and what it received and paid in a
// range. Needs purchasing.pay.
import { AGEING_BUCKETS } from '@managemind/shared/back-office';
import { useQuery } from '@tanstack/react-query';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { ReportRange, useRange } from '../components/report-range';
import { Table } from '../components/report-table';
import { ReportsNav } from '../components/reports-nav';
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
  const n = (v: number) => v.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD');
  const r = report.data;
  const dues = r
    ? [...r.dues].filter((d) => d.balance !== 0).sort((a, b) => b.balance - a.balance)
    : [];
  const head = [
    t('supplierReport.supplier'),
    t('supplierReport.balance'),
    ...AGEING_BUCKETS.map((b) => t(`supplierReport.age.${b}`)),
  ];
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <PageHeader
        className="mb-0"
        title={t('supplierReport.title')}
        description={t('supplierReport.intro')}
      />
      <ReportsNav />
      {report.isPending && valid && <p role="status">{t('loading')}</p>}
      {report.isError && <Notice tone="error">{errorMessage(report.error, t)}</Notice>}
      {r && (
        <Table
          caption={t('supplierReport.dues')}
          head={head}
          rows={[
            ...dues.map((d) => [
              d.name,
              money(d.balance),
              ...AGEING_BUCKETS.map((b) => money(d.buckets[b])),
            ]),
            ...(dues.length
              ? [
                  [
                    t('supplierReport.total'),
                    money(r.duesTotal.balance),
                    ...AGEING_BUCKETS.map((b) => money(r.duesTotal.buckets[b])),
                  ],
                ]
              : []),
          ]}
          empty={t('reports.none')}
          exportName="supplier-dues"
          exportRows={[
            ...dues.map((d) => [
              d.name,
              { money: d.balance },
              ...AGEING_BUCKETS.map((b) => ({ money: d.buckets[b] })),
            ]),
            [
              t('supplierReport.total'),
              { money: r.duesTotal.balance },
              ...AGEING_BUCKETS.map((b) => ({ money: r.duesTotal.buckets[b] })),
            ],
          ]}
        />
      )}
      <ReportRange value={range} onChange={setRange} />
      {r && (
        <Table
          caption={t('supplierReport.purchases')}
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
      )}
    </div>
  );
}
