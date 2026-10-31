// Profit (phase-8-plan §3.8): the statement for a range in the order of the
// definitions, beside the same number of days before, with expenses by
// category and the units sold without a cost. Needs the cost permission.
import { useQuery } from '@tanstack/react-query';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { ReportRange, useRange } from '../components/report-range';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/expenses';
import '../i18n/returns';
import { Table } from '../components/report-table';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';

type Statement = {
  netSales: number;
  returns: number;
  cogs: number;
  grossProfit: number;
  deliveryIncome: number;
  courierFees: number;
  failedDeliveryCosts: number;
  deliveryResult: number;
  stockLosses: number;
  expenses: number;
  netProfit: number;
};

/** The lines in the statement's order; deductions show as they are taken off. */
const LINES: [AdminKey, keyof Statement][] = [
  ['profit.netSales', 'netSales'],
  ['profit.returns', 'returns'],
  ['profit.cogs', 'cogs'],
  ['profit.grossProfit', 'grossProfit'],
  ['profit.deliveryIncome', 'deliveryIncome'],
  ['profit.courierFees', 'courierFees'],
  ['profit.failedDeliveries', 'failedDeliveryCosts'],
  ['profit.deliveryResult', 'deliveryResult'],
  ['profit.stockLosses', 'stockLosses'],
  ['profit.expenses', 'expenses'],
  ['profit.netProfit', 'netProfit'],
];

export function ProfitReportPage() {
  const { t, locale } = useLocale();
  const [range, setRange] = useRange();
  const valid = range.from <= range.to;
  const report = useQuery({
    queryKey: ['reports', 'profit', range.from, range.to],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/reports/profit', {
          params: { query: { from: range.from, to: range.to } },
        }),
      ),
    enabled: valid,
  });
  const money = (v: number) => formatPrice(v, locale);
  const n = (v: number) => v.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD');
  const change = (now: number, before: number) => {
    if (!before) return '—';
    const pct = Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
    return `${pct > 0 ? '+' : ''}${pct.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD')}%`;
  };
  const r = report.data;
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <PageHeader className="mb-0" title={t('profit.title')} description={t('profit.intro')} />
      <ReportRange value={range} onChange={setRange} />
      {report.isPending && valid && <p role="status">{t('loading')}</p>}
      {report.isError && <Notice tone="error">{errorMessage(report.error, t)}</Notice>}
      {r && r.current.missingCostUnits > 0 && (
        <Notice>{t('profit.missingCost', { count: n(r.current.missingCostUnits) })}</Notice>
      )}
      {r && (
        <>
          <Table
            caption={t('profit.title')}
            head={[t('profit.line'), t('profit.current'), t('profit.previous'), t('profit.change')]}
            rows={LINES.map(([label, key]) => [
              t(label),
              money(r.current[key]),
              money(r.previous[key]),
              change(r.current[key], r.previous[key]),
            ])}
            empty={t('reports.none')}
            exportName={`profit-${range.from}-${range.to}`}
            exportRows={LINES.map(([label, key]) => [
              t(label),
              { money: r.current[key] },
              { money: r.previous[key] },
              change(r.current[key], r.previous[key]),
            ])}
          />
          <p className="-mt-2 text-sm text-muted-foreground">
            {t('profit.vatNote', { amount: money(r.current.vat) })} {t('reports.salesBasis')}
          </p>
          <Table
            caption={t('profit.expensesByCategory')}
            head={[t('expenses.category'), t('reports.amount')]}
            rows={r.current.expensesByCategory.map((c) => [c.name[locale], money(c.amount)])}
            empty={t('reports.none')}
            exportName={`profit-expenses-${range.from}-${range.to}`}
            exportRows={r.current.expensesByCategory.map((c) => [
              c.name[locale],
              { money: c.amount },
            ])}
          />
        </>
      )}
    </div>
  );
}
