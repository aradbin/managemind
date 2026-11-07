// Profit (phase-8-plan §3.8), as the canvas draws it (ADR 0034): the
// statement for a range in the order of the definitions, beside the same
// number of days before, with deductions indented and the subtotals on a
// tint; four figures with how they moved; expenses by category with their
// shares; and a warning while units were sold without a cost. Needs the cost
// permission.
import { formatNumber } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Notice } from '../components/notice';
import { ReportRange, rangeText, useRange } from '../components/report-range';
import {
  type Cell,
  changeNote,
  ReportBlocks,
  ReportHeader,
  ReportNote,
  type Row,
  Table,
} from '../components/report-table';
import { StatRow } from '../components/ui/stat-row';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/expenses';
import '../i18n/returns';
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

/** How a line shows: taken off (indented, "−"), or a subtotal (bold, on a tint). */
type Kind = 'line' | 'less' | 'subtotal' | 'result';

/** The lines in the statement's order. */
const LINES: [AdminKey, keyof Statement, Kind][] = [
  ['profit.netSales', 'netSales', 'line'],
  ['profit.returns', 'returns', 'less'],
  ['profit.cogs', 'cogs', 'less'],
  ['profit.grossProfit', 'grossProfit', 'subtotal'],
  ['profit.deliveryIncome', 'deliveryIncome', 'line'],
  ['profit.courierFees', 'courierFees', 'less'],
  ['profit.failedDeliveries', 'failedDeliveryCosts', 'less'],
  ['profit.deliveryResult', 'deliveryResult', 'subtotal'],
  ['profit.stockLosses', 'stockLosses', 'less'],
  ['profit.expenses', 'expenses', 'less'],
  ['profit.netProfit', 'netProfit', 'result'],
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
  const n = (v: number) => formatNumber(locale, v);
  const change = (now: number, before: number) => {
    if (!before) return { text: '—' };
    const c = Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
    return {
      text: `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatNumber(locale, Math.abs(c))}%`,
      good: c > 0,
      danger: c < 0,
    };
  };
  const r = report.data;
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
  const rows: Row[] = r
    ? LINES.map(([label, key, kind]) => {
        const less = kind === 'less';
        const fmt = (v: number) => (less && v ? `−${money(v)}` : money(v));
        const ch = change(r.current[key], r.previous[key]);
        const cells: Cell[] = [
          { text: t(label), indent: less },
          fmt(r.current[key]),
          { text: fmt(r.previous[key]), muted: true },
          // Deductions moving isn't good or bad by itself: their change stays grey.
          less || ch.text === '—' ? { text: ch.text, muted: true } : ch,
        ];
        return kind === 'line' || less ? cells : { cells, total: true, rule: kind === 'result' };
      })
    : [];
  const expenses = r?.current.expensesByCategory ?? [];
  const expenseTotal = expenses.reduce((a, c) => a + c.amount, 0);
  const share = (v: number) =>
    expenseTotal ? `${formatNumber(locale, Math.round((v / expenseTotal) * 1000) / 10)}%` : '—';
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <ReportHeader title={t('profit.title')} description={t('profit.intro')} />
      <ReportRange value={range} onChange={setRange} />
      {report.isPending && valid && <p role="status">{t('loading')}</p>}
      {report.isError && <Notice tone="error">{errorMessage(report.error, t)}</Notice>}
      {r && r.current.missingCostUnits > 0 && (
        <ReportNote warn>
          {t('profit.missingCost', { count: n(r.current.missingCostUnits) })}
        </ReportNote>
      )}
      {r && (
        <StatRow
          stats={[
            {
              label: t('profit.netSales'),
              value: money(r.current.netSales),
              note: changeNote(r.current.netSales, r.previous.netSales, locale, t),
            },
            {
              label: t('profit.grossProfit'),
              value: money(r.current.grossProfit),
              note: changeNote(r.current.grossProfit, r.previous.grossProfit, locale, t),
            },
            { label: t('profit.expensesTotal'), value: money(r.current.expenses) },
            {
              label: t('profit.netProfit'),
              value: money(r.current.netProfit),
              note: changeNote(r.current.netProfit, r.previous.netProfit, locale, t),
            },
          ]}
        />
      )}
      {r && (
        <ReportBlocks>
          <Table
            caption={t('profit.statement')}
            sub={t('profit.beside', { range: rangeText(range, locale), days: n(days) })}
            head={[t('profit.line'), t('profit.current'), t('profit.previous'), t('profit.change')]}
            rows={rows}
            hint={`${t('profit.vatNote', { amount: money(r.current.vat) })} ${t('reports.salesBasis')}`}
            empty={t('reports.none')}
            exportName={`profit-${range.from}-${range.to}`}
            exportRows={LINES.map(([label, key]) => [
              t(label),
              { money: r.current[key] },
              { money: r.previous[key] },
              change(r.current[key], r.previous[key]).text,
            ])}
          />
          <Table
            caption={t('profit.expensesByCategory')}
            head={[t('expenses.category'), t('reports.amount'), t('reports.share')]}
            rows={[
              ...[...expenses]
                .sort((a, b) => b.amount - a.amount)
                .map((c) => [
                  c.name[locale] ?? '',
                  money(c.amount),
                  { text: share(c.amount), muted: true },
                ]),
              ...(expenses.length
                ? [{ total: true, cells: [t('reports.total'), money(expenseTotal), '100%'] }]
                : []),
            ]}
            link={{ to: '/reports/expenses', label: t('profit.expenseReport') }}
            empty={t('reports.none')}
            exportName={`profit-expenses-${range.from}-${range.to}`}
            exportRows={expenses.map((c) => [c.name[locale] ?? '', { money: c.amount }])}
          />
        </ReportBlocks>
      )}
    </div>
  );
}
