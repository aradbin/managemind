// The order list (phase-4-plan §7; ADR 0029, ADR 0033): stage tabs with
// counts, search and filter buttons kept in the URL, rows on phones and a
// table from md that open the order, a ⋯ menu per row, and selection for
// bulk confirm, booking and printing in the selection bar.

import { formatDateTime, formatNumber } from '@managemind/shared/i18n';
import { formatPhone } from '@managemind/shared/phone';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Check, CircleX, FileText, Flag, Plus, Printer, Truck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import {
  FilterButtons,
  type FilterDef,
  RowMenu,
  RowMenuItem,
  RowMenuSeparator,
  SearchInput,
  SelectionBar,
  StageTabs,
  ToolbarSummary,
} from '../components/list-tools';
import { Notice } from '../components/notice';
import { StatusChip } from '../components/order-status';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { ScoreBadge } from '../components/risk';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
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
  orderQuery,
  ordersList,
  pickText,
  withKey,
  zonesQuery,
} from '../lib/orders';
import { usePagedList } from '../lib/paged';
import { CancelDialog } from './order-detail';
import { OrderExportButton } from './order-export';

export type OrderSearch = OrderFilters & { page?: number | undefined };

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
  const [cancelling, setCancelling] = useState<OrderSummary>();

  const setFilter = (patch: Partial<OrderSearch>) =>
    navigate({
      from: '/orders/',
      to: '/orders',
      search: (prev: OrderSearch) =>
        Object.fromEntries(
          // A new filter starts again at page 1.
          Object.entries({ ...prev, page: undefined, ...patch }).filter(
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

  const { page, ...listFilters } = search;
  const orders = usePagedList({
    ...ordersList(listFilters, { counts: true }),
    page,
    // A page is a step back can return to, so it isn't replaced.
    onPageChange: (next) =>
      navigate({
        from: '/orders/',
        to: '/orders',
        search: (prev: OrderSearch) => ({ ...prev, page: next > 1 ? next : undefined }),
      }),
  });
  const zones = useQuery(zonesQuery);
  const items = orders.items;
  const answer = orders.first as
    | { value?: number; counts?: Record<(typeof TABS)[number]['key'], number> }
    | undefined;
  const counts = answer?.counts;

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
      multi: true,
      label: t('order.payment'),
      value: search.paymentStatus,
      options: PAYMENTS.map((s) => ({ value: s, label: t(`paymentStatus.${s}`) })),
      onChange: (v) => setFilter({ paymentStatus: v as OrderSearch['paymentStatus'] }),
    },
    {
      key: 'source',
      multi: true,
      label: t('order.source'),
      value: search.source,
      options: SOURCES.map((s) => ({ value: s, label: t(`source.${s}`) })),
      onChange: (v) => setFilter({ source: v as OrderSearch['source'] }),
    },
    {
      key: 'zone',
      multi: true,
      label: t('orders.zoneFilter'),
      value: search.zoneId,
      options: (zones.data ?? []).map((z) => ({ value: z.id, label: pickText(z.name, locale) })),
      onChange: (v) => setFilter({ zoneId: v }),
    },
    {
      key: 'flag',
      multi: true,
      label: t('orders.flag'),
      value: search.flag,
      options: FLAGS.map((f) => ({ value: f, label: t(`orders.flag.${f}`) })),
      onChange: (v) => setFilter({ flag: v as OrderSearch['flag'] }),
    },
    // Dates come from Home and the reports; the list itself offers none.
    ...(search.from || search.to
      ? [
          dateRangeFilter({
            key: 'placed',
            label: t('order.placedAt'),
            from: search.from,
            to: search.to,
            onChange: setFilter,
            t,
          }),
        ]
      : []),
  ];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));

  const area = (o: OrderSummary) => pickText(o.area, locale);
  const phone = (o: OrderSummary) => formatPhone(o.phone);
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
  const canShip = (o: OrderSummary) =>
    o.status === 'confirmed' || (o.status === 'processing' && o.deliveryStatus === 'not_shipped');

  const columns: Column<OrderSummary>[] = [
    {
      header: t('order.number'),
      cell: (o) => (
        <Link
          to="/orders/$id"
          params={{ id: o.id }}
          className="font-mono font-medium tracking-[0.02em]"
        >
          {o.displayNumber}
        </Link>
      ),
    },
    {
      header: t('order.customer'),
      skeleton: 'lines',
      cell: (o) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{o.name}</span>
            {o.risk.risky && <ScoreBadge risk={o.risk} />}
            <Flags flags={o.flags} />
          </span>
          <span className="truncate text-[13px] text-muted-foreground tabular-nums">
            {phone(o)}
            {area(o) ? ` · ${area(o)}` : ''}
          </span>
        </span>
      ),
    },
    {
      header: t('order.placedAt'),
      skeleton: 'lines',
      cell: (o) => (
        <span className="flex flex-col whitespace-nowrap tabular-nums">
          <span>{placed(o).day}</span>
          <span className="text-xs text-muted-foreground">{placed(o).time}</span>
        </span>
      ),
    },
    {
      header: t('order.status'),
      skeleton: 'badge',
      cell: (o) => <StatusChip kind="order" status={o.status} />,
    },
    {
      header: t('order.payment'),
      skeleton: 'badge',
      cell: (o) => <StatusChip kind="payment" status={o.paymentStatus} />,
    },
    {
      header: t('order.delivery'),
      skeleton: 'badge',
      cell: (o) => <StatusChip kind="delivery" status={o.deliveryStatus} />,
    },
    {
      header: t('order.total'),
      numeric: true,
      cell: (o) => <span className="font-medium">{formatPrice(o.total, locale)}</span>,
    },
  ];

  const ids = [...selected];
  const pendingSelected = items.filter((o) => selected.has(o.id) && o.status === 'pending');
  const shippable = items.filter((o) => selected.has(o.id) && canShip(o));
  const open = (o: OrderSummary) => navigate({ to: '/orders/$id', params: { id: o.id } });
  const print = (ids: string[], doc: 'invoice' | 'slip') =>
    window.open(
      `/print/orders?${new URLSearchParams({ ids: ids.join(','), doc })}`,
      '_blank',
      'noopener',
    );
  const emptyText = filtered
    ? t('orders.noMatches')
    : tab?.key === 'pending'
      ? t('orders.emptyConfirm')
      : tab?.key === 'toShip'
        ? t('orders.emptyShip')
        : t('orders.emptyHere');

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        className="mb-0"
        title={t('nav.orders')}
        actions={
          <>
            <span className="hidden md:contents">
              <OrderExportButton filters={listFilters} selected={ids} />
            </span>
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
        tabs={TABS.map((x) => ({
          key: x.key,
          label: t(x.label),
          count: x.key === 'all' ? counts?.all : counts?.[x.key] || undefined,
        }))}
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
      <div className="flex items-center gap-2 md:flex-wrap">
        <SearchInput
          label={t('orders.search')}
          placeholder={t('orders.searchPhone')}
          value={q}
          onChange={setQ}
          className="min-w-0 flex-1 md:w-[300px] md:flex-none"
        />
        <FilterButtons
          filters={filters}
          width={230}
          onReset={filtered ? reset : undefined}
          showLabel={t('orders.showCount', { count: orders.total })}
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
                <label className="ml-2 hidden cursor-pointer items-center gap-2 font-medium md:inline-flex">
                  <input
                    type="checkbox"
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
        {orders.first && (
          <ToolbarSummary>
            {t('orders.summary', {
              count: formatNumber(locale, orders.total),
              value: formatPrice(answer?.value ?? 0, locale),
            })}
          </ToolbarSummary>
        )}
      </div>
      <DataList
        label={t('nav.orders')}
        items={items}
        rowKey={(o) => o.id}
        columns={columns}
        grid="24px 76px minmax(0,1.7fr) 112px 100px 104px 120px 88px 36px"
        rowHeight={56}
        isPending={orders.isPending}
        error={orders.isError ? errorMessage(orders.error, t) : undefined}
        onRetry={() => orders.refetch()}
        empty={emptyText}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        pager={orders.pager}
        onOpen={open}
        selectOnPhone={false}
        cardClassName="py-3 pr-1 pl-3"
        selection={{
          isSelected: (o) => selected.has(o.id),
          toggle: (o) => toggle(o.id),
          toggleAll: () => setSelected(allSelected ? new Set() : new Set(items.map((o) => o.id))),
          label: (o) => t('orders.select', { number: o.displayNumber }),
        }}
        bar={
          <SelectionBar
            count={selected.size}
            label={t('orders.selectedCount', { count: selected.size })}
            clearText
            onClear={() => setSelected(new Set())}
            actions={[
              ...(canWrite && pendingSelected.length > 0
                ? [
                    {
                      label: t('orders.bulkConfirm', { count: pendingSelected.length }),
                      icon: Check,
                      onClick: () => setConfirming(pendingSelected),
                    },
                  ]
                : []),
              ...(canWrite && shippable.length > 0
                ? [
                    {
                      label: t('couriers.bulk.book'),
                      icon: Truck,
                      onClick: () => setBulkBooking(true),
                    },
                  ]
                : []),
              {
                label: t('print.invoices'),
                icon: Printer,
                disabled: ids.length > 100,
                title: ids.length > 100 ? t('print.tooMany') : undefined,
                onClick: () => print(ids, 'invoice'),
              },
              {
                label: t('print.slips'),
                icon: FileText,
                disabled: ids.length > 100,
                title: ids.length > 100 ? t('print.tooMany') : undefined,
                onClick: () => print(ids, 'slip'),
              },
            ]}
          />
        }
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
            {canWrite && canShip(o) && (
              <RowMenuItem
                onSelect={() => {
                  setSelected(new Set([o.id]));
                  setBulkBooking(true);
                }}
              >
                <Truck aria-hidden />
                {t('orders.bookCourier')}
              </RowMenuItem>
            )}
            <RowMenuItem onSelect={() => print([o.id], 'invoice')}>
              <Printer aria-hidden />
              {t('orders.printInvoice')}
            </RowMenuItem>
            {canWrite && (o.status === 'pending' || o.status === 'confirmed') && (
              <>
                <RowMenuSeparator />
                <RowMenuItem danger onSelect={() => setCancelling(o)}>
                  <CircleX aria-hidden />
                  {t('orders.cancelOrder')}
                </RowMenuItem>
              </>
            )}
          </RowMenu>
        )}
        card={(o) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <Link
                to="/orders/$id"
                params={{ id: o.id }}
                className="font-mono font-semibold tracking-[0.02em]"
              >
                {o.displayNumber}
              </Link>
              <StatusChip kind="order" status={o.status} />
              <span className="ml-auto font-semibold tabular-nums">
                {formatPrice(o.total, locale)}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {o.name}
                {area(o) ? ` · ${area(o)}` : ''}
              </span>
              <StatusChip kind="payment" status={o.paymentStatus} />
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">
              {placed(o).day}, {placed(o).time}
              {o.risk.risky && <ScoreBadge risk={o.risk} />}
              <Flags flags={o.flags} />
            </span>
          </div>
        )}
      />
      {confirming && (
        <BulkConfirmDialog
          orders={confirming}
          onClose={(done) => {
            setConfirming(undefined);
            if (done) setSelected(new Set());
          }}
        />
      )}
      {cancelling && (
        <CancelOrderDialog order={cancelling} onClose={() => setCancelling(undefined)} />
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

/** Cancel from the list: the order's own cancel dialog, once the order has loaded. */
function CancelOrderDialog({ order, onClose }: { order: OrderSummary; onClose: () => void }) {
  const detail = useQuery(orderQuery(order.id));
  const queryClient = useQueryClient();
  if (!detail.data) return null;
  return (
    <CancelDialog
      order={detail.data}
      onClose={() => {
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
        onClose();
      }}
    />
  );
}

/** What staff should look at, as the board marks it: a flag and its words. */
function Flags({ flags }: { flags: readonly string[] }) {
  const { t } = useLocale();
  return (
    <>
      {(['possible_duplicate', 'unreachable'] as const)
        .filter((f) => flags.includes(f))
        .map((f) => (
          <span
            key={f}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap text-warning-foreground"
          >
            <Flag aria-hidden className="size-3" />
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
