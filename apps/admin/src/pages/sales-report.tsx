// Sales (phase-8-plan §3.8), as the canvas draws it (ADR 0034): delivered
// sales for a range with how they compare with the days just before, net
// sales as bars by day, week or month, the same by period in a table with
// its total, and by product and variant, sorted as chosen. Costs, profit and
// margin show only with the cost permission.
import { formatNumber } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { BarChart, niceMax } from '../components/bar-chart';
import { Notice } from '../components/notice';
import { usePermission } from '../components/permission-gate';
import { ReportRange, rangeText, useRange } from '../components/report-range';
import {
  type Cell,
  changeNote,
  ReportBlocks,
  ReportControls,
  ReportHeader,
  ReportNote,
  Table,
} from '../components/report-table';
import { cardPadded, cardTitle } from '../components/ui/card';
import { Segmented } from '../components/ui/segmented';
import { type Stat, StatRow } from '../components/ui/stat-row';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/returns';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { lineLabel } from '../lib/orders';
import { cn } from '../lib/utils';

type By = 'day' | 'week' | 'month';
type Sort = 'netSales' | 'units' | 'grossProfit' | 'marginBp';

export function SalesReportPage() {
  const { t, locale } = useLocale();
  const cost = usePermission('catalog.cost');
  const [range, setRange] = useRange();
  const [by, setBy] = useState<By>('day');
  const [sort, setSort] = useState<Sort>('netSales');
  const valid = range.from <= range.to;
  const sales = useQuery({
    queryKey: ['reports', 'sales', range.from, range.to, by],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/reports/sales', {
          params: { query: { from: range.from, to: range.to, by } },
        }),
      ),
    enabled: valid,
  });
  const products = useQuery({
    queryKey: ['reports', 'products', range.from, range.to],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/reports/products', {
          params: { query: { from: range.from, to: range.to } },
        }),
      ),
    enabled: valid,
  });
  const n = (v: number) => formatNumber(locale, v);
  const money = (v: number) => formatPrice(v, locale);
  const minus = (v: number) => (v ? `−${money(v)}` : money(0));
  const date = (d: string, style: 'short' | 'long') => {
    const at = new Date(`${d}T00:00:00Z`);
    const tag = locale === 'bn' ? 'bn-BD' : 'en-GB';
    if (by === 'month')
      return at.toLocaleDateString(tag, {
        month: style === 'short' ? 'short' : 'long',
        ...(style === 'long' ? { year: 'numeric' } : {}),
        timeZone: 'UTC',
      });
    const text = at.toLocaleDateString(tag, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return by === 'week' && style === 'long' ? t('sales.weekOf', { date: text }) : text;
  };
  const s = sales.data;
  const items = [...(products.data?.items ?? [])].sort(
    (x, y) => (y[sort] ?? Number.NEGATIVE_INFINITY) - (x[sort] ?? Number.NEGATIVE_INFINITY),
  );
  const error = sales.error ?? products.error;
  const periods = (s?.buckets ?? []).filter(
    (b) => b.units || b.returnedUnits || b.returns || b.deliveryIncome,
  );
  const missing = items.filter((p) => p.missingCostUnits);
  const stats: Stat[] = s
    ? [
        {
          label: t('sales.ordersDelivered'),
          value: n(s.totals.ordersDelivered),
          note: changeNote(s.totals.ordersDelivered, s.previous.ordersDelivered, locale, t),
        },
        {
          label: t('sales.units'),
          value: n(s.totals.units),
          note: changeNote(s.totals.units, s.previous.units, locale, t),
        },
        {
          label: t('sales.netSales'),
          value: money(s.totals.netSales),
          note: changeNote(s.totals.netSales, s.previous.netSales, locale, t),
        },
        { label: t('sales.returns'), value: money(s.totals.returns) },
      ]
    : [];
  // Labels under the bars: every one when few, else every second or seventh.
  const every = periods.length > 20 ? 7 : periods.length > 10 ? 2 : 1;
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <ReportHeader title={t('sales.title')} description={t('sales.intro')} />
      <ReportRange value={range} onChange={setRange} />
      <ReportControls>
        <Segmented<By>
          label={t('sales.by')}
          showLabel
          value={by}
          options={(['day', 'week', 'month'] as const).map((b) => ({
            value: b,
            label: t(`sales.by.${b}`),
          }))}
          onChange={setBy}
        />
        <Segmented<Sort>
          label={t('sales.productsBy')}
          showLabel
          value={sort}
          options={[
            { value: 'netSales', label: t('sales.netSales') },
            { value: 'units', label: t('sales.units') },
            ...(cost
              ? [
                  { value: 'grossProfit' as const, label: t('sales.grossProfit') },
                  { value: 'marginBp' as const, label: t('sales.margin') },
                ]
              : []),
          ]}
          onChange={setSort}
        />
      </ReportControls>
      <ReportNote icon={Info}>{t('reports.salesBasis')}</ReportNote>
      {sales.isPending && valid && <p role="status">{t('loading')}</p>}
      {error && <Notice tone="error">{errorMessage(error, t)}</Notice>}
      {s && <StatRow stats={stats} />}
      {s && periods.length > 0 && (
        <section aria-labelledby="sales-chart" className={cn(cardPadded, 'gap-4 md:gap-4')}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="sales-chart" className={cardTitle}>
              {t(`sales.chart.${by}`)}
            </h2>
            <span className="text-[13px] text-muted-foreground">{rangeText(range, locale)}</span>
          </div>
          <BarChart
            label={t(`sales.chart.${by}`)}
            top={niceMax(Math.max(...periods.map((b) => b.netSales)))}
            steps={4}
            height={200}
            bars={periods.map((b, i) => ({
              key: b.start,
              value: b.netSales,
              label: i % every === 0 ? date(b.start, 'short') : '',
              tip: `${date(b.start, 'long')}: ${money(b.netSales)} · ${t('dashboard.orderCount', {
                count: b.ordersDelivered,
              })}`,
            }))}
          />
        </section>
      )}
      <ReportBlocks>
        {s && (
          <Table
            full
            caption={t('sales.byPeriod')}
            head={[
              t('sales.period'),
              t('sales.ordersDelivered'),
              t('sales.units'),
              t('sales.grossSales'),
              t('sales.discounts'),
              t('sales.netSales'),
              t('sales.returns'),
              t('sales.deliveryIncome'),
            ]}
            rows={[
              ...periods.map((b) => [
                date(b.start, 'long'),
                n(b.ordersDelivered),
                n(b.units),
                money(b.grossSales),
                minus(b.discounts),
                { text: money(b.netSales), strong: true },
                minus(b.returns),
                money(b.deliveryIncome),
              ]),
              ...(periods.length
                ? [
                    {
                      total: true,
                      cells: [
                        t('reports.total'),
                        n(s.totals.ordersDelivered),
                        n(s.totals.units),
                        money(s.totals.grossSales),
                        minus(s.totals.discounts),
                        money(s.totals.netSales),
                        minus(s.totals.returns),
                        money(s.totals.deliveryIncome),
                      ],
                    },
                  ]
                : []),
            ]}
            empty={t('reports.none')}
            exportName={`sales-by-${by}`}
            exportRows={periods.map((b) => [
              b.start,
              b.ordersDelivered,
              b.units,
              { money: b.grossSales },
              { money: b.discounts },
              { money: b.netSales },
              { money: b.returns },
              { money: b.deliveryIncome },
            ])}
          />
        )}
        {products.data && (
          <Table
            full
            caption={t('sales.byProduct')}
            head={[
              t('sales.product'),
              t('sales.units'),
              t('sales.returnedUnits'),
              t('sales.netSales'),
              ...(cost ? [t('sales.cogs'), t('sales.grossProfit'), t('sales.margin')] : []),
            ]}
            rows={items.map((p) => [
              [lineLabel(p, locale), p.sku].filter(Boolean).join(' · '),
              n(p.units),
              p.returnedUnits ? n(p.returnedUnits) : { text: '—', muted: true },
              { text: money(p.netSales), strong: true },
              ...((cost
                ? [
                    p.missingCostUnits
                      ? { text: t('sales.noCost', { count: n(p.missingCostUnits) }), warn: true }
                      : money(p.cogs ?? 0),
                    p.missingCostUnits ? '—' : money(p.grossProfit ?? 0),
                    p.marginBp == null || p.missingCostUnits
                      ? '—'
                      : `${formatNumber(locale, Math.round(p.marginBp / 100))}%`,
                  ]
                : []) as Cell[]),
            ])}
            hint={
              cost && missing.length
                ? t('sales.noCostHint', { count: formatNumber(locale, missing.length) })
                : undefined
            }
            empty={t('reports.none')}
            exportName="sales-by-product"
            exportRows={items.map((p) => [
              [lineLabel(p, locale), p.sku].filter(Boolean).join(' · '),
              p.units,
              p.returnedUnits,
              { money: p.netSales },
              ...(cost
                ? [
                    { money: p.cogs ?? 0 },
                    { money: p.grossProfit ?? 0 },
                    p.marginBp == null ? null : p.marginBp / 100,
                  ]
                : []),
            ])}
          />
        )}
      </ReportBlocks>
    </div>
  );
}
