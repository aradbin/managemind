// Expenses (phase-8-plan §3.6, §3.8), as the canvas draws it (ADR 0034):
// what the store spent in a range, a day on average, the biggest category
// and how many; then by category and month, biggest first, with each month's
// and category's total. A month cut by the range is starred.
import { formatNumber } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ReceiptText } from 'lucide-react';
import { Notice } from '../components/notice';
import { ReportRange, useRange } from '../components/report-range';
import { ReportBlocks, ReportHeader, Table } from '../components/report-table';
import { Button } from '../components/ui/button';
import { StatRow } from '../components/ui/stat-row';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { formatDateTime } from '../lib/dates';
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
  const thisYear = new Date().getFullYear();
  /** "Oct", "Oct*" when the range takes only part of it, with the year when not this one. */
  const monthName = (m: string) => {
    const start = `${m}-01`;
    const [y, mo] = m.split('-').map(Number) as [number, number];
    const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const partial = range.from > start || range.to < end;
    const name = formatDateTime(locale, new Date(`${start}T12:00:00Z`), {
      month: 'short',
      ...(y === thisYear ? {} : { year: 'numeric' }),
    });
    return partial ? `${name}*` : name;
  };
  const r = report.data;
  const categories = [...(r?.categories ?? [])].sort((a, b) => b.total - a.total);
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
  const partial = r?.months.some((m) => monthName(m).endsWith('*'));
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <ReportHeader
        title={t('expenseReport.title')}
        description={t('expenseReport.intro')}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/expenses">
              <ReceiptText aria-hidden />
              {t('expenseReport.open')}
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
            { label: t('expenseReport.spent'), value: money(r.total) },
            {
              label: t('expenseReport.perDay'),
              value: money(Math.round(r.total / days / 100) * 100),
            },
            {
              label: t('expenseReport.biggest'),
              value: categories[0] ? (categories[0].name[locale] ?? '—') : '—',
            },
            {
              label: t('expenseReport.categories'),
              value: formatNumber(locale, categories.length),
            },
          ]}
        />
      )}
      {r && (
        <ReportBlocks>
          <Table
            full
            caption={t('expenseReport.byMonth')}
            head={[
              t('expenseReport.category'),
              ...r.months.map(monthName),
              t('expenseReport.total'),
            ]}
            rows={[
              ...categories.map((c) => [
                c.name[locale] ?? '',
                ...c.amounts.map(money),
                { text: money(c.total), strong: true },
              ]),
              ...(categories.length
                ? [
                    {
                      total: true,
                      cells: [
                        t('expenseReport.total'),
                        ...r.monthTotals.map(money),
                        money(r.total),
                      ],
                    },
                  ]
                : []),
            ]}
            hint={partial && categories.length ? t('expenseReport.partial') : undefined}
            empty={t('reports.none')}
            exportName={`expenses-${range.from}-${range.to}`}
            exportRows={[
              ...categories.map((c) => [
                c.name[locale] ?? '',
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
        </ReportBlocks>
      )}
    </div>
  );
}
