// Reports (phase-5a-plan §3.15): for a date range, the return rate by
// product and by reason, refunds by method, failed deliveries and their
// cost by zone, and how orders were paid. Computed when asked.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { pickText } from '../lib/orders';

const day = (d: Date) => d.toISOString().slice(0, 10);

function Table({
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
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">{caption}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                {head.map((h, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed header; two columns share a name
                  <th key={i} scope="col" className={`p-2 font-medium ${i ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are recomputed, never reordered
                <tr key={j} className="border-t border-border">
                  {r.map((cell, i) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: cells follow the fixed header
                      key={i}
                      className={`p-2 ${i ? 'text-right tabular-nums' : ''}`}
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
  const r = reports.data;
  const paid = r?.payments.reduce((a, p) => a + p.revenue, 0) ?? 0;
  const orders = r?.payments.reduce((a, p) => a + p.orders, 0) ?? 0;
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('reports.title')} description={t('reports.intro')} />
      <div className="grid max-w-md grid-cols-2 gap-3">
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
    </div>
  );
}
