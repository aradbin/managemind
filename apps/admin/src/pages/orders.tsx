// The order list (phase-4-plan §7; ADR 0029, ADR 0033): stage tabs with
// counts, search and filter buttons kept in the URL, rows on phones and a
// table from md that open the order, a ⋯ menu per row, and selection for
// bulk confirm, booking and printing in the selection bar.

import { formatDateTime } from '@managemind/shared/i18n';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Check, FileText, Plus, Printer, Search, Truck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import {
  barAction,
  FilterButtons,
  type FilterDef,
  RowMenu,
  RowMenuItem,
  SelectionBar,
  StageTabs,
} from '../components/list-tools';
import { Notice } from '../components/notice';
import { StatusChip } from '../components/order-status';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { ScoreBadge } from '../components/risk';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/orders';
import '../i18n/couriers';
import { BulkBookDialog } from '../components/courier-booking';
// The Returns button's label lives with the returns screens' messages.
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import {
  dashboardQuery,
  dateRangeFilter,
  idempotencyKey,
  type OrderFilters,
  type OrderSummary,
  ordersQuery,
  pickText,
  withKey,
  zonesQuery,
} from '../lib/orders';
import { OrderExportButton } from './order-export';

export type OrderSearch = OrderFilters;

/** The tabs: each sets the order and delivery statuses and keeps every other filter. */
const TABS = [
  { key: 'all', label: 'orders.tabAll', status: undefined, deliveryStatus: undefined },
  { key: 'pending', label: 'dashboard.awaiting', status: 'pending', deliveryStatus: undefined },
  { key: 'toShip', label: 'dashboard.toShip', status: 'confirmed', deliveryStatus: 'not_shipped' },
  { key: 'shipped', label: 'deliveryStatus.shipped', status: undefined, deliveryStatus: 'shipped' },
  {
    key: 'delivered',
    label: 'deliveryStatus.delivered',
    status: undefined,
    deliveryStatus: 'delivered',
  },
  {
    key: 'cancelled',
    label: 'orderStatus.cancelled',
    status: 'cancelled',
    deliveryStatus: undefined,
  },
] as const satisfies readonly {
  key: string;
  label: AdminKey;
  status: OrderSearch['status'];
  deliveryStatus: OrderSearch['deliveryStatus'];
}[];

const PAYMENTS = ['unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded'] as const;
const SOURCES = [
  'website',
  'facebook',
  'messenger',
  'whatsapp',
  'instagram',
  'phone',
  'walk_in',
  'other',
  'exchange',
] as const;
const FLAGS = ['flagged_phone', 'possible_duplicate', 'unreachable'] as const;

