// Expenses (phase-8-plan §3.6, §3.8): what the store spent in a range, by
// category and month, with each month's and category's total.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { ReportRange, useRange } from '../components/report-range';
import { Table } from '../components/report-table';
import { ReportsNav } from '../components/reports-nav';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';

export function ExpenseReportPage() {
  const { t, locale } = useLocale();
  const [range, setRange] = useRange();
  const valid = range.from <= range.to;
  const report = useQuery({
    queryKey: ['reports', 'expenses', range.from, range.to],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/reports/expenses', {
          params: { query: { from: range.from, to: range.to } },
        }),
      ),
    enabled: valid,
  });
  const money = (v: number) => formatPrice(v, locale);
  const monthName = (m: string) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const r = report.data;
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <PageHeader
        className="mb-0"
        title={t('expenseReport.title')}
        description={t('expenseReport.intro')}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/expenses">{t('expenseReport.open')}</Link>
          </Button>
        }
      />
      <ReportsNav />
      <ReportRange value={range} onChange={setRange} />
      {report.isPending && valid && <p role="status">{t('loading')}</p>}
      {report.isError && <Notice tone="error">{errorMessage(report.error, t)}</Notice>}
      {r && (
        <Table
          caption={t('expenseReport.byMonth')}
          head={[t('expenseReport.category'), ...r.months.map(monthName), t('expenseReport.total')]}
          rows={[
            ...r.categories.map((c) => [c.name[locale], ...c.amounts.map(money), money(c.total)]),
            ...(r.categories.length
              ? [[t('expenseReport.total'), ...r.monthTotals.map(money), money(r.total)]]
              : []),
          ]}
          empty={t('reports.none')}
          exportName={`expenses-${range.from}-${range.to}`}
          exportRows={[
            ...r.categories.map((c) => [
              c.name[locale],
              ...c.amounts.map((a) => ({ money: a })),
              { money: c.total },
            ]),
            [
              t('expenseReport.total'),
              ...r.monthTotals.map((a) => ({ money: a })),
              { money: r.total },
            ],
          ]}
        />
      )}
    </div>
  );
}
