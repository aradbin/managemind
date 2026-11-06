// The home dashboard (phase-4-plan §3.17), as the canvas draws it (ADR 0034).
// From top to bottom: a greeting, the setup checklist and plan limits while
// they matter, four figures (reports.read), then two columns: the last 7 days
// as bars (each bar names its day and amount; a table view shows the same)
// and the latest orders on the left, what is waiting and this month's profit
// (catalog.cost) on the right. Phones stack them with what is waiting first.
import { formatDateTime, formatNumber, type Locale } from '@managemind/shared/i18n';
import { formatPhone } from '@managemind/shared/phone';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ChartLine,
  ChevronRight,
  CircleX,
  Clock,
  Copy,
  type LucideIcon,
  Package,
  PackageCheck,
  PackageX,
  PhoneCall,
  Plus,
  ShoppingCart,
  Truck,
  Undo2,
} from 'lucide-react';
import { useState } from 'react';
import { BarChart, niceMax } from '../components/bar-chart';
import { Notice } from '../components/notice';
import { StatusChip } from '../components/order-status';
import { usePermission } from '../components/permission-gate';
import { SetupCard } from '../components/setup-card';
import { type Tone, tones } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardFrame, cardPadded, cardTitle } from '../components/ui/card';
import { UsageCard } from '../components/usage-card';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/couriers';
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