export function OrdersPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as OrderSearch;
  const navigate = useNavigate();
  const canWrite = usePermission('orders.write');
  const [q, setQ] = useState(search.q ?? '');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkBooking, setBulkBooking] = useState(false);
  /** The pending orders being confirmed: the selection's, or one row's. */
  const [confirming, setConfirming] = useState<OrderSummary[]>();
  const dashboard = useQuery(dashboardQuery).data;
  const counts = dashboard?.counts;
  const tabCount = (key: string) =>
    key === 'pending'
      ? counts?.awaitingConfirmation
      : key === 'toShip'
        ? counts?.toShip
        : undefined;

  const setFilter = (patch: Partial<OrderSearch>) =>
    navigate({
      from: '/orders/',
      to: '/orders',
      search: (prev: OrderSearch) =>
        Object.fromEntries(
          Object.entries({ ...prev, ...patch }).filter(
            ([, v]) => v !== undefined && v !== '' && v !== false,
          ),
        ) as OrderSearch,
      replace: true,
    });

  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? '') !== q.trim()) setFilter({ q: q.trim() || undefined });
    }, 350);
    return () => clearTimeout(id);
  });

  const orders = useInfiniteQuery(ordersQuery(search));
  const zones = useQuery(zonesQuery);
  const items = useMemo(() => orders.data?.pages.flatMap((p) => p.items) ?? [], [orders.data]);

  const tab = TABS.find(
    (x) => x.status === search.status && x.deliveryStatus === search.deliveryStatus,
  );
  // A stage no tab shows (a link from Home, say) reads as a filter that can be removed.
  const odd = tab
    ? []
    : [
        ...(search.status ? [t(`orderStatus.${search.status}`)] : []),
        ...(search.deliveryStatus ? [t(`deliveryStatus.${search.deliveryStatus}`)] : []),
      ];
  const filtered = Boolean(
    search.q ||
      search.paymentStatus ||
      search.source ||
      search.zoneId ||
      search.flag ||
      search.from ||
      search.to ||
      search.cancelledByShopper ||
      search.tag,
  );
  const reset = () => {
    setQ('');
    setFilter({
      q: undefined,
      paymentStatus: undefined,
      source: undefined,
      zoneId: undefined,
      flag: undefined,
      from: undefined,
      to: undefined,
      cancelledByShopper: undefined,
      tag: undefined,
    });
  };

  const filters: FilterDef[] = [
    {
      key: 'payment',
      label: t('order.payment'),
      value: search.paymentStatus,
      options: PAYMENTS.map((s) => ({ value: s, label: t(`paymentStatus.${s}`) })),
      onChange: (v) => setFilter({ paymentStatus: v as OrderSearch['paymentStatus'] }),
    },
    {
      key: 'source',
      label: t('order.source'),
      value: search.source,
      options: SOURCES.map((s) => ({ value: s, label: t(`source.${s}`) })),
      onChange: (v) => setFilter({ source: v as OrderSearch['source'] }),
    },
    {
      key: 'zone',
      label: t('order.zone'),
      value: search.zoneId,
      options: (zones.data ?? []).map((z) => ({ value: z.id, label: pickText(z.name, locale) })),
      onChange: (v) => setFilter({ zoneId: v }),
    },
    {
      key: 'flag',
      label: t('orders.flag'),
      value: search.flag,
      options: FLAGS.map((f) => ({ value: f, label: t(`orders.flag.${f}`) })),
      onChange: (v) => setFilter({ flag: v as OrderSearch['flag'] }),
    },
    dateRangeFilter({
      key: 'placed',
      label: t('order.placedAt'),
      from: search.from,
      to: search.to,
      onChange: setFilter,
      t,
    }),
  ];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));

  const showProfit = items.some((o) => o.grossProfit !== undefined);
  const profitText = (o: OrderSummary) =>
    o.grossProfit == null ? (
      '—'
    ) : (
      <>
        {formatPrice(o.grossProfit, locale)}
        {o.missingCostUnits ? (
          <span title={t('orders.profitNoCost')}>
            <span aria-hidden> *</span>
            <span className="sr-only">{t('orders.profitNoCost')}</span>
          </span>
        ) : null}
      </>
    );
  const area = (o: OrderSummary) => pickText(o.area, locale);
  const placed = (o: OrderSummary) => {
    const at = new Date(o.placedAt);
    return {
      // Day first, as everywhere in the admin (design rule 11): "29 Oct".
      day: new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
        day: 'numeric',
        month: 'short',
      }).format(at),
      time: formatDateTime(locale, at, { timeStyle: 'short' }),
    };
  };

  const columns: Column<OrderSummary>[] = [
    {
      header: t('order.number'),
      cell: (o) => (
        <span className="flex flex-col items-start">
          <Link
            to="/orders/$id"
            params={{ id: o.id }}
            className="font-mono font-medium underline-offset-2 hover:underline"
          >
            {o.displayNumber}
          </Link>
          {o.cancelledBy === 'shopper' && (
            <span className="text-xs text-danger">{t('orders.cancelledByShopper')}</span>
          )}
        </span>
      ),
    },
    {
      header: t('order.customer'),
      cell: (o) => (
        <span className="flex flex-col items-start gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{o.name}</span>
            {o.risk.risky && <ScoreBadge risk={o.risk} className="h-5 px-1.5" />}
            <FlagChips flags={o.flags} />
          </span>
          <span className="text-xs text-muted-foreground">
            {o.phone}
            {area(o) ? ` · ${area(o)}` : ''}
          </span>
        </span>
      ),
    },
    {
      header: t('order.placedAt'),
      cell: (o) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>{placed(o).day}</span>
          <span className="text-xs text-muted-foreground">{placed(o).time}</span>
        </span>
      ),
    },
    { header: t('order.status'), cell: (o) => <StatusChip kind="order" status={o.status} /> },
    {
      header: t('order.payment'),
      cell: (o) => <StatusChip kind="payment" status={o.paymentStatus} />,
    },
    {
      header: t('order.delivery'),
      cell: (o) => <StatusChip kind="delivery" status={o.deliveryStatus} />,
    },
    { header: t('order.total'), numeric: true, cell: (o) => formatPrice(o.total, locale) },
    // Gross profit for cost holders (phase-8-plan §3.8): the server leaves it out otherwise.
    ...(showProfit
      ? [
          {
            header: t('orders.col.profit'),
            numeric: true,
            wide: true,
            cell: (o: OrderSummary) => profitText(o),
          },
        ]
      : []),
  ];

  const ids = [...selected];
  const pendingSelected = items.filter((o) => selected.has(o.id) && o.status === 'pending');
  const open = (o: OrderSummary) => navigate({ to: '/orders/$id', params: { id: o.id } });
  const print = (ids: string[], doc: 'invoice' | 'slip') =>
    window.open(
      `/print/orders?${new URLSearchParams({ ids: ids.join(','), doc })}`,
      '_blank',
      'noopener',
    );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t('nav.orders')}
        actions={
          <>
            <div className="hidden md:flex">
              <OrderExportButton filters={search} selected={ids} />
            </div>
            {canWrite && (
              <Button asChild>
                <Link to="/orders/new">
                  <Plus aria-hidden />
                  <span className="md:hidden">{t('orders.newShort')}</span>
                  <span className="sr-only md:not-sr-only">{t('orders.new')}</span>
                </Link>
              </Button>
            )}
          </>
        }
      />
      <StageTabs
        label={t('order.status')}
        tabs={TABS.map((x) => ({ key: x.key, label: t(x.label), count: tabCount(x.key) }))}
        value={tab?.key}
        onChange={(key) => {
          const next = TABS.find((x) => x.key === key);
          setFilter({
            status: next?.status,
            deliveryStatus: next?.deliveryStatus,
            ...(key === 'cancelled' ? {} : { cancelledByShopper: undefined }),
          });
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48 md:w-64 md:flex-none">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            className="pl-9"
            aria-label={t('orders.search')}
            placeholder={t('orders.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <FilterButtons
          filters={filters}
          onReset={filtered ? reset : undefined}
          extra={
            <>
              {odd.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => setFilter({ status: undefined, deliveryStatus: undefined })}
                >
                  {t('orders.statusFilter', { status: odd.join(', ') })}
                  <X aria-hidden />
                </Button>
              )}
              {search.tag && (
                <Button variant="secondary" onClick={() => setFilter({ tag: undefined })}>
                  {t('orders.tagFilter', { tag: search.tag })}
                  <X aria-hidden />
                </Button>
              )}
              {(tab?.key === 'cancelled' || search.cancelledByShopper) && (
                <label className="flex min-h-9 items-center gap-2 px-1 text-sm md:min-h-8">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={Boolean(search.cancelledByShopper)}
                    onChange={(e) =>
                      setFilter({ cancelledByShopper: e.target.checked || undefined })
                    }
                  />
                  {t('orders.cancelledByShopper')}
                </label>
              )}
            </>
          }
        />
      </div>
      <DataList
        label={t('nav.orders')}
        summary={t('list.shown', { count: items.length })}
        items={items}
        rowKey={(o) => o.id}
        columns={columns}
        isPending={orders.isPending}
        error={orders.isError ? errorMessage(orders.error, t) : undefined}
        onRetry={() => orders.refetch()}
        empty={
          filtered || search.status || search.deliveryStatus
            ? t('orders.noMatches')
            : t('orders.empty')
        }
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        hasMore={orders.hasNextPage}
        loadingMore={orders.isFetchingNextPage}
        onLoadMore={() => orders.fetchNextPage()}
        onOpen={open}
        selection={{
          isSelected: (o) => selected.has(o.id),
          toggle: (o) => toggle(o.id),
          toggleAll: () => setSelected(allSelected ? new Set() : new Set(items.map((o) => o.id))),
          label: (o) => t('orders.select', { number: o.displayNumber }),
        }}
        menu={(o) => (
          <RowMenu label={o.displayNumber}>
            <RowMenuItem onSelect={() => open(o)}>
              <FileText aria-hidden />
              {t('list.open')}
            </RowMenuItem>
            {canWrite && o.status === 'pending' && (
              <RowMenuItem onSelect={() => setConfirming([o])}>
                <Check aria-hidden />
                {t('order.confirm')}
              </RowMenuItem>
            )}
            <RowMenuItem onSelect={() => print([o.id], 'invoice')}>
              <Printer aria-hidden />
              {t('orders.printInvoice')}
            </RowMenuItem>
            <RowMenuItem onSelect={() => print([o.id], 'slip')}>
              <Printer aria-hidden />
              {t('orders.printSlip')}
            </RowMenuItem>
          </RowMenu>
        )}
        card={(o) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <Link to="/orders/$id" params={{ id: o.id }} className="font-mono font-medium">
                  {o.displayNumber}
                </Link>
                <StatusChip kind="order" status={o.status} />
              </span>
              <span className="truncate text-sm">
                {o.name}
                {area(o) ? ` · ${area(o)}` : ''}
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {placed(o).day}, {placed(o).time}
                {o.risk.risky && <ScoreBadge risk={o.risk} className="h-5 px-1.5" />}
                <FlagChips flags={o.flags} />
              </span>
            </div>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="font-medium tabular-nums">{formatPrice(o.total, locale)}</span>
              <StatusChip kind="payment" status={o.paymentStatus} />
              {showProfit && o.grossProfit != null && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t('orders.col.profit')} {profitText(o)}
                </span>
              )}
            </span>
          </div>
        )}
      />
      <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        {canWrite && pendingSelected.length > 0 && (
          <button
            type="button"
            className={barAction}
            onClick={() => setConfirming(pendingSelected)}
          >
            <Check aria-hidden />
            {t('orders.bulkConfirm', { count: pendingSelected.length })}
          </button>
        )}
        {canWrite && (
          <button type="button" className={barAction} onClick={() => setBulkBooking(true)}>
            <Truck aria-hidden />
            {t('couriers.bulk.book')}
          </button>
        )}
        {(['invoice', 'slip'] as const).map((doc) => (
          <button
            key={doc}
            type="button"
            className={barAction}
            disabled={ids.length > 100}
            title={ids.length > 100 ? t('print.tooMany') : undefined}
            onClick={() => print(ids, doc)}
          >
            <Printer aria-hidden />
            {t(doc === 'invoice' ? 'print.invoices' : 'print.slips')}
          </button>
        ))}
      </SelectionBar>
      {confirming && (
        <BulkConfirmDialog
          orders={confirming}
          onClose={(done) => {
            setConfirming(undefined);
            if (done) setSelected(new Set());
          }}
        />
      )}
      {bulkBooking && (
        <BulkBookDialog
          orderIds={ids}
          onClose={() => {
            setBulkBooking(false);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

/** What staff should look at: a possible duplicate, an order nobody answered for. */
function FlagChips({ flags }: { flags: readonly string[] }) {
  const { t } = useLocale();
  return (
    <>
      {(['possible_duplicate', 'unreachable'] as const)
        .filter((f) => flags.includes(f))
        .map((f) => (
          <span
            key={f}
            className="inline-flex h-[22px] items-center whitespace-nowrap rounded-md bg-warning px-2 text-xs font-medium text-warning-foreground"
          >
            {t(`orders.flag.${f}`)}
          </span>
        ))}
    </>
  );
}

/** Invoices or packing slips of the selected orders, one per page, in a new tab. */
export function PrintLinks({ ids }: { ids: string[] }) {
  const { t } = useLocale();
  const tooMany = ids.length > 100;
  return (
    <>
      {(['invoice', 'slip'] as const).map((doc) => (
        <Button key={doc} variant="secondary" asChild={!tooMany} disabled={tooMany}>
          {tooMany ? (
            t(doc === 'invoice' ? 'print.invoices' : 'print.slips')
          ) : (
            <Link to="/print/orders" search={{ ids: ids.join(','), doc }} target="_blank">
              <Printer aria-hidden className="size-4" />
              {t(doc === 'invoice' ? 'print.invoices' : 'print.slips')}
            </Link>
          )}
        </Button>
      ))}
      {tooMany && <span className="text-sm text-muted-foreground">{t('print.tooMany')}</span>}
    </>
  );
}

/** Confirms pending orders one at a time, so one refusal doesn't stop the rest. */
function BulkConfirmDialog({
  orders,
  onClose,
}: {
  orders: OrderSummary[];
  onClose: (done: boolean) => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [keys] = useState(() => new Map(orders.map((o) => [o.id, idempotencyKey()])));
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setFailed([]);
    const misses: string[] = [];
    let ok = 0;
    for (const o of orders) {
      try {
        unwrap(
          await api.POST('/v1/admin/orders/{id}/confirm', {
            params: { path: { id: o.id }, ...withKey(keys.get(o.id) as string).params },
          }),
        );
        ok += 1;
        setDone(ok);
      } catch {
        misses.push(o.displayNumber);
      }
    }
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    setRunning(false);
    if (misses.length) setFailed(misses);
    else {
      toast(t('orders.bulkConfirmed', { count: ok }));
      onClose(true);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !running && onClose(done > 0)}
      title={t('orders.bulkConfirmTitle', { count: orders.length })}
    >
      <p>{orders.map((o) => o.displayNumber).join(', ')}</p>
      {running && <p role="status">{t('orders.bulkProgress', { done, count: orders.length })}</p>}
      {failed.length > 0 && (
        <Notice tone="error">{t('orders.bulkFailed', { numbers: failed.join(', ') })}</Notice>
      )}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button variant="ghost" disabled={running} onClick={() => onClose(done > 0)}>
          {t('action.close')}
        </Button>
        <Button disabled={running} onClick={run}>
          {t('order.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
