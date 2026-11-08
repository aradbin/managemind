// Reports (phase-5a-plan §3.15): for a date range, the return rate by
// product and by reason, refunds by method, failed deliveries and their
// cost by zone, and how orders were paid; and sales recovery (phase-6-plan
// §3.9): incomplete orders, confirmation, delivery by score and duplicates.
// Computed when asked. Each table saves itself as Excel or CSV, as the back
// office's reports do (phase-8-plan §3.8).

import { formatNumber } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Banknote } from 'lucide-react';
import { Notice } from '../components/notice';
import { ReportRange, useRange } from '../components/report-range';
import { ReportBlocks, ReportHeader, ReportHeading, Table } from '../components/report-table';
import { Button } from '../components/ui/button';
import { StatRow } from '../components/ui/stat-row';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/couriers';
import '../i18n/orders';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { pickText } from '../lib/orders';

export { Table };

export function ReportsPage() {
  const { t, locale } = useLocale();
  const [range, setRange] = useRange();
  const { from, to } = range;
  const valid = from <= to;
  const reports = useQuery({
    queryKey: ['reports', from, to],
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/reports', { params: { query: { from, to } } })),
    enabled: valid,
  });
  const n = (v: number) => formatNumber(locale, v);
  const pct = (part: number, whole: number) =>
    whole ? `${formatNumber(locale, Math.round((part / whole) * 1000) / 10)}%` : '—';
  // The same share for an export: a number of percent, empty when there's no whole.
  const share = (part: number, whole: number) =>
    whole ? Math.round((part / whole) * 1000) / 10 : null;
  const recovery = useQuery({
    queryKey: ['reports', 'recovery', from, to],
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/reports/recovery', { params: { query: { from, to } } })),
    enabled: valid,
  });
  const r = reports.data;
  const s = recovery.data;
  const paid = r?.payments.reduce((a, p) => a + p.revenue, 0) ?? 0;
  const orders = r?.payments.reduce((a, p) => a + p.orders, 0) ?? 0;
  const zones = r?.failedByZone ?? [];
  const shipped = zones.reduce((a, z) => a + z.shipped, 0);
  const failed = zones.reduce((a, z) => a + z.failed, 0);
  const lost = zones.reduce((a, z) => a + z.cost, 0);
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <ReportHeader
        title={t('reports.title')}
        description={t('reports.intro')}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/reports/cod">
              <Banknote aria-hidden />
              {t('cod.title')}
            </Link>
          </Button>
        }
      />
      <ReportRange value={range} onChange={setRange} />
      {reports.isPending && valid && <p role="status">{t('loading')}</p>}
      {reports.isError && <Notice tone="error">{errorMessage(reports.error, t)}</Notice>}
      {r && (
        <StatRow
          stats={[
            { label: t('reports.placed'), value: n(r.totals.placed) },
            { label: t('reports.delivered'), value: n(r.totals.delivered) },
            { label: t('reports.returnRate'), value: pct(r.totals.returned, r.totals.delivered) },
            {
              label: t('reports.confirmationRate'),
              value: s?.confirmation.rate == null ? '—' : `${n(s.confirmation.rate)}%`,
            },
          ]}
        />
      )}
      <ReportBlocks>
        {r && (
          <>
            <Table
              caption={t('reports.payments')}
              head={[
                t('reports.paidBy'),
                t('reports.orders'),
                t('reports.share'),
                t('reports.revenue'),
                t('reports.share'),
              ]}
              rows={r.payments.map((p) => [
                t(`reports.kind.${p.kind}` as AdminKey),
                n(p.orders),
                { text: pct(p.orders, orders), muted: true },
                formatPrice(p.revenue, locale),
                { text: pct(p.revenue, paid), muted: true },
              ])}
              empty={t('reports.none')}
              exportName={`payments-${from}-${to}`}
              exportRows={r.payments.map((p) => [
                t(`reports.kind.${p.kind}` as AdminKey),
                p.orders,
                share(p.orders, orders),
                { money: p.revenue },
                share(p.revenue, paid),
              ])}
            />
            <Table
              caption={t('reports.returnsByProduct')}
              head={[
                t('reports.product'),
                t('reports.delivered'),
                t('reports.returned'),
                t('reports.rate'),
              ]}
              rows={r.returnsByProduct.map((p) => [
                pickText(p.title, locale),
                n(p.delivered),
                n(p.returned),
                { text: pct(p.returned, p.delivered), strong: true },
              ])}
              empty={t('reports.none')}
              exportName={`returns-by-product-${from}-${to}`}
              exportRows={r.returnsByProduct.map((p) => [
                pickText(p.title, locale),
                p.delivered,
                p.returned,
                share(p.returned, p.delivered),
              ])}
            />
            <Table
              caption={t('reports.returnsByReason')}
              head={[t('return.reason'), t('reports.returns'), t('reports.units')]}
              rows={r.returnsByReason.map((x) => [
                t(`return.reason.${x.reason}` as AdminKey),
                n(x.returns),
                n(x.units),
              ])}
              empty={t('reports.none')}
              exportName={`returns-by-reason-${from}-${to}`}
              exportRows={r.returnsByReason.map((x) => [
                t(`return.reason.${x.reason}` as AdminKey),
                x.returns,
                x.units,
              ])}
            />
            <Table
              caption={t('reports.refunds')}
              head={[t('refund.method'), t('reports.count'), t('reports.amount')]}
              rows={r.refundsByMethod.map((x) => [
                t(`refund.method.${x.method}` as AdminKey),
                n(x.refunds),
                formatPrice(x.amount, locale),
              ])}
              empty={t('reports.none')}
              exportName={`refunds-by-method-${from}-${to}`}
              exportRows={r.refundsByMethod.map((x) => [
                t(`refund.method.${x.method}` as AdminKey),
                x.refunds,
                { money: x.amount },
              ])}
            />
            <Table
              full
              caption={t('reports.failed')}
              head={[
                t('reports.zone'),
                t('reports.shipped'),
                t('reports.failedCount'),
                t('reports.rate'),
                t('reports.cost'),
              ]}
              rows={[
                ...zones.map((z) => [
                  z.zone ? pickText(z.zone, locale) : t('reports.noZone'),
                  n(z.shipped),
                  n(z.failed),
                  { text: pct(z.failed, z.shipped), strong: true },
                  formatPrice(z.cost, locale),
                ]),
                ...(zones.length > 1
                  ? [
                      {
                        total: true,
                        cells: [
                          t('reports.total'),
                          n(shipped),
                          n(failed),
                          pct(failed, shipped),
                          formatPrice(lost, locale),
                        ],
                      },
                    ]
                  : []),
              ]}
              empty={t('reports.none')}
              exportName={`failed-deliveries-${from}-${to}`}
              exportRows={zones.map((z) => [
                z.zone ? pickText(z.zone, locale) : t('reports.noZone'),
                z.shipped,
                z.failed,
                share(z.failed, z.shipped),
                { money: z.cost },
              ])}
            />
          </>
        )}
        {s && (
          <>
            <ReportHeading>{t('recoveryReport.title')}</ReportHeading>
            <Table
              caption={t('incomplete.title')}
              head={[t('recoveryReport.what'), t('reports.count'), t('reports.amount')]}
              rows={[
                [
                  t('recoveryReport.saved'),
                  n(s.incomplete.saved),
                  formatPrice(s.incomplete.savedValue, locale),
                ],
                [t('recoveryReport.contacted'), n(s.incomplete.contacted), ''],
                [
                  t('recoveryReport.converted'),
                  n(s.incomplete.converted),
                  formatPrice(s.incomplete.convertedValue, locale),
                ],
                [
                  t('recoveryReport.recovered'),
                  n(s.incomplete.recovered),
                  formatPrice(s.incomplete.recoveredValue, locale),
                ],
                [
                  { text: t('recoveryReport.afterCall'), indent: true, muted: true },
                  { text: n(s.incomplete.recoveredAfterCall), muted: true },
                  '',
                ],
                [t('incomplete.tab.dismissed'), n(s.incomplete.dismissed), ''],
              ]}
              empty={t('reports.none')}
              exportName={`incomplete-orders-${from}-${to}`}
              exportRows={[
                [t('recoveryReport.saved'), s.incomplete.saved, { money: s.incomplete.savedValue }],
                [t('recoveryReport.contacted'), s.incomplete.contacted, null],
                [
                  t('recoveryReport.converted'),
                  s.incomplete.converted,
                  { money: s.incomplete.convertedValue },
                ],
                [
                  t('recoveryReport.recovered'),
                  s.incomplete.recovered,
                  { money: s.incomplete.recoveredValue },
                ],
                [t('recoveryReport.afterCall'), s.incomplete.recoveredAfterCall, null],
                [t('incomplete.tab.dismissed'), s.incomplete.dismissed, null],
              ]}
            />
            <Table
              caption={t('recoveryReport.confirmation')}
              head={[t('recoveryReport.what'), t('reports.orders'), t('reports.share')]}
              rows={[
                [
                  { text: t('recoveryReport.codPlaced'), strong: true },
                  { text: n(s.confirmation.placed), strong: true },
                  '',
                ],
                ...(['call', 'link', 'staff', 'auto'] as const).map((via) => [
                  { text: t(`confirmedVia.${via}` as AdminKey), indent: true },
                  n(s.confirmation.confirmedBy[via]),
                  pct(s.confirmation.confirmedBy[via], s.confirmation.placed),
                ]),
                ...s.confirmation.cancelledBy.map((x) => [
                  {
                    text: t('recoveryReport.cancelled', {
                      why: t(`cancelCode.${x.code}` as AdminKey),
                    }),
                    indent: true,
                  },
                  n(x.orders),
                  pct(x.orders, s.confirmation.placed),
                ]),
                [t('queue.tab.unreachable'), n(s.confirmation.unreachable), ''],
                [
                  t('recoveryReport.rate'),
                  {
                    text: s.confirmation.rate === null ? '—' : `${n(s.confirmation.rate)}%`,
                    strong: true,
                  },
                  '',
                ],
                [
                  t('recoveryReport.median'),
                  {
                    text:
                      s.confirmation.medianMinutes === null
                        ? '—'
                        : t('recoveryReport.minutes', { count: n(s.confirmation.medianMinutes) }),
                    strong: true,
                  },
                  '',
                ],
              ]}
              empty={t('reports.none')}
              exportName={`confirmation-${from}-${to}`}
              // The rate's and the median's units go in their labels, so the cells stay numbers.
              exportRows={[
                [t('recoveryReport.codPlaced'), s.confirmation.placed, null],
                ...(['call', 'link', 'staff', 'auto'] as const).map((via) => [
                  t(`confirmedVia.${via}` as AdminKey),
                  s.confirmation.confirmedBy[via],
                  share(s.confirmation.confirmedBy[via], s.confirmation.placed),
                ]),
                ...s.confirmation.cancelledBy.map((x) => [
                  t('recoveryReport.cancelled', { why: t(`cancelCode.${x.code}` as AdminKey) }),
                  x.orders,
                  share(x.orders, s.confirmation.placed),
                ]),
                [t('queue.tab.unreachable'), s.confirmation.unreachable, null],
                [`${t('recoveryReport.rate')} (%)`, s.confirmation.rate, null],
                [
                  `${t('recoveryReport.median')} (${t('recoveryReport.minutes', { count: '' }).trim()})`,
                  s.confirmation.medianMinutes,
                  null,
                ],
              ]}
            />
            <Table
              caption={t('recoveryReport.byScore')}
              hint={t('recoveryReport.byScoreHint')}
              head={[
                t('recoveryReport.scoreAtOrder'),
                t('reports.delivered'),
                t('recoveryReport.notReceived'),
                t('reports.rate'),
              ]}
              rows={s.deliveryByScore.map((b) => [
                b.band === 'new' ? t('risk.new') : `${b.band}%`,
                n(b.delivered),
                n(b.notReceived),
                {
                  text: pct(b.notReceived, b.delivered + b.notReceived),
                  strong: true,
                  // More than three in ten lost: worth a look, in red as drawn.
                  danger: b.notReceived / Math.max(1, b.delivered + b.notReceived) > 0.3,
                },
              ])}
              empty={t('reports.none')}
              exportName={`delivery-by-score-${from}-${to}`}
              exportRows={s.deliveryByScore.map((b) => [
                b.band === 'new' ? t('risk.new') : `${b.band}%`,
                b.delivered,
                b.notReceived,
                share(b.notReceived, b.delivered + b.notReceived),
              ])}
            />
            <Table
              caption={t('confirmSettings.duplicates')}
              head={[t('recoveryReport.what'), t('reports.orders')]}
              rows={[
                [t('recoveryReport.flagged'), n(s.duplicates.flagged)],
                [t('recoveryReport.merged'), n(s.duplicates.merged)],
                [t('duplicate.cancel'), n(s.duplicates.cancelled)],
                [t('duplicate.dismiss'), n(s.duplicates.dismissed)],
              ]}
              empty={t('reports.none')}
              exportName={`duplicate-orders-${from}-${to}`}
              exportRows={[
                [t('recoveryReport.flagged'), s.duplicates.flagged],
                [t('recoveryReport.merged'), s.duplicates.merged],
                [t('duplicate.cancel'), s.duplicates.cancelled],
                [t('duplicate.dismiss'), s.duplicates.dismissed],
              ]}
            />
          </>
        )}
      </ReportBlocks>
    </div>
  );
}
