// The home dashboard (phase-4-plan §3.17, redesigned in ADR 0029). From top
// to bottom: a greeting, the setup checklist and plan limits while they
// matter, today's and this month's numbers (reports.read), the last 7 days as
// columns with a tooltip and a table view (so no figure depends on seeing the
// chart), what is waiting, and the latest orders (orders.read).
import { formatDateTime, formatNumber, type Locale } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ChevronRight,
  CircleX,
  Clock,
  Copy,
  type LucideIcon,
  PackageX,
  PhoneCall,
  Plus,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { useState } from 'react';
import { Notice } from '../components/notice';
import { StatusChip } from '../components/order-status';
import { usePermission } from '../components/permission-gate';
import { SetupCard } from '../components/setup-card';
import { Button } from '../components/ui/button';
import { Card, CardSection } from '../components/ui/card';
import { UsageCard } from '../components/usage-card';
import { useLocale } from '../i18n';
import '../i18n/orders';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { type Dashboard, dashboardQuery, dateTime, fetchOrders, pickText } from '../lib/orders';
import { cn } from '../lib/utils';

type Days = NonNullable<Dashboard['sales']>['days'];

/** The hour in Dhaka, for the greeting. */
const dhakaHour = (now: Date) =>
  Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: 'Asia/Dhaka',
    }).format(now),
  );

