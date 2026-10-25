// Reports (phase-5a-plan §3.15): for a date range, the return rate by
// product and by reason, refunds by method, failed deliveries and their
// cost by zone, and how orders were paid; and sales recovery (phase-6-plan
// §3.9): incomplete orders, confirmation, delivery by score and duplicates.
// Computed when asked.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/couriers';
import '../i18n/orders';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { pickText } from '../lib/orders';

// The server reads the range as Dhaka dates, so today is Dhaka's today.
const DHAKA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' });
const day = (d: Date) => DHAKA_DAY.format(d);

export function Table({
  caption,
  head,
  rows,
  empty,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
  empty: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5">
      <h2 className="font-semibold">{caption}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div
          // Wide tables scroll sideways on phones; keyboard users can scroll them too.
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable (WCAG 2.1.1).
          tabIndex={0}
          className="-mx-4 overflow-x-auto border-y border-border md:-mx-5"
        >
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs text-muted-foreground">
              <tr>
                {head.map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={`px-4 py-2.5 font-medium md:px-5 ${i ? 'text-right' : ''}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={j} className="border-t border-border">
                  {r.map((cell, i) => (
                    <td
                      key={i}
                      className={`px-4 py-2.5 md:px-5 ${i ? 'text-right tabular-nums' : ''}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ReportsPage() {
  const { t, locale } = useLocale();
  const [from, setFrom] = useState(day(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(day(new Date()));
  const valid = from <= to;
  const reports = useQuery({
    queryKey: ['reports', from, to],
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/reports', { params: { query: { from, to } } })),
    enabled: valid,
  });
  const n = (v: number) => v.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD');
  const pct = (part: number, whole: number) =>
    whole
      ? `${(Math.round((part / whole) * 1000) / 10).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD')}%`
      : '—';
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
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <PageHeader
        className="mb-0"
        title={t('reports.title')}
        description={t('reports.intro')}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/reports/cod">{t('cod.title')}</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-background p-4 md:p-5 md:max-w-md">
        <Field
          label={t('reports.from')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          label={t('reports.to')}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          error={valid ? undefined : t('form.invalid')}
        />
      </div>
      {reports.isPending && valid && <p role="status">{t('loading')}</p>}
      {reports.isError && <Notice tone="error">{errorMessage(reports.error, t)}</Notice>}
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
              pct(p.orders, orders),
              formatPrice(p.revenue, locale),
              pct(p.revenue, paid),
            ])}
            empty={t('reports.none')}
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
              pct(p.returned, p.delivered),
            ])}
            empty={t('reports.none')}
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
          />
          <Table
            caption={t('reports.failed')}
            head={[
              t('reports.zone'),
              t('reports.shipped'),
              t('reports.failedCount'),
              t('reports.rate'),
              t('reports.cost'),
            ]}
            rows={r.failedByZone.map((z) => [
              z.zone ? pickText(z.zone, locale) : t('reports.noZone'),
              n(z.shipped),
              n(z.failed),
              pct(z.failed, z.shipped),
              formatPrice(z.cost, locale),
            ])}
            empty={t('reports.none')}
          />
        </>
      )}
      {s && (
        <>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">{t('recoveryReport.title')}</h2>
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
              [t('recoveryReport.afterCall'), n(s.incomplete.recoveredAfterCall), ''],
              [t('incomplete.tab.dismissed'), n(s.incomplete.dismissed), ''],
            ]}
            empty={t('reports.none')}
          />
          <Table
            caption={t('recoveryReport.confirmation')}
            head={[t('recoveryReport.what'), t('reports.orders'), t('reports.share')]}
            rows={[
              [t('recoveryReport.codPlaced'), n(s.confirmation.placed), ''],
              ...(['call', 'link', 'staff', 'auto'] as const).map((via) => [
                t(`confirmedVia.${via}` as AdminKey),
                n(s.confirmation.confirmedBy[via]),
                pct(s.confirmation.confirmedBy[via], s.confirmation.placed),
              ]),
              ...s.confirmation.cancelledBy.map((x) => [
                t('recoveryReport.cancelled', { why: t(`cancelCode.${x.code}` as AdminKey) }),
                n(x.orders),
                pct(x.orders, s.confirmation.placed),
              ]),
              [t('queue.tab.unreachable'), n(s.confirmation.unreachable), ''],
              [
                t('recoveryReport.rate'),
                s.confirmation.rate === null ? '—' : `${n(s.confirmation.rate)}%`,
                '',
              ],
              [
                t('recoveryReport.median'),
                s.confirmation.medianMinutes === null
                  ? '—'
                  : t('recoveryReport.minutes', { count: n(s.confirmation.medianMinutes) }),
                '',
              ],
            ]}
            empty={t('reports.none')}
          />
          <Table
            caption={t('recoveryReport.byScore')}
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
              pct(b.notReceived, b.delivered + b.notReceived),
            ])}
            empty={t('reports.none')}
          />
          <p className="-mt-2 text-sm text-muted-foreground">{t('recoveryReport.byScoreHint')}</p>
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
          />
        </>
      )}
    </div>
  );
}
