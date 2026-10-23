// The home dashboard (phase-4-plan §3.17): today's and this month's sales
// (reports.read), what is waiting (orders.read), and the last 7 days as
// columns with a hover and focus tooltip and a table view, so no figure
// depends on seeing the chart.
import { formatDateTime, type Locale } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Notice } from '../components/notice';
import { usePermission } from '../components/permission-gate';
import { SetupCard } from '../components/setup-card';
import { useLocale } from '../i18n';
import '../i18n/orders';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { type Dashboard, dashboardQuery } from '../lib/orders';

export function DashboardView() {
  const { t, locale } = useLocale();
  const data = useQuery(dashboardQuery);
  const canReports = usePermission('reports.read');
  if (data.isPending) return <p role="status">{t('loading')}</p>;
  if (data.isError) return <Notice tone="error">{errorMessage(data.error, t)}</Notice>;
  const { counts, sales } = data.data;
  const waiting = [
    {
      label: t('dashboard.awaiting'),
      value: counts.awaitingConfirmation,
      to: '/orders' as const,
      search: { status: 'pending' as const },
    },
    {
      label: t('dashboard.toShip'),
      value: counts.toShip,
      to: '/orders' as const,
      search: { status: 'confirmed' as const, deliveryStatus: 'not_shipped' as const },
    },
    {
      label: t('dashboard.cancelledByShopper'),
      value: counts.cancelledByShopper7d,
      to: '/orders' as const,
      search: { cancelledByShopper: true },
    },
  ];
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <SetupCard />
      {sales && (
        <section aria-labelledby="sales-h" className="grid gap-3 md:grid-cols-2">
          <h2 id="sales-h" className="sr-only">
            {t('dashboard.sales')}
          </h2>
          <div className="rounded-md border border-border p-4">
            <p className="text-sm text-muted-foreground">{t('dashboard.today')}</p>
            <p className="text-5xl font-semibold">{formatPrice(sales.today.total, locale)}</p>
            <p className="text-sm text-muted-foreground">
              {t('dashboard.orders', { count: sales.today.orders })}
            </p>
          </div>
          <div className="rounded-md border border-border p-4">
            <p className="text-sm text-muted-foreground">{t('dashboard.month')}</p>
            <p className="text-2xl font-semibold">{formatPrice(sales.month.total, locale)}</p>
            <p className="text-sm text-muted-foreground">
              {t('dashboard.orders', { count: sales.month.orders })}
            </p>
          </div>
        </section>
      )}
      <section aria-labelledby="waiting-h" className="flex flex-col gap-2">
        <h2 id="waiting-h" className="font-semibold">
          {t('dashboard.waiting')}
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {waiting.map((w) => (
            <li key={w.label}>
              <Link
                to={w.to}
                search={w.search}
                className="flex min-h-20 flex-col justify-between rounded-md border border-border p-3 hover:bg-muted"
              >
                <span className="text-sm text-muted-foreground">{w.label}</span>
                <span className="text-2xl font-semibold">{w.value}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              to="/inventory"
              search={{ lowStock: true }}
              className="flex min-h-20 flex-col justify-between rounded-md border border-border p-3 hover:bg-muted"
            >
              <span className="text-sm text-muted-foreground">{t('dashboard.lowStock')}</span>
              <span className="text-2xl font-semibold">{counts.lowStock}</span>
            </Link>
          </li>
        </ul>
      </section>
      {sales && <WeekChart days={sales.days} locale={locale} />}
      <nav aria-label={t('dashboard.more')} className="flex flex-wrap gap-3 text-sm">
        <Link to="/returns" className="underline">
          {t('dashboard.returns')}
        </Link>
        {canReports && (
          <Link to="/reports" className="underline">
            {t('dashboard.reports')}
          </Link>
        )}
      </nav>
    </div>
  );
}

function WeekChart({
  days,
  locale,
}: {
  days: NonNullable<Dashboard['sales']>['days'];
  locale: Locale;
}) {
  const { t } = useLocale();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.total), 1);
  const day = (date: string, style: 'short' | 'long') =>
    formatDateTime(
      locale,
      new Date(`${date}T12:00:00+06:00`),
      style === 'short' ? { weekday: 'short' } : { weekday: 'long', day: 'numeric', month: 'long' },
    );
  const best = days.reduce((a, d, i) => (d.total > (days[a]?.total ?? 0) ? i : a), 0);
  return (
    <section
      aria-labelledby="week-h"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <h2 id="week-h" className="font-semibold">
        {t('dashboard.week')}
      </h2>
      {/* The columns are for the eye; the table below is the accessible view. */}
      <div aria-hidden className="relative flex h-40 items-end gap-0.5 border-b border-border">
        {days.map((d, i) => {
          const height = d.total ? Math.max(2, (d.total / max) * 100) : 0;
          return (
            <div
              key={d.date}
              className="relative flex h-full flex-1 flex-col items-center justify-end"
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
            >
              {i === best && d.total > 0 && active === null && (
                <span className="mb-1 text-xs text-muted-foreground">
                  {formatPrice(d.total, locale)}
                </span>
              )}
              <div
                className={`w-full max-w-6 rounded-t bg-primary ${active === null || active === i ? '' : 'opacity-40'}`}
                style={{ height: `${height}%` }}
              />
              {active === i && (
                <div className="absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 text-xs shadow-md">
                  <p className="font-medium">{day(d.date, 'long')}</p>
                  <p>{formatPrice(d.total, locale)}</p>
                  <p className="text-muted-foreground">
                    {t('dashboard.orders', { count: d.orders })}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div aria-hidden className="flex gap-0.5 text-center text-xs text-muted-foreground">
        {days.map((d) => (
          <span key={d.date} className="flex-1">
            {day(d.date, 'short')}
          </span>
        ))}
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm">{t('dashboard.asTable')}</summary>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('dashboard.week')}</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="p-1">
                {t('dashboard.day')}
              </th>
              <th scope="col" className="p-1">
                {t('dashboard.ordersColumn')}
              </th>
              <th scope="col" className="p-1 text-right">
                {t('dashboard.salesColumn')}
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date} className="border-t border-border">
                <td className="p-1">{day(d.date, 'long')}</td>
                <td className="p-1">{d.orders}</td>
                <td className="p-1 text-right">{formatPrice(d.total, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