/** A card's ghost action at the top right, as drawn: 28 px, pulled into the padding. */
const cardAction = '-mr-2 h-7 px-2 md:h-7';

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
  const d = data.data;

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-[13px] text-muted-foreground">
            {formatDateTime(locale, now, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.02em]">{t(greeting)}</h1>
        </div>
        {/* Phones reach both from the header's Create and the Menu, as drawn. */}
        <div className="flex gap-2 max-md:hidden">
          {canReports && (
            <Button variant="secondary" asChild>
              <Link to="/reports">
                <ChartLine aria-hidden />
                {t('dashboard.reports')}
              </Link>
            </Button>
          )}
          {canWrite && (
            <Button asChild>
              <Link to="/orders/new">
                <Plus aria-hidden />
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
      {d && (
        <>
          {d.sales && (
            <Figures sales={d.sales} toConfirm={d.counts.awaitingConfirmation} locale={locale} />
          )}
          <div className="flex flex-col gap-3 md:gap-4 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
            <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
              {d.sales && (
                <div className="max-lg:order-2">
                  <WeekChart days={d.sales.days} locale={locale} />
                </div>
              )}
              {canOrders && (
                <div className="max-lg:order-4">
                  <RecentOrders />
                </div>
              )}
            </div>
            <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
              <div className="max-lg:order-1">
                <Waiting
                  counts={d.counts}
                  confirmation={d.confirmation}
                  incomplete={d.incomplete}
                />
              </div>
              {d.profit && (
                <div className="max-lg:order-3">
                  <Profit profit={d.profit} locale={locale} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The four figures (.mm-figs): today, orders today, this month, the average order. */
function Figures({
  sales,
  toConfirm,
  locale,
}: {
  sales: NonNullable<Dashboard['sales']>;
  toConfirm: number;
  locale: Locale;
}) {
  const { t } = useLocale();
  const yesterday = sales.days.at(-2);
  // In whole taka, as drawn: "৳2,615", not "৳2,614.83".
  const average = sales.month.orders
    ? Math.round(sales.month.total / sales.month.orders / 100) * 100
    : null;
  const change =
    yesterday && yesterday.total > 0
      ? Math.round(((sales.today.total - yesterday.total) / yesterday.total) * 100)
      : null;
  const figures: { label: string; value: string; note?: string; tone?: 'up' | 'down' }[] = [
    {
      label: t('dashboard.today'),
      value: formatPrice(sales.today.total, locale),
      ...(sales.today.orders === 0
        ? { note: t('dashboard.noSalesToday') }
        : change !== null
          ? {
              note: t('dashboard.vsYesterdayChange', {
                change: `${change >= 0 ? '+' : '−'}${formatNumber(locale, Math.abs(change))}%`,
              }),
              tone: change >= 0 ? ('up' as const) : ('down' as const),
            }
          : {}),
    },
    {
      label: t('dashboard.ordersToday'),
      value: formatNumber(locale, sales.today.orders),
      ...(toConfirm ? { note: t('dashboard.stillToConfirm', { count: toConfirm }) } : {}),
    },
    {
      label: t('dashboard.month'),
      value: formatPrice(sales.month.total, locale),
      note: t('dashboard.orders', { count: sales.month.orders }),
    },
    {
      label: t('dashboard.average'),
      value: average === null ? '—' : formatPrice(average, locale),
      note: t('dashboard.thisMonth'),
    },
  ];
  return (
    <dl
      aria-label={t('dashboard.sales')}
      className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3"
    >
      {figures.map((f) => (
        <div
          key={f.label}
          className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card px-3.5 py-3 md:p-4"
        >
          <dt className="text-[13px] font-medium text-muted-foreground">{f.label}</dt>
          <dd className="truncate text-lg leading-6 font-semibold tracking-[-0.01em] tabular-nums md:text-[22px] md:leading-7">
            {f.value}
          </dd>
          {f.note && (
            <dd
              className={cn(
                'text-xs leading-4 font-medium',
                f.tone === 'up'
                  ? 'text-success-foreground'
                  : f.tone === 'down'
                    ? 'text-danger'
                    : 'text-muted-foreground',
              )}
            >
              {f.note}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/** This month's profit so far, for cost holders (phase-8-plan §3.12). */
function Profit({ profit, locale }: { profit: NonNullable<Dashboard['profit']>; locale: Locale }) {
  const { t } = useLocale();
  const rows = [
    {
      label: t('dashboard.profit.gross'),
      value: profit.grossProfit,
      note: profit.missingCostUnits
        ? t('dashboard.profit.missing', { count: formatNumber(locale, profit.missingCostUnits) })
        : undefined,
    },
    { label: t('dashboard.profit.expenses'), value: profit.expenses },
    { label: t('dashboard.profit.net'), value: profit.netProfit },
  ];
  return (
    <section aria-labelledby="dashboard-profit" className={cn(cardPadded, 'gap-3 md:gap-3')}>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <h2 id="dashboard-profit" className={cardTitle}>
          {t('dashboard.profit.title')}
        </h2>
        <Button variant="ghost" asChild className={cardAction}>
          <Link to="/reports/profit">
            {t('dashboard.profit.open')}
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </div>
      <dl className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap justify-between gap-x-3 tabular-nums">
            <dt>{r.label}</dt>
            <dd className="font-semibold">{formatPrice(r.value, locale)}</dd>
            {r.note && <dd className="w-full text-xs text-warning-foreground">{r.note}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

function WeekChart({ days, locale }: { days: Days; locale: Locale }) {
  const { t } = useLocale();
  const [asTable, setAsTable] = useState(false);
  const orders = days.reduce((sum, d) => sum + d.orders, 0);
  const none = days.every((d) => !d.orders && !d.total);
  const date = (iso: string) => new Date(`${iso}T12:00:00+06:00`);
  const today = days.at(-1)?.date;
  const weekday = (iso: string) => formatDateTime(locale, date(iso), { weekday: 'short' });
  const short = (iso: string) =>
    formatDateTime(locale, date(iso), { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <section aria-labelledby="dashboard-week" className={cn(cardPadded, 'gap-3.5 md:gap-3.5')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="dashboard-week" className={cardTitle}>
            {t('dashboard.week')}
          </h2>
          <span className="text-xs text-muted-foreground">
            {t('dashboard.weekTotal', { count: orders })}
          </span>
        </div>
        {!none && (
          <Button variant="ghost" className={cardAction} onClick={() => setAsTable(!asTable)}>
            {t(asTable ? 'dashboard.asChart' : 'dashboard.asTable')}
          </Button>
        )}
      </div>
      {none ? (
        <p className="text-muted-foreground">{t('dashboard.noSales')}</p>
      ) : asTable ? (
        <div className="-mx-4 overflow-x-auto md:-mx-5">
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <caption className="sr-only">{t('dashboard.week')}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="h-9 border-t border-border bg-muted px-3 pl-4 text-left font-medium text-muted-foreground md:pl-5"
                >
                  {t('dashboard.day')}
                </th>
                <th
                  scope="col"
                  className="h-9 border-t border-border bg-muted px-3 text-right font-medium text-muted-foreground"
                >
                  {t('dashboard.ordersColumn')}
                </th>
                <th
                  scope="col"
                  className="h-9 border-t border-border bg-muted px-3 pr-4 text-right font-medium text-muted-foreground md:pr-5"
                >
                  {t('dashboard.salesColumn')}
                </th>
              </tr>
            </thead>
            <tbody>
              {days
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d.date} className="border-t border-border">
                    <td className="h-10 px-3 pl-4 md:pl-5">
                      {d.date === today ? t('dashboard.todayShort') : short(d.date)}
                    </td>
                    <td className="h-10 px-3 text-right">{formatNumber(locale, d.orders)}</td>
                    <td className="h-10 px-3 pr-4 text-right font-medium md:pr-5">
                      {formatPrice(d.total, locale)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <BarChart
          narrow
          label={t('dashboard.week')}
          top={niceMax(Math.max(...days.map((d) => d.total)))}
          steps={2}
          height={180}
          bars={days.map((d) => ({
            key: d.date,
            value: d.total,
            label: d.date === today ? t('dashboard.todayShort') : weekday(d.date),
            tip: `${short(d.date)}: ${formatPrice(d.total, locale)} · ${t('dashboard.orderCount', { count: d.orders })}`,
          }))}
        />
      )}
    </section>
  );
}

function RecentOrders() {
  const { t, locale } = useLocale();
  const recent = useQuery({
    queryKey: ['orders', 'recent'],
    queryFn: () => fetchOrders({}, undefined, 6),
    staleTime: 60_000,
  });
  const has = Boolean(recent.data?.items.length);
  return (
    <section
      aria-labelledby="dashboard-recent"
      className={cn(cardFrame, 'flex flex-col gap-2 pt-4 pb-2 md:pt-5')}
    >
      <div className="flex min-h-5 items-center justify-between gap-3 px-4 md:px-5">
        <h2 id="dashboard-recent" className={cardTitle}>
          {t('dashboard.recent')}
        </h2>
        {has && (
          <Button variant="ghost" asChild className={cardAction}>
            <Link to="/orders">
              {t('dashboard.viewAll')}
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        )}
      </div>
      {recent.isPending && (
        <p role="status" className="px-4 pb-3 md:px-5">
          {t('loading')}
        </p>
      )}
      {recent.isError && (
        <div className="px-4 pb-3 md:px-5">
          <Notice tone="error">{errorMessage(recent.error, t)}</Notice>
        </div>
      )}
      {recent.data && !has && (
        <p className="px-4 pb-3 text-muted-foreground md:px-5">{t('dashboard.noOrders')}</p>
      )}
      {has && (
        <ul>
          {recent.data?.items.map((o) => (
            <li key={o.id}>
              <Link
                to="/orders/$id"
                params={{ id: o.id }}
                className="flex min-h-14 items-center gap-3 border-t border-border px-4 hover:bg-muted/50 md:px-5"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="font-mono font-semibold tracking-[0.02em]">
                      {o.displayNumber}
                    </span>
                    <span className="truncate font-medium">{o.name}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {pickText(o.area, locale) || formatPhone(o.phone)} ·{' '}
                    {dateTime(locale, o.placedAt)}
                  </span>
                </span>
                <StatusChip kind="order" status={o.status} />
                <span className="w-[72px] text-right font-medium tabular-nums">
                  {formatPrice(o.total, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type WaitingRow = {
  label: string;
  count: number;
  Icon: LucideIcon;
  tone: Tone;
  to:
    | '/orders'
    | '/inventory'
    | '/orders/confirm'
    | '/orders/incomplete'
    | '/orders/courier-returns';
  search: Record<string, unknown>;
};

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
  // The board's order; only what has something waiting is listed.
  const rows = (
    [
      confirmation && {
        label: t('queue.tab.to_call'),
        count: counts.toCall,
        Icon: PhoneCall,
        tone: 'waiting',
        to: '/orders/confirm',
        search: {},
      },
      {
        label: t('dashboard.awaiting'),
        count: counts.awaitingConfirmation,
        Icon: Clock,
        tone: 'waiting',
        to: '/orders',
        search: { status: 'pending' },
      },
      {
        label: t('dashboard.toShip'),
        count: counts.toShip,
        Icon: Truck,
        tone: 'progress',
        to: '/orders',
        search: { status: 'confirmed', deliveryStatus: 'not_shipped' },
      },
      incomplete && {
        label: t('dashboard.incompleteCheckouts'),
        count: incomplete.open,
        Icon: ShoppingCart,
        tone: 'plain',
        to: '/orders/incomplete',
        search: {},
      },
      {
        label: t('orders.flag.possible_duplicate'),
        count: counts.possibleDuplicates,
        Icon: Copy,
        tone: 'waiting',
        to: '/orders',
        search: { flag: 'possible_duplicate' },
      },
      {
        label: t('couriers.dash.booked'),
        count: counts.booked,
        Icon: Package,
        tone: 'progress',
        to: '/orders',
        search: { status: 'processing' },
      },
      {
        label: t('couriers.dash.inTransit'),
        count: counts.inTransit,
        Icon: Truck,
        tone: 'moving',
        to: '/orders',
        search: { deliveryStatus: 'shipped' },
      },
      {
        label: t('couriers.dash.returning'),
        count: counts.returning,
        Icon: Undo2,
        tone: 'bad',
        to: '/orders',
        search: { deliveryStatus: 'failed' },
      },
      {
        label: t('couriers.returns.title'),
        count: counts.courierReturns,
        Icon: PackageCheck,
        tone: 'waiting',
        to: '/orders/courier-returns',
        search: {},
      },
      {
        label: t('dashboard.lowStock'),
        count: counts.lowStock,
        Icon: PackageX,
        tone: 'bad',
        to: '/inventory',
        search: { lowStock: true },
      },
      {
        label: t('dashboard.cancelledByShopper'),
        count: counts.cancelledByShopper7d,
        Icon: CircleX,
        tone: 'plain',
        to: '/orders',
        search: { cancelledByShopper: true },
      },
    ] as (WaitingRow | null | undefined | false)[]
  ).filter((r): r is WaitingRow => Boolean(r) && (r as WaitingRow).count > 0);
  const notes = [
    incomplete &&
      incomplete.today > 0 &&
      t('dashboard.incompleteToday', {
        saved: formatNumber(locale, incomplete.today),
        recovered: formatNumber(locale, incomplete.recoveredToday),
      }),
    confirmation &&
      confirmation.rate !== null &&
      t('dashboard.confirmationRate', {
        rate: formatNumber(locale, confirmation.rate),
        confirmed: formatNumber(locale, confirmation.confirmed),
        decided: formatNumber(locale, confirmation.decided),
      }),
  ].filter((n): n is string => Boolean(n));
  return (
    <section
      aria-labelledby="dashboard-waiting"
      className={cn(cardFrame, 'flex flex-col gap-2 pt-4 md:pt-5')}
    >
      <h2 id="dashboard-waiting" className={cn(cardTitle, 'px-4 md:px-5')}>
        {t('dashboard.waiting')}
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-muted-foreground md:px-5 md:pb-5">{t('dashboard.allClear')}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.label}>
              <Link
                to={r.to}
                search={r.search as never}
                aria-label={`${r.label}: ${formatNumber(locale, r.count)}`}
                className="flex min-h-12 items-center gap-3 border-t border-border pr-3 pl-4 hover:bg-muted/50 md:pl-5"
              >
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-7 shrink-0 items-center justify-center rounded-lg',
                    tones[r.tone],
                  )}
                >
                  <r.Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="font-semibold tabular-nums">{formatNumber(locale, r.count)}</span>
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && notes.length > 0 && (
        <div className="-mt-2 flex flex-col gap-1 border-t border-border px-4 pt-3 pb-4 md:px-5">
          {notes.map((n) => (
            <p key={n} className="text-xs text-muted-foreground">
              {n}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
