// COD outstanding (phase-8-plan §3.8): cash on delivery that was delivered
// but hasn't reached the store, per courier and for the store's own riders,
// by age. The parcel-by-parcel view is Phase 7's COD reconciliation.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { Table } from '../components/report-table';
import { ReportsNav } from '../components/reports-nav';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/couriers';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { courierName } from '../lib/couriers';
import { errorMessage } from '../lib/errors';

const AGES = ['0_7', '8_14', '15_30', 'over_30'] as const;

export function CodOutstandingPage() {
  const { t, locale } = useLocale();
  const report = useQuery({
    queryKey: ['reports', 'cod-outstanding'],
    queryFn: async () => unwrap(await api.GET('/v1/admin/reports/cod-outstanding')),
  });
  const money = (v: number) => formatPrice(v, locale);
  const n = (v: number) => v.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD');
  const holder = (c: string | null) => (c === null ? t('codOut.ownRiders') : courierName(c, t));
  const r = report.data;
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <PageHeader
        className="mb-0"
        title={t('codOut.title')}
        description={t('codOut.intro')}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/reports/cod">{t('codOut.reconciliation')}</Link>
          </Button>
        }
      />
      <ReportsNav />
      {report.isPending && <p role="status">{t('loading')}</p>}
      {report.isError && <Notice tone="error">{errorMessage(report.error, t)}</Notice>}
      {r && (
        <>
          <dl className="grid grid-cols-2 gap-3 md:max-w-xl">
            <div className="rounded-xl border border-border bg-background p-4">
              <dt className="text-sm text-muted-foreground">{t('codOut.total')}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{money(r.total)}</dd>
            </div>
            <div className="rounded-xl border border-border bg-background p-4">
              <dt className="text-sm text-muted-foreground">{t('codOut.parcels')}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {n(r.holders.reduce((a, h) => a + h.parcels, 0))}
              </dd>
            </div>
          </dl>
          <Table
            caption={t('codOut.holders')}
            head={[
              t('codOut.holder'),
              t('codOut.parcels'),
              t('codOut.amount'),
              ...AGES.map((a) => t(`codOut.age.${a}`)),
              t('codOut.oldest'),
            ]}
            rows={r.holders.map((h) => [
              holder(h.courier),
              n(h.parcels),
              money(h.amount),
              ...AGES.map((a) => money(h.buckets[a])),
              t('stockReport.days', { count: n(h.oldestDays) }),
            ])}
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
          <p className="-mt-2 text-sm text-muted-foreground">{t('codOut.hint')}</p>
        </>
      )}
    </div>
  );
}