export function DashboardView() {
  const { t, locale } = useLocale();
  const data = useQuery(dashboardQuery);
  const canOrders = usePermission('orders.read');
  const canWrite = usePermission('orders.write');
  const canReports = usePermission('reports.read');
  const now = new Date();
  const hour = dhakaHour(now);
  const greeting =
    hour < 12 ? 'dashboard.morning' : hour < 17 ? 'dashboard.afternoon' : 'dashboard.evening';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            {formatDateTime(locale, now, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{t(greeting)}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canReports && (
            <Button variant="secondary" asChild>
              <Link to="/reports">{t('dashboard.reports')}</Link>
            </Button>
          )}
          {canWrite && (
            <Button asChild>
              <Link to="/orders/new">
                <Plus aria-hidden className="size-4" />
                {t('orders.new')}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <SetupCard />
      <UsageCard />

      {data.isPending && <p role="status">{t('loading')}</p>}
      {data.isError && <Notice tone="error">{errorMessage(data.error, t)}</Notice>}
      {data.data && (
        <>
          {data.data.sales && <KeyNumbers sales={data.data.sales} locale={locale} />}
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {/* First on phones, where acting on it matters most; beside the chart on desktops. */}
            <div className="lg:col-start-2 lg:row-start-1">
              <Waiting
                counts={data.data.counts}
                confirmation={data.data.confirmation}
                incomplete={data.data.incomplete}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
              {data.data.sales && <WeekChart days={data.data.sales.days} locale={locale} />}
              {canOrders && <RecentOrders />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KeyNumbers({ sales, locale }: { sales: NonNullable<Dashboard['sales']>; locale: Locale }) {
  const { t } = useLocale();
  const yesterday = sales.days.at(-2);
  const average = sales.month.orders ? Math.round(sales.month.total / sales.month.orders) : 0;
  const salesChange =
    yesterday && yesterday.total > 0
      ? Math.round(((sales.today.total - yesterday.total) / yesterday.total) * 100)
      : null;
  const ordersChange = yesterday ? sales.today.orders - yesterday.orders : null;
  return (
    <section
      aria-label={t('dashboard.sales')}
      className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4"
    >
      <Figure
        label={t('dashboard.today')}
        value={formatPrice(sales.today.total, locale)}
        change={salesChange === null ? null : `${formatNumber(locale, Math.abs(salesChange))}%`}
        up={(salesChange ?? 0) >= 0}
      />
      <Figure
        label={t('dashboard.ordersToday')}
        value={formatNumber(locale, sales.today.orders)}
        change={ordersChange === null ? null : formatNumber(locale, Math.abs(ordersChange))}
        up={(ordersChange ?? 0) >= 0}
      />
      <Figure
        label={t('dashboard.month')}
        value={formatPrice(sales.month.total, locale)}
        note={t('dashboard.orders', { count: sales.month.orders })}
      />
      <Figure
        label={t('dashboard.average')}
        value={formatPrice(average, locale)}
        note={t('dashboard.thisMonth')}
      />
    </section>
  );
}

function Figure({
  label,
  value,
  change,
  up,
  note,
}: {
  label: string;
  value: string;
  change?: string | null;
  up?: boolean;
  note?: string;
}) {
  const { t } = useLocale();
  return (
    <Card className="flex min-w-0 flex-col gap-2 p-4 md:p-5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="truncate text-xl font-semibold tracking-tight tabular-nums md:text-2xl">
        {value}
      </span>
      {change != null ? (
        <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span aria-hidden className={cn('font-semibold', up ? 'text-success' : 'text-danger')}>
            {up ? '▲' : '▼'} {change}
          </span>
          <span aria-hidden>{t('dashboard.vsYesterday')}</span>
          <span className="sr-only">
            {t('dashboard.vsYesterdaySr', { change: `${up ? '+' : '−'}${change}` })}
          </span>
        </span>
      ) : (
        note && <span className="text-xs text-muted-foreground">{note}</span>
      )}
    </Card>
  );
}

function WeekChart({ days, locale }: { days: Days; locale: Locale }) {
  const { t } = useLocale();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.total), 1);
  const total = days.reduce((sum, d) => sum + d.total, 0);
  const orders = days.reduce((sum, d) => sum + d.orders, 0);
  const day = (date: string, style: 'short' | 'long') =>
    formatDateTime(
      locale,
      new Date(`${date}T12:00:00+06:00`),
      style === 'short' ? { weekday: 'short' } : { weekday: 'long', day: 'numeric', month: 'long' },
    );
  return (
    <CardSection title={t('dashboard.week')}>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">
        {formatPrice(total, locale)}
      </p>
      <p className="text-xs text-muted-foreground">{t('dashboard.weekTotal', { count: orders })}</p>
      {/* The columns are for the eye; the table below is the accessible view. */}
      <div
        aria-hidden
        className="mt-6 flex h-48 items-end gap-2 border-b border-border bg-[linear-gradient(var(--color-border)_1px,transparent_1px)] bg-[length:100%_3rem] md:gap-4"
      >
        {days.map((d, i) => {
          const height = d.total ? Math.max(3, (d.total / max) * 100) : 0;
          const last = i === days.length - 1;
          return (
            <div
              key={d.date}
              className="relative flex h-full flex-1 flex-col items-center justify-end"
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
            >
              <div
                className={cn(
                  'w-full max-w-9 rounded-t bg-primary transition-opacity',
                  active === i || (active === null && last) ? 'opacity-100' : 'opacity-60',
                )}
                style={{ height: `${height}%` }}
              />
              {active === i && (
                <div className="absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md">
                  <p className="font-medium">{day(d.date, 'long')}</p>
                  <p>
                    {formatPrice(d.total, locale)} · {t('dashboard.orders', { count: d.orders })}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div
        aria-hidden
        className="mt-2 flex gap-2 text-center text-xs text-muted-foreground md:gap-4"
      >
        {days.map((d) => (
          <span key={d.date} className="flex-1">
            {day(d.date, 'short')}
          </span>
        ))}
      </div>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary">
          {t('dashboard.asTable')}
        </summary>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('dashboard.week')}</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="p-1 font-medium">
                {t('dashboard.day')}
              </th>
              <th scope="col" className="p-1 font-medium">
                {t('dashboard.ordersColumn')}
              </th>
              <th scope="col" className="p-1 text-right font-medium">
                {t('dashboard.salesColumn')}
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date} className="border-t border-border">
                <td className="p-1">{day(d.date, 'long')}</td>
                <td className="p-1 tabular-nums">{formatNumber(locale, d.orders)}</td>
                <td className="p-1 text-right tabular-nums">{formatPrice(d.total, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </CardSection>
  );
}

function RecentOrders() {
  const { t, locale } = useLocale();
  const recent = useQuery({
    queryKey: ['orders', 'recent'],
    queryFn: () => fetchOrders({}, undefined, 5),
    staleTime: 60_000,
  });
  return (
    <CardSection
      title={t('dashboard.recent')}
      padded={false}
      action={
        <Link to="/orders" className="text-sm font-medium text-primary hover:underline">
          {t('dashboard.viewAll')}
        </Link>
      }
    >
      {recent.isPending && (
        <p role="status" className="px-4 pb-4 md:px-5">
          {t('loading')}
        </p>
      )}
      {recent.isError && (
        <div className="px-4 pb-4 md:px-5">
          <Notice tone="error">{errorMessage(recent.error, t)}</Notice>
        </div>
      )}
      {recent.data?.items.length === 0 && (
        <p className="px-4 pb-5 text-sm text-muted-foreground md:px-5">{t('dashboard.noOrders')}</p>
      )}
      {recent.data && recent.data.items.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {recent.data.items.map((o) => (
            <li key={o.id}>
              <Link
                to="/orders/$id"
                params={{ id: o.id }}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-muted md:grid-cols-[10.5rem_minmax(0,1fr)_auto_7rem] md:px-5"
              >
                <span className="flex flex-col md:order-none">
                  <span className="font-semibold text-primary">{o.displayNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    {dateTime(locale, o.placedAt)}
                  </span>
                </span>
                <span className="col-start-1 row-start-2 flex min-w-0 flex-col md:col-start-auto md:row-start-auto">
                  <span className="truncate font-medium">{o.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {pickText(o.area, locale) || o.phone}
                  </span>
                </span>
                <span className="col-start-2 row-start-2 justify-self-end md:col-start-auto md:row-start-auto md:justify-self-start">
                  <StatusChip kind="order" status={o.status} />
                </span>
                <span className="col-start-2 row-start-1 text-right font-semibold tabular-nums md:col-start-auto md:row-start-auto">
                  {formatPrice(o.total, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardSection>
  );
}

function Waiting({
  counts,
  confirmation,
  incomplete,
}: {
  counts: Dashboard['counts'];
  confirmation: Dashboard['confirmation'];
  incomplete: Dashboard['incomplete'];
}) {
  const { t, locale } = useLocale();
  const row = (
    label: string,
    value: number,
    Icon: LucideIcon,
    tone: string,
    to: {
      to: '/orders' | '/inventory' | '/orders/confirm' | '/orders/incomplete';
      search: Record<string, unknown>;
    },
  ) => (
    <Link
      to={to.to}
      search={to.search as never}
      className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-muted md:px-5"
    >
      <span
        aria-hidden
        className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-lg', tone)}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="flex-1 text-sm">{label}</span>
      <span className="font-semibold tabular-nums">{formatNumber(locale, value)}</span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </Link>
  );
  const nothing =
    counts.awaitingConfirmation +
      counts.toShip +
      counts.lowStock +
      counts.cancelledByShopper7d +
      counts.possibleDuplicates ===
    0;
  return (
    <CardSection title={t('dashboard.waiting')} padded={false}>
      {nothing && (
        <p className="px-4 pb-4 text-sm text-muted-foreground md:px-5">{t('dashboard.allClear')}</p>
      )}
      <ul className="divide-y divide-border border-t border-border">
        {confirmation && (
          <li>
            {row(
              t('queue.tab.to_call'),
              counts.toCall,
              PhoneCall,
              'bg-warning text-warning-foreground',
              { to: '/orders/confirm', search: {} },
            )}
          </li>
        )}
        <li>
          {row(
            t('dashboard.awaiting'),
            counts.awaitingConfirmation,
            Clock,
            'bg-warning text-warning-foreground',
            {
              to: '/orders',
              search: { status: 'pending' },
            },
          )}
        </li>
        <li>
          {row(t('dashboard.toShip'), counts.toShip, Truck, 'bg-info text-info-foreground', {
            to: '/orders',
            search: { status: 'confirmed', deliveryStatus: 'not_shipped' },
          })}
        </li>
        {incomplete && (
          <li>
            {row(t('incomplete.title'), incomplete.open, ShoppingCart, 'bg-muted text-foreground', {
              to: '/orders/incomplete',
              search: {},
            })}
          </li>
        )}
        {counts.possibleDuplicates > 0 && (
          <li>
            {row(
              t('orders.flag.possible_duplicate'),
              counts.possibleDuplicates,
              Copy,
              'bg-warning text-warning-foreground',
              { to: '/orders', search: { flag: 'possible_duplicate' } },
            )}
          </li>
        )}
        <li>
          {row(t('dashboard.lowStock'), counts.lowStock, PackageX, 'bg-danger-soft text-danger', {
            to: '/inventory',
            search: { lowStock: true },
          })}
        </li>
        <li>
          {row(
            t('dashboard.cancelledByShopper'),
            counts.cancelledByShopper7d,
            CircleX,
            'bg-muted text-muted-foreground',
            { to: '/orders', search: { cancelledByShopper: true } },
          )}
        </li>
      </ul>
      {incomplete && incomplete.today > 0 && (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground md:px-5">
          {t('dashboard.incompleteToday', {
            saved: formatNumber(locale, incomplete.today),
            recovered: formatNumber(locale, incomplete.recoveredToday),
          })}
        </p>
      )}
      {confirmation && confirmation.rate !== null && (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground md:px-5">
          {t('dashboard.confirmationRate', {
            rate: formatNumber(locale, confirmation.rate),
            confirmed: formatNumber(locale, confirmation.confirmed),
            decided: formatNumber(locale, confirmation.decided),
          })}
        </p>
      )}
    </CardSection>
  );
}
