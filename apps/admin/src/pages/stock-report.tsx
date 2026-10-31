// Stock (phase-8-plan §3.8): what the stock is worth today or at a past
// month's end, by location, category and variant, with stock below zero
// apart (cost holders); and slow movers, on hand with no sale in a while.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { Table } from '../components/report-table';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { dateTime, lineLabel, pickText } from '../lib/orders';

const DAY_CHOICES = [30, 60, 90, 180] as const;

export function StockReportPage() {
  const { t, locale } = useLocale();
  const cost = usePermission('catalog.cost');
  const [month, setMonth] = useState('');
  const [days, setDays] = useState(60);
  const tag = locale === 'bn' ? 'bn-BD' : 'en-BD';
  const n = (v: number) => v.toLocaleString(tag);
  const money = (v: number) => formatPrice(v, locale);
  const valuation = useQuery({
    queryKey: ['reports', 'stock', month],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/reports/stock', {
          params: { query: month ? { month } : {} },
        }),
      ),
    enabled: cost,
  });
  const slow = useQuery({
    queryKey: ['reports', 'slow-movers', days],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/reports/slow-movers', {
          params: { query: { days: String(days) } },
        }),
      ),
  });
  const monthName = (end: string) =>
    new Date(`${end}T00:00:00Z`).toLocaleDateString(tag, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const v = valuation.data;
  const variant = (r: {
    title: Record<string, string>;
    optionLabels: Record<string, string>[];
    sku: string | null;
  }) => [lineLabel(r, locale), r.sku].filter(Boolean).join(' · ');
  const suffix = month || 'today';
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <PageHeader
        className="mb-0"
        title={t('stockReport.title')}
        description={t('stockReport.intro')}
      />
      {cost && (
        <>
          <label className="flex items-center gap-2 self-start text-sm font-medium">
            {t('stockReport.asOf')}
            <select
              className="min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">{t('stockReport.today')}</option>
              {v?.months.map((m) => (
                <option key={m} value={m.slice(0, 7)}>
                  {t('stockReport.monthEnd', { month: monthName(m) })}
                </option>
              ))}
            </select>
          </label>
          {valuation.isPending && <p role="status">{t('loading')}</p>}
          {valuation.isError && <Notice tone="error">{errorMessage(valuation.error, t)}</Notice>}
          {v && (
            <>
              <dl className="grid grid-cols-2 gap-3 md:max-w-xl">
                <div className="rounded-xl border border-border bg-background p-4">
                  <dt className="text-sm text-muted-foreground">{t('stockReport.value')}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {money(v.totals.value)}
                  </dd>
                </div>
                <div className="rounded-xl border border-border bg-background p-4">
                  <dt className="text-sm text-muted-foreground">{t('stockReport.units')}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">{n(v.totals.units)}</dd>
                </div>
              </dl>
              {v.totals.missingCostUnits > 0 && (
                <Notice>
                  {t('stockReport.missingCost', { count: n(v.totals.missingCostUnits) })}
                </Notice>
              )}
              <Table
                caption={t('stockReport.byLocation')}
                head={[t('stockReport.location'), t('stockReport.onHand'), t('stockReport.value')]}
                rows={v.byLocation.map((g) => [g.location, n(g.units), money(g.value)])}
                empty={t('reports.none')}
                exportName={`stock-by-location-${suffix}`}
                exportRows={v.byLocation.map((g) => [g.location, g.units, { money: g.value }])}
              />
              <Table
                caption={t('stockReport.byCategory')}
                head={[t('stockReport.category'), t('stockReport.onHand'), t('stockReport.value')]}
                rows={v.byCategory.map((g) => [
                  g.category ? pickText(g.category, locale) : t('stockReport.noCategory'),
                  n(g.units),
                  money(g.value),
                ])}
                empty={t('reports.none')}
                exportName={`stock-by-category-${suffix}`}
                exportRows={v.byCategory.map((g) => [
                  g.category ? pickText(g.category, locale) : t('stockReport.noCategory'),
                  g.units,
                  { money: g.value },
                ])}
              />
              <Table
                caption={t('stockReport.items')}
                head={[
                  t('stockReport.variant'),
                  t('stockReport.location'),
                  t('stockReport.onHand'),
                  t('stockReport.unitCost'),
                  t('stockReport.value'),
                ]}
                rows={v.items.map((r) => [
                  variant(r),
                  r.location,
                  n(r.onHand),
                  r.unitCost === null ? '—' : money(r.unitCost),
                  money(r.value),
                ])}
                empty={t('reports.none')}
                exportName={`stock-${suffix}`}
                exportRows={v.items.map((r) => [
                  variant(r),
                  r.location,
                  r.onHand,
                  r.unitCost === null ? null : { money: r.unitCost },
                  { money: r.value },
                ])}
              />
              {v.negative.length > 0 && (
                <>
                  <Table
                    caption={t('stockReport.negative')}
                    head={[
                      t('stockReport.variant'),
                      t('stockReport.location'),
                      t('stockReport.onHand'),
                    ]}
                    rows={v.negative.map((r) => [variant(r), r.location, n(r.onHand)])}
                    empty={t('reports.none')}
                    exportName={`stock-below-zero-${suffix}`}
                    exportRows={v.negative.map((r) => [variant(r), r.location, r.onHand])}
                  />
                  <p className="-mt-2 text-sm text-muted-foreground">
                    {t('stockReport.negativeHint')}
                  </p>
                </>
              )}
              <p className="text-sm text-muted-foreground">{t('stockReport.rounding')}</p>
            </>
          )}
        </>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{t('stockReport.slow')}</h2>
        <label className="flex items-center gap-2 self-start text-sm font-medium">
          {t('stockReport.slowDays')}
          <select
            className="min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {DAY_CHOICES.map((d) => (
              <option key={d} value={d}>
                {t('stockReport.days', { count: n(d) })}
              </option>
            ))}
          </select>
        </label>
        {slow.isError && <Notice tone="error">{errorMessage(slow.error, t)}</Notice>}
        {slow.data && (
          <Table
            caption={t('stockReport.slowHint', { days: n(slow.data.days) })}
            head={[
              t('stockReport.variant'),
              t('stockReport.onHand'),
              t('stockReport.lastSold'),
              ...(cost ? [t('stockReport.value')] : []),
            ]}
            rows={slow.data.items.map((r) => [
              variant(r),
              n(r.onHand),
              r.lastSoldAt ? dateTime(locale, r.lastSoldAt) : t('stockReport.never'),
              ...(cost ? [money(r.value ?? 0)] : []),
            ])}
            empty={t('reports.none')}
            exportName={`slow-movers-${slow.data.days}-days`}
            exportRows={slow.data.items.map((r) => [
              variant(r),
              r.onHand,
              r.lastSoldAt ? r.lastSoldAt.slice(0, 10) : t('stockReport.never'),
              ...(cost ? [{ money: r.value ?? 0 }] : []),
            ])}
          />
        )}
      </section>
    </div>
  );
}
