// Sales (phase-8-plan §3.8): delivered sales by day, week or month for a
// range, and by product and variant, best seller first. Costs, profit and
// margin show only with the cost permission.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { ReportRange, useRange } from '../components/report-range';
import { ReportsNav } from '../components/reports-nav';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { lineLabel } from '../lib/orders';
import { Table } from './reports';

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
  const n = (v: number) => v.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD');
  const money = (v: number) => formatPrice(v, locale);
  const dateLabel = (d: string) => {
    const date = new Date(`${d}T00:00:00Z`);
    const tag = locale === 'bn' ? 'bn-BD' : 'en-BD';
    if (by === 'month')
      return date.toLocaleDateString(tag, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const text = date.toLocaleDateString(tag, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return by === 'week' ? t('sales.weekOf', { date: text }) : text;
  };
  const s = sales.data;
  const items = [...(products.data?.items ?? [])].sort(
    (x, y) => (y[sort] ?? Number.NEGATIVE_INFINITY) - (x[sort] ?? Number.NEGATIVE_INFINITY),
  );
  const error = sales.error ?? products.error;
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <PageHeader className="mb-0" title={t('sales.title')} description={t('sales.intro')} />
      <ReportsNav />
      <ReportRange value={range} onChange={setRange} />
      <p className="-mt-2 text-sm text-muted-foreground">{t('reports.salesBasis')}</p>
      {sales.isPending && valid && <p role="status">{t('loading')}</p>}
      {error && <Notice tone="error">{errorMessage(error, t)}</Notice>}
      {s && (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(
            [
              ['sales.ordersDelivered', n(s.totals.ordersDelivered)],
              ['sales.units', n(s.totals.units)],
              ['sales.netSales', money(s.totals.netSales)],
              ['sales.returns', money(s.totals.returns)],
            ] as [AdminKey, string][]
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-background p-4">
              <dt className="text-sm text-muted-foreground">{t(label)}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {s && (
        <section className="flex flex-col gap-3">
          <label className="flex items-center gap-2 self-start text-sm font-medium">
            {t('sales.by')}
            <select
              className="min-h-11 rounded-md border border-input bg-background px-3"
              value={by}
              onChange={(e) => setBy(e.target.value as By)}
            >
              {(['day', 'week', 'month'] as const).map((b) => (
                <option key={b} value={b}>
                  {t(`sales.by.${b}`)}
                </option>
              ))}
            </select>
          </label>
          <Table
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
            rows={s.buckets
              .filter((b) => b.units || b.returnedUnits || b.returns || b.deliveryIncome)
              .map((b) => [
                dateLabel(b.start),
                n(b.ordersDelivered),
                n(b.units),
                money(b.grossSales),
                money(b.discounts),
                money(b.netSales),
                money(b.returns),
                money(b.deliveryIncome),
              ])}
            empty={t('reports.none')}
          />
        </section>
      )}
      {products.data && (
        <section className="flex flex-col gap-3">
          <label className="flex items-center gap-2 self-start text-sm font-medium">
            {t('sales.sortBy')}
            <select
              className="min-h-11 rounded-md border border-input bg-background px-3"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="netSales">{t('sales.netSales')}</option>
              <option value="units">{t('sales.units')}</option>
              {cost && <option value="grossProfit">{t('sales.grossProfit')}</option>}
              {cost && <option value="marginBp">{t('sales.margin')}</option>}
            </select>
          </label>
          <Table
            caption={t('sales.byProduct')}
            head={[
              t('sales.product'),
              t('sales.units'),
              t('sales.returnedUnits'),
              t('sales.netSales'),
              t('sales.returns'),
              ...(cost ? [t('sales.cogs'), t('sales.grossProfit'), t('sales.margin')] : []),
            ]}
            rows={items.map((p) => [
              [lineLabel(p, locale), p.sku].filter(Boolean).join(' · '),
              n(p.units),
              n(p.returnedUnits),
              money(p.netSales),
              money(p.returns),
              ...(cost
                ? [
                    p.missingCostUnits
                      ? `${money(p.cogs ?? 0)} (${t('sales.noCost', { count: n(p.missingCostUnits) })})`
                      : money(p.cogs ?? 0),
                    money(p.grossProfit ?? 0),
                    p.marginBp === null || p.marginBp === undefined
                      ? '—'
                      : `${(p.marginBp / 100).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD')}%`,
                  ]
                : []),
            ])}
            empty={t('reports.none')}
          />
        </section>
      )}
    </div>
  );
}
