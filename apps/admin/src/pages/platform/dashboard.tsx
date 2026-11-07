// Platform → Dashboard (phase-5b-plan §3.3), as its board draws it (ADR
// 0034): the stores as figures, sales across client stores with the last 30
// days as a chart (or a table) beside the free-plan numbers from this
// morning's usage check (a warning at 70%), money as figures, and use per
// store as a table (rows on phones). Every number is also text.
import { formatNumber } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { BarChart, niceMax } from '../../components/bar-chart';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { Button } from '../../components/ui/button';
import { cardFrame, cardPadded, cardTitle } from '../../components/ui/card';
import { useLocale } from '../../i18n';
import { formatDateTime } from '../../lib/dates';
import '../../i18n/launch';
import '../../i18n/orders';
import { api, unwrap } from '../../lib/api';
import { formatPrice } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { cn } from '../../lib/utils';

const dashboardQuery = {
  queryKey: ['platform', 'dashboard'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/platform/dashboard')),
};

/** One figure (.mm-fig): its name, the number, and a note under it. */
function Fig({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className="text-[22px] leading-7 font-semibold tracking-[-0.01em] tabular-nums">
        {value}
      </dd>
      {note && <small className="text-xs leading-4 font-medium">{note}</small>}
    </div>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <h2 id={id} className="text-[15px] leading-5 font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

const megabytes = (bytes: number) => Math.round((bytes / 2 ** 20) * 10) / 10;

export function PlatformDashboardPage() {
  const { t, locale } = useLocale();
  const data = useQuery(dashboardQuery);
  const [asTable, setAsTable] = useState(false);
  const num = (n: number) => formatNumber(locale, n);
  const header = <PageHeader className="mb-0" title={t('platform.dashboard')} />;
  if (data.isPending)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p role="status">{t('loading')}</p>
      </div>
    );
  if (data.isError)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Notice tone="error">{errorMessage(data.error, t)}</Notice>
      </div>
    );
  const d = data.data;
  const day = (iso: string) =>
    formatDateTime(locale, new Date(`${iso}T12:00:00+06:00`), { day: 'numeric', month: 'short' });
  const muted = 'text-muted-foreground';
  return (
    <div className="flex w-full max-w-[1080px] flex-col gap-3 md:gap-4">
      {header}
      <Group id="pd-stores" title={t('pdash.stores')}>
        <dl className="m-0 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
          <Fig label={t('pdash.active')} value={num(d.stores.active)} />
          <Fig label={t('pdash.inSetup')} value={num(d.stores.inSetup)} />
          <Fig label={t('pdash.suspended')} value={num(d.stores.suspended)} />
          <Fig label={t('pdash.closed')} value={num(d.stores.closed)} />
        </dl>
      </Group>

      <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="pd-sales" className={cn(cardPadded, 'gap-3.5 md:gap-3.5')}>
          <div className="flex items-center gap-3">
            <h2 id="pd-sales" className={cn(cardTitle, 'flex-1')}>
              {t('pdash.sales')}
            </h2>
            <Button
              variant="ghost"
              className="-mr-2 h-7 px-2 md:h-7"
              onClick={() => setAsTable(!asTable)}
            >
              {t(asTable ? 'pdash.asChart' : 'pdash.asTable')}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['pdash.yesterday', d.sales.yesterday],
                ['pdash.month', d.sales.month],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-muted-foreground">{t(label)}</span>
                <span className="text-xl leading-7 font-semibold tabular-nums">
                  {formatPrice(v.total, locale)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('pdash.orders', { count: v.orders })}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs font-medium text-muted-foreground">{t('pdash.trend')}</p>
          {asTable ? (
            <div className="-mx-4 max-h-[260px] overflow-y-auto md:-mx-5">
              <table className="w-full border-collapse text-[13px] tabular-nums">
                <caption className="sr-only">
                  {t('pdash.sales')}, {t('pdash.trend')}
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="h-9 bg-muted px-3 pl-4 text-left font-medium text-muted-foreground md:pl-5"
                    >
                      {t('pdash.day')}
                    </th>
                    <th
                      scope="col"
                      className="h-9 bg-muted px-3 text-right font-medium text-muted-foreground"
                    >
                      {t('pdash.ordersColumn')}
                    </th>
                    <th
                      scope="col"
                      className="h-9 bg-muted px-3 pr-4 text-right font-medium text-muted-foreground md:pr-5"
                    >
                      {t('pdash.total')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.sales.days
                    .slice()
                    .reverse()
                    .map((x) => (
                      <tr key={x.day} className="border-t border-border">
                        <td className="h-10 px-3 pl-4 md:pl-5">{day(x.day)}</td>
                        <td className="h-10 px-3 text-right">{num(x.orders)}</td>
                        <td className="h-10 px-3 pr-4 text-right font-medium md:pr-5">
                          {formatPrice(x.total, locale)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <BarChart
              label={`${t('pdash.sales')}, ${t('pdash.trend')}`}
              top={niceMax(Math.max(...d.sales.days.map((x) => x.total)))}
              steps={2}
              height={170}
              bars={d.sales.days.map((x, i) => ({
                key: x.day,
                value: x.total,
                // A label every fifth day, as drawn.
                label: i % 5 === 0 ? day(x.day) : '',
                tip: `${day(x.day)}: ${formatPrice(x.total, locale)} · ${t('pdash.orders', { count: x.orders })}`,
              }))}
            />
          )}
        </section>

        <section aria-labelledby="pd-free" className={cn(cardPadded, 'gap-3.5 md:gap-3.5')}>
          <div className="flex flex-col gap-1">
            <h2 id="pd-free" className={cardTitle}>
              {t('pdash.freeTier')}
            </h2>
            {d.freeTier && (
              <p className="text-[13px] text-muted-foreground">
                {t('pdash.freeTierAsOf', {
                  when: formatDateTime(locale, new Date(d.freeTier.generatedAt)),
                })}
              </p>
            )}
          </div>
          {d.freeTier ? (
            <>
              <ul className="flex flex-col gap-3">
                {d.freeTier.limits.map((l) => {
                  const pct = Math.round(l.share * 100);
                  const near = l.share > 0.7;
                  return (
                    <li key={l.name} className="flex flex-col gap-1.5">
                      <span className="flex flex-wrap justify-between gap-x-2 gap-y-1 text-[13px]">
                        <span lang="en">{l.name}</span>
                        <span className="tabular-nums">
                          {num(Math.round(l.used))} / {num(l.limit)} {l.unit} ({num(pct)}%)
                          {near && <strong className="ms-2 text-danger">{t('pdash.near')}</strong>}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className="block h-1.5 overflow-hidden rounded-full bg-muted"
                      >
                        <span
                          className={cn(
                            'block h-full rounded-full',
                            near ? 'bg-danger-fill' : 'bg-primary',
                          )}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[13px]">
                <span className={muted}>{t('pdash.deadLetters')}:</span>{' '}
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
      </div>

      <Group id="pd-money" title={t('pdash.money')}>
        <dl className="m-0 grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
          <Fig
            label={t('pdash.overdue')}
            value={formatPrice(d.money.overdue.total, locale)}
            note={
              <span className={d.money.overdue.count > 0 ? 'text-danger' : muted}>
                {t('pdash.invoices', { count: d.money.overdue.count })}
              </span>
            }
          />
          <Fig
            label={t('pdash.dueThisWeek')}
            value={formatPrice(d.money.dueThisWeek.total, locale)}
            note={
              <span className={muted}>
                {t('pdash.invoices', { count: d.money.dueThisWeek.count })}
              </span>
            }
          />
          <Fig
            label={t('pdash.paidThisMonth')}
            value={formatPrice(d.money.paidThisMonth, locale)}
          />
        </dl>
      </Group>

      <Group id="pd-use" title={t('pdash.perStore')}>
        <div className={cn(cardFrame, 'overflow-hidden')}>
          <table className="w-full border-collapse max-md:hidden">
            <thead>
              <tr className="h-[38px] bg-muted text-[13px] font-medium text-muted-foreground">
                <th scope="col" className="pl-4 text-left font-medium">
                  {t('pdash.store')}
                </th>
                {(
                  [
                    'pdash.ordersMonth',
                    'pdash.products',
                    'pdash.emailsMonth',
                    'pdash.storage',
                    'pdash.domains',
                  ] as const
                ).map((k) => (
                  <th key={k} scope="col" className="px-3 text-right font-medium last:pr-4">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.perStore.map((s) => (
                <tr key={s.tenantId} className="h-[52px] border-t border-border tabular-nums">
                  <td className="pl-4 font-medium">
                    <Link to="/platform/tenants/$id" params={{ id: s.tenantId }}>
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-3 text-right">{num(s.ordersThisMonth)}</td>
                  <td className="px-3 text-right">{num(s.products)}</td>
                  <td className="px-3 text-right">{num(s.emailsThisMonth)}</td>
                  <td className="px-3 text-right">{num(megabytes(s.storageBytes))} MB</td>
                  <td className="px-3 pr-4 text-right">{num(s.customDomains)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="md:hidden">
            {d.perStore.map((s) => (
              <li key={s.tenantId} className="border-t border-border first:border-t-0">
                <Link
                  to="/platform/tenants/$id"
                  params={{ id: s.tenantId }}
                  className="flex min-h-16 flex-col justify-center px-3 py-2 font-medium"
                >
                  <span className="truncate">{s.name}</span>
                  <span className="truncate text-[13px] font-normal text-muted-foreground">
                    {t('pdash.orders', { count: s.ordersThisMonth })} ·{' '}
                    {t('pdash.productCount', { count: s.products })} ·{' '}
                    {num(megabytes(s.storageBytes))} MB
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Group>
    </div>
  );
}
