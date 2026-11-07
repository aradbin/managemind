// COD outstanding (phase-8-plan §3.8), as the canvas draws it (ADR 0034):
// cash on delivery that was delivered but hasn't reached the store, in all
// and how much is over 30 days; per courier and for the store's own riders by
// age (amber past two weeks, red past a month); and the parcels waiting
// longest. The parcel-by-parcel work is Phase 7's COD reconciliation.
import { formatNumber } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileCheck, Info } from 'lucide-react';
import { Notice } from '../components/notice';
import {
  type Cell,
  ReportBlocks,
  ReportHeader,
  ReportNote,
  type Row,
  Table,
} from '../components/report-table';
import { Button } from '../components/ui/button';
import { StatRow } from '../components/ui/stat-row';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/couriers';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { courierName } from '../lib/couriers';
import { formatDateTime } from '../lib/dates';
import { errorMessage } from '../lib/errors';

const AGES = ['0_7', '8_14', '15_30', 'over_30'] as const;

export function CodOutstandingPage() {
  const { t, locale } = useLocale();
  const report = useQuery({
    queryKey: ['reports', 'cod-outstanding'],
    queryFn: async () => unwrap(await api.GET('/v1/admin/reports/cod-outstanding')),
  });
  const money = (v: number) => formatPrice(v, locale);
  const n = (v: number) => formatNumber(locale, v);
  const days = (v: number) => t('stockReport.days', { count: n(v) });
  const holder = (c: string | null) => (c === null ? t('codOut.ownRiders') : courierName(c, t));
  /** An age's amount: a dash for none, amber past two weeks, red past a month. */
  const aged = (a: (typeof AGES)[number], v: number, total = false): Cell =>
    v
      ? {
          text: money(v),
          warn: !total && a === '15_30',
          danger: !total && a === 'over_30',
        }
      : { text: total ? money(0) : '—', muted: !total };
  const late = (d: number) => ({
    text: days(d),
    danger: d > 30,
    warn: d > 14 && d <= 30,
  });
  const r = report.data;
  const parcels = r?.holders.reduce((a, h) => a + h.parcels, 0) ?? 0;
  const oldest = r?.holders.reduce((a, h) => Math.max(a, h.oldestDays), 0) ?? 0;
  const bucketTotal = (a: (typeof AGES)[number]) =>
    r?.holders.reduce((s, h) => s + h.buckets[a], 0) ?? 0;
  const holderRows: Row[] = r
    ? [
        ...r.holders.map((h) => [
          holder(h.courier),
          n(h.parcels),
          { text: money(h.amount), strong: true },
          ...AGES.map((a) => aged(a, h.buckets[a])),
          { text: days(h.oldestDays), danger: h.oldestDays > 30 },
        ]),
        ...(r.holders.length > 1
          ? [
              {
                total: true,
                cells: [
                  t('reports.total'),
                  n(parcels),
                  money(r.total),
                  ...AGES.map((a) => aged(a, bucketTotal(a), true)),
                  days(oldest),
                ],
              },
            ]
          : []),
      ]
    : [];
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <ReportHeader
        title={t('codOut.title')}
        description={t('codOut.intro')}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/reports/cod">
              <FileCheck aria-hidden />
              {t('codOut.reconciliation')}
            </Link>
          </Button>
        }
      />
      <ReportNote icon={Info}>{t('codOut.hint')}</ReportNote>
      {report.isPending && <p role="status">{t('loading')}</p>}
      {report.isError && <Notice tone="error">{errorMessage(report.error, t)}</Notice>}
      {r && (
        <StatRow
          stats={[
            { label: t('codOut.total'), value: money(r.total) },
            { label: t('codOut.parcels'), value: n(parcels) },
            { label: t('codOut.age.over_30'), value: money(bucketTotal('over_30')) },
            { label: t('codOut.oldest'), value: parcels ? days(oldest) : '—' },
          ]}
        />
      )}
      {r && (
        <ReportBlocks>
          <Table
            full
            caption={t('codOut.holders')}
            sub={t('codOut.holdersSub')}
            head={[
              t('codOut.holder'),
              t('codOut.parcels'),
              t('codOut.amount'),
              ...AGES.map((a) => t(`codOut.age.${a}`)),
              t('codOut.oldest'),
            ]}
            rows={holderRows}
            empty={t('codOut.none')}
            exportName="cod-outstanding"
            exportRows={r.holders.map((h) => [
              holder(h.courier),
              h.parcels,
              { money: h.amount },
              ...AGES.map((a) => ({ money: h.buckets[a] })),
              h.oldestDays,
            ])}
          />
          {r.oldest.length > 0 && (
            <Table
              full
              caption={t('codOut.oldestParcels')}
              head={[
                t('codOut.order'),
                t('codOut.holder'),
                t('codOut.delivered'),
                t('codOut.amount'),
                t('codOut.days'),
              ]}
              rows={r.oldest.map((p) => [
                [p.orderNumber, p.tracking].filter(Boolean).join(' · '),
                holder(p.courier),
                formatDateTime(locale, new Date(`${p.deliveredOn}T12:00:00+06:00`), {
                  day: 'numeric',
                  month: 'short',
                }),
                { text: money(p.amount), strong: true },
                { ...late(p.days), strong: p.days > 14 },
              ])}
              empty={t('codOut.none')}
              exportName="cod-oldest-parcels"
              exportRows={r.oldest.map((p) => [
                [p.orderNumber, p.tracking].filter(Boolean).join(' · '),
                holder(p.courier),
                p.deliveredOn,
                { money: p.amount },
                p.days,
              ])}
            />
          )}
        </ReportBlocks>
      )}
    </div>
  );
}
