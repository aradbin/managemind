// Platform → Dashboard (phase-5b-plan §3.3): stores, sales across client
// stores, money, use per store, and the free-tier numbers from this
// morning's usage check, with a warning at 70%. Every number is also text.
import { formatDateTime, formatNumber } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { useLocale } from '../../i18n';
import '../../i18n/launch';
import { api, unwrap } from '../../lib/api';
import { formatPrice } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';

const dashboardQuery = {
  queryKey: ['platform', 'dashboard'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/platform/dashboard')),
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background p-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
    </div>
  );
}

const megabytes = (bytes: number) => Math.round((bytes / 2 ** 20) * 10) / 10;

export function PlatformDashboardPage() {
  const { t, locale } = useLocale();
  const data = useQuery(dashboardQuery);
  const num = (n: number) => formatNumber(locale, n);
  if (data.isPending) return <p role="status">{t('loading')}</p>;
  if (data.isError) return <Notice tone="error">{errorMessage(data.error, t)}</Notice>;
  const d = data.data;
  const max = Math.max(...d.sales.days.map((x) => x.total), 1);
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader title={t('platform.dashboard')} />
      <section aria-labelledby="pd-stores" className="flex flex-col gap-2">
        <h2 id="pd-stores" className="font-semibold">
          {t('pdash.stores')}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t('pdash.active')} value={num(d.stores.active)} />
          <Stat label={t('pdash.inSetup')} value={num(d.stores.inSetup)} />
          <Stat label={t('pdash.suspended')} value={num(d.stores.suspended)} />
          <Stat label={t('pdash.closed')} value={num(d.stores.closed)} />
        </div>
      </section>

      <section
        aria-labelledby="pd-free"
        className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <h2 id="pd-free" className="font-semibold">
          {t('pdash.freeTier')}
        </h2>
        {d.freeTier ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t('pdash.freeTierAsOf', {
                when: formatDateTime(locale, new Date(d.freeTier.generatedAt)),
              })}
            </p>
            <ul className="flex flex-col gap-3">
              {d.freeTier.limits.map((l) => {
                const pct = Math.round(l.share * 100);
                const near = l.share > 0.7;
                return (
                  <li key={l.name} className="flex flex-col gap-1">
                    <span className="flex flex-wrap justify-between gap-2 text-sm">
                      <span lang="en">{l.name}</span>
                      <span>
                        {num(Math.round(l.used))} / {num(l.limit)} {l.unit} ({num(pct)}%)
                        {near && <strong className="ms-2 text-danger">{t('pdash.near')}</strong>}
                      </span>
                    </span>
                    <span aria-hidden className="h-2 w-full overflow-hidden rounded bg-muted">
                      <span
                        className={`block h-full ${near ? 'bg-danger' : 'bg-primary'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm">
              {t('pdash.deadLetters')}:{' '}
              {Object.entries(d.freeTier.deadLetters)
                .map(
                  ([k, v]) =>
                    `${t(k === 'outbox' ? 'pdash.deadLetter.outbox' : 'pdash.deadLetter.imports')} ${
                      v === null ? t('pdash.unknown') : num(v)
                    }`,
                )
                .join(' · ')}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">{t('pdash.freeTierNone')}</p>
        )}
      </section>

      <section aria-labelledby="pd-sales" className="flex flex-col gap-2">
        <h2 id="pd-sales" className="font-semibold">
          {t('pdash.sales')}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Stat
            label={t('pdash.yesterday')}
            value={formatPrice(d.sales.yesterday.total, locale)}
            hint={t('pdash.orders', { count: d.sales.yesterday.orders })}
          />
          <Stat
            label={t('pdash.month')}
            value={formatPrice(d.sales.month.total, locale)}
            hint={t('pdash.orders', { count: d.sales.month.orders })}
          />
        </div>
        <details className="rounded-lg border border-border bg-background p-3">
          <summary className="min-h-11 cursor-pointer content-center font-medium">
            {t('pdash.trend')}
          </summary>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-start text-muted-foreground">
                <th className="text-start font-normal">{t('pdash.day')}</th>
                <th className="text-start font-normal">{t('pdash.total')}</th>
              </tr>
            </thead>
            <tbody>
              {d.sales.days.map((x) => (
                <tr key={x.day}>
                  <td className="py-1">
                    {formatDateTime(locale, new Date(`${x.day}T12:00:00+06:00`), {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </td>
                  <td className="py-1">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block h-2 rounded bg-primary"
                        style={{ width: `${Math.max(2, (x.total / max) * 8)}rem` }}
                      />
                      {formatPrice(x.total, locale)} · {t('pdash.orders', { count: x.orders })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section aria-labelledby="pd-money" className="flex flex-col gap-2">
        <h2 id="pd-money" className="font-semibold">
          {t('pdash.money')}
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Stat
            label={t('pdash.overdue')}
            value={formatPrice(d.money.overdue.total, locale)}
            hint={t('pdash.invoices', {
              count: d.money.overdue.count,
              amount: formatPrice(d.money.overdue.total, locale),
            })}
          />
          <Stat
            label={t('pdash.dueThisWeek')}
            value={formatPrice(d.money.dueThisWeek.total, locale)}
            hint={t('pdash.invoices', {
              count: d.money.dueThisWeek.count,
              amount: formatPrice(d.money.dueThisWeek.total, locale),
            })}
          />
          <Stat
            label={t('pdash.paidThisMonth')}
            value={formatPrice(d.money.paidThisMonth, locale)}
          />
        </div>
      </section>

      <section
        aria-labelledby="pd-stores-use"
        className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <h2 id="pd-stores-use" className="font-semibold">
          {t('pdash.perStore')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-start font-normal">{t('store.name')}</th>
                <th className="text-end font-normal">{t('pdash.ordersMonth')}</th>
                <th className="text-end font-normal">{t('pdash.products')}</th>
                <th className="text-end font-normal">{t('pdash.emailsMonth')}</th>
                <th className="text-end font-normal">{t('pdash.storage')}</th>
                <th className="text-end font-normal">{t('pdash.domains')}</th>
              </tr>
            </thead>
            <tbody>
              {d.perStore.map((s) => (
                <tr key={s.tenantId} className="border-t border-border">
                  <td className="py-2">
                    <Link
                      to="/platform/tenants/$id"
                      params={{ id: s.tenantId }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="text-end">{num(s.ordersThisMonth)}</td>
                  <td className="text-end">{num(s.products)}</td>
                  <td className="text-end">{num(s.emailsThisMonth)}</td>
                  <td className="text-end">{num(megabytes(s.storageBytes))} MB</td>
                  <td className="text-end">{num(s.customDomains)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
