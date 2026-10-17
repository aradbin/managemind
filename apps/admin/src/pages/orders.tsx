// The order list (phase-4-plan §7): filters kept in the URL, cards on phones
// and a table from md, and selection for bulk confirm, printing and export.
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { StatusChip } from '../components/order-status';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import {
  dateTime,
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

const selectClass =
  'min-h-11 rounded-md border border-border bg-background px-3 text-base md:text-sm';

const STATUSES = ['pending', 'confirmed', 'processing', 'completed', 'cancelled'] as const;
const PAYMENTS = ['unpaid', 'partially_paid', 'paid'] as const;
const DELIVERIES = ['not_shipped', 'partially_shipped', 'shipped', 'delivered', 'failed'] as const;
const SOURCES = ['website', 'facebook', 'phone', 'walk_in', 'other'] as const;

export function OrdersPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as OrderSearch;
  const navigate = useNavigate();
  const canWrite = usePermission('orders.write');
  const [q, setQ] = useState(search.q ?? '');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

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
  const filtered = Object.keys(search).length > 0;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));

  const columns: Column<OrderSummary>[] = [
    {
      header: t('order.number'),
      cell: (o) => (
        <span className="flex items-center gap-3">
          <input
            type="checkbox"
            className="size-5 shrink-0"
            aria-label={t('orders.select', { number: o.displayNumber })}
            checked={selected.has(o.id)}
            onChange={() => toggle(o.id)}
          />
          <Link
            to="/orders/$id"
            params={{ id: o.id }}
            className="font-medium underline-offset-2 hover:underline"
          >
            {o.displayNumber}
          </Link>
          {o.cancelledBy === 'shopper' && (
            <span className="text-xs text-danger">{t('orders.cancelledByShopper')}</span>
          )}
        </span>
      ),
    },
    { header: t('order.placedAt'), cell: (o) => dateTime(locale, o.placedAt) },
    {
      header: t('order.customer'),
      cell: (o) => (
        <span className="flex flex-col">
          <span>{o.name}</span>
          <span className="text-xs text-muted-foreground">{o.phone}</span>
        </span>
      ),
    },
    {
      header: t('order.status'),
      cell: (o) => (
        <span className="flex flex-wrap gap-1">
          <StatusChip kind="order" status={o.status} />
          <StatusChip kind="payment" status={o.paymentStatus} />
          <StatusChip kind="delivery" status={o.deliveryStatus} />
        </span>
      ),
    },
    { header: t('order.area'), cell: (o) => pickText(o.area, locale) || '—' },
    { header: t('order.total'), cell: (o) => formatPrice(o.total, locale) },
    { header: t('order.source'), cell: (o) => t(`source.${o.source}` as AdminKey) },
  ];

  const ids = [...selected];
  const pendingSelected = items.filter((o) => selected.has(o.id) && o.status === 'pending');

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('nav.orders')}
        actions={
          <>
            <OrderExportButton filters={search} selected={ids} />
            {canWrite && (
              <Button asChild>
                <Link to="/orders/new">
                  <Plus aria-hidden className="size-4" />
                  {t('orders.new')}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid gap-2 md:grid-cols-4 md:items-end">
        <Input
          type="search"
          className="md:col-span-4"
          aria-label={t('orders.search')}
          placeholder={t('orders.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label={t('order.status')}
          className={selectClass}
          value={search.status ?? ''}
          onChange={(e) =>
            setFilter({ status: (e.target.value || undefined) as OrderSearch['status'] })
          }
        >
          <option value="">{t('orders.allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`orderStatus.${s}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('order.payment')}
          className={selectClass}
          value={search.paymentStatus ?? ''}
          onChange={(e) =>
            setFilter({
              paymentStatus: (e.target.value || undefined) as OrderSearch['paymentStatus'],
            })
          }
        >
          <option value="">{t('orders.allPayments')}</option>
          {PAYMENTS.map((s) => (
            <option key={s} value={s}>
              {t(`paymentStatus.${s}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('order.delivery')}
          className={selectClass}
          value={search.deliveryStatus ?? ''}
          onChange={(e) =>
            setFilter({
              deliveryStatus: (e.target.value || undefined) as OrderSearch['deliveryStatus'],
            })
          }
        >
          <option value="">{t('orders.allDeliveries')}</option>
          {DELIVERIES.map((s) => (
            <option key={s} value={s}>
              {t(`deliveryStatus.${s}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('order.source')}
          className={selectClass}
          value={search.source ?? ''}
          onChange={(e) =>
            setFilter({ source: (e.target.value || undefined) as OrderSearch['source'] })
          }
        >
          <option value="">{t('orders.allSources')}</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`source.${s}`)}
            </option>
          ))}
        </select>
        {zones.data && zones.data.length > 0 && (
          <select
            aria-label={t('order.zone')}
            className={selectClass}
            value={search.zoneId ?? ''}
            onChange={(e) => setFilter({ zoneId: e.target.value || undefined })}
          >
            <option value="">{t('orders.allZones')}</option>
            {zones.data.map((z) => (
              <option key={z.id} value={z.id}>
                {pickText(z.name, locale)}
              </option>
            ))}
          </select>
        )}
        <Field
          label={t('orders.from')}
          type="date"
          value={search.from ?? ''}
          onChange={(e) => setFilter({ from: e.target.value || undefined })}
        />
        <Field
          label={t('orders.to')}
          type="date"
          value={search.to ?? ''}
          onChange={(e) => setFilter({ to: e.target.value || undefined })}
        />
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={Boolean(search.cancelledByShopper)}
              onChange={(e) => setFilter({ cancelledByShopper: e.target.checked || undefined })}
            />
            {t('orders.cancelledByShopper')}
          </label>
          {search.tag && (
            <Button variant="secondary" onClick={() => setFilter({ tag: undefined })}>
              {t('orders.tagFilter', { tag: search.tag })} ×
            </Button>
          )}
        </div>
      </div>
      {items.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={allSelected}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(items.map((o) => o.id)))
              }
            />
            {t('orders.selectAll')}
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {t('orders.selected', { count: selected.size })}
              </span>
              {canWrite && pendingSelected.length > 0 && (
                <Button variant="secondary" onClick={() => setConfirming(true)}>
                  {t('orders.bulkConfirm', { count: pendingSelected.length })}
                </Button>
              )}
              <PrintLinks ids={ids} />
            </>
          )}
        </div>
      )}
      <DataList
        label={t('nav.orders')}
        items={items}
        rowKey={(o) => o.id}
        columns={columns}
        isPending={orders.isPending}
        error={orders.isError ? errorMessage(orders.error, t) : undefined}
        onRetry={() => orders.refetch()}
        empty={filtered ? t('orders.noMatches') : t('orders.empty')}
        hasMore={orders.hasNextPage}
        loadingMore={orders.isFetchingNextPage}
        onLoadMore={() => orders.fetchNextPage()}
      />
      {confirming && (
        <BulkConfirmDialog
          orders={pendingSelected}
          onClose={(done) => {
            setConfirming(false);
            if (done) setSelected(new Set());
          }}
        />
      )}
    </div>
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
