// Stock (phase-8-plan §3.8), as the canvas draws it (ADR 0034): what the
// stock is worth today or at one of the last months' ends, by category,
// location and variant, with stock below zero apart (cost holders); and slow
// movers, on hand with no sale in 30, 60 or 90 days.
import { formatNumber } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Boxes, Info } from 'lucide-react';
import { useState } from 'react';
import { Notice } from '../components/notice';
import { usePermission } from '../components/permission-gate';
import {
  ReportBlocks,
  ReportControls,
  ReportHeader,
  ReportNote,
  type Row,
  Table,
} from '../components/report-table';
import { Button } from '../components/ui/button';
import { Segmented } from '../components/ui/segmented';
import { type Stat, StatRow } from '../components/ui/stat-row';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { formatDateTime } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { lineLabel, pickText } from '../lib/orders';

const DAY_CHOICES = ['30', '60', '90'] as const;
type Days = (typeof DAY_CHOICES)[number];

export function StockReportPage() {
  const { t, locale } = useLocale();
  const cost = usePermission('catalog.cost');
  const [month, setMonth] = useState('');
  const [days, setDays] = useState<Days>('60');
  const n = (v: number) => formatNumber(locale, v);
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
      unwrap(await api.GET('/v1/admin/reports/slow-movers', { params: { query: { days } } })),
  });
  const thisYear = new Date().getFullYear();
  const monthName = (end: string) => {
    const at = new Date(`${end}T12:00:00Z`);
    return formatDateTime(locale, at, {
      month: 'long',
      ...(at.getUTCFullYear() === thisYear ? {} : { year: 'numeric' }),
    });
  };
  const v = valuation.data;
  const variant = (r: {
    title: Record<string, string>;
    optionLabels: Record<string, string>[];
    sku: string | null;
  }) => lineLabel(r, locale);
  const suffix = month || 'today';
  // The board offers today and the two months' ends before it.
  const months = (v?.months ?? []).slice(0, 2);
  const daysSince = (iso: string) =>
    Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  const total = v?.totals.value ?? 0;
  const share = (value: number) =>
    total ? `${formatNumber(locale, Math.round((value / total) * 1000) / 10)}%` : '—';
  const stats: Stat[] = [
    ...(v
      ? [
          { label: t('stockReport.value'), value: money(v.totals.value) },
          { label: t('stockReport.units'), value: n(v.totals.units) },
        ]
      : []),
    ...(slow.data ? [{ label: t('stockReport.slow'), value: n(slow.data.items.length) }] : []),
    ...(v ? [{ label: t('stockReport.negative'), value: n(v.negative.length) }] : []),
  ];
  const categoryRows: Row[] = v
    ? [
        ...[...v.byCategory]
          .sort((a, b) => b.value - a.value)
          .map((g) => [
            g.category ? pickText(g.category, locale) : t('stockReport.noCategory'),
            n(g.units),
            money(g.value),
            { text: share(g.value), muted: true },
          ]),
        ...(v.byCategory.length
          ? [{ total: true, cells: [t('reports.total'), n(v.totals.units), money(total), '100%'] }]
          : []),
      ]
    : [];
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <ReportHeader
        title={t('stockReport.title')}
        description={t('stockReport.intro')}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/inventory">
              <Boxes aria-hidden />
              {t('stockReport.openStock')}
            </Link>
          </Button>
        }
      />
      <ReportControls>
        {cost && (
          <Segmented
            label={t('stockReport.asOf')}
            showLabel
            value={month}
            options={[
              { value: '', label: t('stockReport.today') },
              ...months.map((m) => ({
                value: m.slice(0, 7),
                label: t('stockReport.monthEnd', { month: monthName(m) }),
              })),
            ]}
            onChange={setMonth}
          />
        )}
        <Segmented<Days>
          label={t('stockReport.slowControl')}
          showLabel
          value={days}
          options={DAY_CHOICES.map((d) => ({
            value: d,
            label: t('stockReport.days', { count: n(Number(d)) }),
          }))}
          onChange={setDays}
        />
      </ReportControls>
      {v && v.totals.missingCostUnits > 0 && (
        <ReportNote warn>
          {t('stockReport.missingCost', { count: n(v.totals.missingCostUnits) })}
        </ReportNote>
      )}
      {v && <ReportNote icon={Info}>{t('stockReport.rounding')}</ReportNote>}
      {valuation.isPending && cost && <p role="status">{t('loading')}</p>}
      {valuation.isError && <Notice tone="error">{errorMessage(valuation.error, t)}</Notice>}
      {slow.isError && <Notice tone="error">{errorMessage(slow.error, t)}</Notice>}
      {stats.length > 0 && <StatRow stats={stats} />}
      <ReportBlocks>
        {v && (
          <>
            <Table
              caption={t('stockReport.byCategory')}
              head={[
                t('stockReport.category'),
                t('stockReport.onHand'),
                t('stockReport.valueShort'),
                t('reports.share'),
              ]}
              rows={categoryRows}
              empty={t('reports.none')}
              exportName={`stock-by-category-${suffix}`}
              exportRows={v.byCategory.map((g) => [
                g.category ? pickText(g.category, locale) : t('stockReport.noCategory'),
                g.units,
                { money: g.value },
              ])}
            />
            <Table
              caption={t('stockReport.byLocation')}
              head={[
                t('stockReport.location'),
                t('stockReport.onHand'),
                t('stockReport.valueShort'),
              ]}
              rows={[
                ...v.byLocation.map((g) => [g.location, n(g.units), money(g.value)]),
                ...(v.byLocation.length > 1
                  ? [{ total: true, cells: [t('reports.total'), n(v.totals.units), money(total)] }]
                  : []),
              ]}
              empty={t('reports.none')}
              exportName={`stock-by-location-${suffix}`}
              exportRows={v.byLocation.map((g) => [g.location, g.units, { money: g.value }])}
            />
          </>
        )}
        {slow.data && (
          <Table
            full
            caption={t('stockReport.slow')}
            sub={t('stockReport.slowHint', { days: n(slow.data.days) })}
            head={[
              t('stockReport.variant'),
              t('stockReport.onHand'),
              ...(cost ? [t('stockReport.valueShort')] : []),
              t('stockReport.lastSold'),
              t('stockReport.slowDays'),
            ]}
            rows={slow.data.items.map((r) => [
              variant(r),
              n(r.onHand),
              ...(cost ? [money(r.value ?? 0)] : []),
              r.lastSoldAt
                ? formatDateTime(locale, new Date(r.lastSoldAt), { day: 'numeric', month: 'short' })
                : { text: t('stockReport.never'), muted: true },
              r.lastSoldAt
                ? t('stockReport.days', { count: n(daysSince(r.lastSoldAt)) })
                : { text: '—', muted: true },
            ])}
            empty={t('stockReport.noSlow')}
            exportName={`slow-movers-${slow.data.days}-days`}
            exportRows={slow.data.items.map((r) => [
              variant(r),
              r.onHand,
              ...(cost ? [{ money: r.value ?? 0 }] : []),
              r.lastSoldAt ? r.lastSoldAt.slice(0, 10) : t('stockReport.never'),
            ])}
          />
        )}
        {v && (
          <>
            <Table
              full
              caption={t('stockReport.negative')}
              sub={t('stockReport.negativeHint')}
              head={[t('stockReport.variant'), t('stockReport.location'), t('stockReport.onHand')]}
              rows={v.negative.map((r) => [
                variant(r),
                r.location,
                { text: n(r.onHand), strong: true, danger: true },
              ])}
              empty={t('stockReport.nothingBelow')}
              exportName={`stock-below-zero-${suffix}`}
              exportRows={v.negative.map((r) => [variant(r), r.location, r.onHand])}
            />
            <Table
              full
              caption={t('stockReport.items')}
              head={[
                t('stockReport.variant'),
                t('stockReport.location'),
                t('stockReport.onHand'),
                t('stockReport.unitCost'),
                t('stockReport.valueShort'),
              ]}
              rows={[...v.items]
                .sort((a, b) => b.value - a.value)
                .map((r) => [
                  [variant(r), r.sku].filter(Boolean).join(' · '),
                  r.location,
                  n(r.onHand),
                  r.unitCost === null
                    ? { text: t('stockReport.noCost'), warn: true }
                    : money(r.unitCost),
                  money(r.value),
                ])}
              empty={t('reports.none')}
              exportName={`stock-${suffix}`}
              exportRows={v.items.map((r) => [
                [variant(r), r.sku].filter(Boolean).join(' · '),
                r.location,
                r.onHand,
                r.unitCost === null ? null : { money: r.unitCost },
                { money: r.value },
              ])}
            />
          </>
        )}
      </ReportBlocks>
    </div>
  );
}
