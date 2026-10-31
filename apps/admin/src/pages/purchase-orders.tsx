// Inventory → Purchase orders (phase-8-plan §3.2, §3.12; ADR 0033): newest
// first, a tab per status and a Supplier filter, with how much of each has
// arrived and which are late.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileText, Plus, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { ExportButtons } from '../components/export-buttons';
import { FilterButtons, RowMenu, RowMenuItem, StageTabs } from '../components/list-tools';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { dateOnly } from '../lib/orders';
import {
  dhakaToday,
  PO_STATUSES,
  type PurchaseOrderStatus,
  type PurchaseOrderSummary,
  priceOrDash,
  suppliersQuery,
} from '../lib/purchasing';
import { allPages } from '../lib/report-export';

/** A purchase order's status as a status badge (design rule 9). */
export function PoStatusChip({ status }: { status: PurchaseOrderStatus }) {
  const { t } = useLocale();
  const tone =
    status === 'ordered'
      ? 'bg-info text-info-foreground'
      : status === 'partially_received'
        ? 'bg-warning text-warning-foreground'
        : status === 'received'
          ? 'bg-success-soft text-success'
          : status === 'cancelled'
            ? 'border border-border text-muted-foreground'
            : 'bg-muted text-muted-foreground';
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-md px-2 text-xs font-medium ${tone}`}
    >
      {t(`po.status.${status}`)}
    </span>
  );
}

export function PurchaseOrdersPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const canWrite = usePermission('purchasing.write');
  const canReceive = usePermission('inventory.write');
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const [supplierId, setSupplierId] = useState<string>();
  const suppliers = useQuery(suppliersQuery());
  const filter = { ...(status ? { status } : {}), ...(supplierId ? { supplierId } : {}) };
  const list = useInfiniteQuery({
    queryKey: ['purchase-orders', filter] as const,
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await api.GET('/v1/admin/purchase-orders', {
          params: {
            query: { ...filter, ...(pageParam ? { before: pageParam } : {}) },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const open = (o: PurchaseOrderSummary) =>
    navigate({ to: '/inventory/purchase-orders/$id', params: { id: o.id } });
  const receivable = (o: PurchaseOrderSummary) =>
    o.status === 'ordered' || o.status === 'partially_received';
  const progress = (o: PurchaseOrderSummary) =>
    o.status === 'draft' ? (
      '—'
    ) : (
      <span className="flex flex-col gap-1">
        <span className="text-xs">
          {t('po.progress', { received: o.received, ordered: o.ordered })}
        </span>
        <span aria-hidden className="block h-1 w-28 overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full ${o.received >= o.ordered ? 'bg-success' : 'bg-primary'}`}
            style={{ width: `${o.ordered ? Math.min(100, (o.received / o.ordered) * 100) : 0}%` }}
          />
        </span>
      </span>
    );
  const expected = (o: PurchaseOrderSummary) => {
    if (!o.expectedOn) return <span className="text-muted-foreground">—</span>;
    const late = receivable(o) && o.expectedOn < dhakaToday();
    return late ? (
      <span className="whitespace-nowrap font-medium text-danger">
        {t('po.late', { date: dateOnly(locale, o.expectedOn) })}
      </span>
    ) : (
      <span className="whitespace-nowrap text-muted-foreground">
        {dateOnly(locale, o.expectedOn)}
      </span>
    );
  };
  const columns: Column<PurchaseOrderSummary>[] = [
    {
      header: t('po.number'),
      cell: (o) => (
        <Link
          to="/inventory/purchase-orders/$id"
          params={{ id: o.id }}
          className="font-mono font-medium underline-offset-2 hover:underline"
        >
          {o.reference}
        </Link>
      ),
    },
    { header: t('po.supplier'), cell: (o) => o.supplier.name },
    { header: t('po.status'), cell: (o) => <PoStatusChip status={o.status} /> },
    { header: t('po.received'), cell: progress },
    { header: t('po.expectedOn'), cell: expected },
    ...(items.some((o) => o.total !== undefined)
      ? [
          {
            header: t('po.total'),
            numeric: true,
            cell: (o: PurchaseOrderSummary) => priceOrDash(o.total, locale),
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t('po.title')}
        description={t('po.intro')}
        actions={
          <>
            {items.length > 0 && (
              <ExportButtons
                name="purchase-orders"
                what={t('po.title')}
                head={[
                  t('po.number'),
                  t('po.supplier'),
                  t('po.status'),
                  t('po.received'),
                  t('po.expectedOn'),
                  ...(items.some((o) => o.total !== undefined) ? [t('po.total')] : []),
                ]}
                rows={async () => {
                  const all = await allPages(async (cursor) =>
                    unwrap(
                      await api.GET('/v1/admin/purchase-orders', {
                        params: {
                          query: { ...filter, ...(cursor ? { before: cursor } : {}) },
                        },
                      }),
                    ),
                  );
                  const withTotal = all.some((o) => o.total !== undefined);
                  return all.map((o) => [
                    o.reference,
                    o.supplier.name,
                    t(`po.status.${o.status}`),
                    t('po.progress', { received: o.received, ordered: o.ordered }),
                    o.expectedOn ?? '',
                    ...(withTotal ? [o.total === undefined ? null : { money: o.total }] : []),
                  ]);
                }}
              />
            )}
            {canWrite && (
              <Button asChild>
                <Link to="/inventory/purchase-orders/new">
                  <Plus aria-hidden />
                  {t('po.new')}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <StageTabs
        label={t('po.status')}
        tabs={[
          { key: '', label: t('po.all') },
          ...PO_STATUSES.map((x) => ({ key: x, label: t(`po.status.${x}`) })),
        ]}
        value={status}
        onChange={(key) => setStatus(key as PurchaseOrderStatus | '')}
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterButtons
          filters={[
            {
              key: 'supplier',
              label: t('po.supplier'),
              value: supplierId,
              options: (suppliers.data ?? []).map((x) => ({ value: x.id, label: x.name })),
              onChange: setSupplierId,
            },
          ]}
          onReset={supplierId ? () => setSupplierId(undefined) : undefined}
        />
      </div>
      <DataList
        label={t('po.title')}
        items={items}
        rowKey={(o) => o.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={status || supplierId ? t('po.noMatches') : t('po.empty')}
        emptyAction={
          supplierId ? (
            <Button variant="secondary" onClick={() => setSupplierId(undefined)}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        onOpen={open}
        menu={(o) => (
          <RowMenu label={o.reference}>
            <RowMenuItem onSelect={() => open(o)}>
              <FileText aria-hidden />
              {t('list.open')}
            </RowMenuItem>
            {canReceive && receivable(o) && (
              <RowMenuItem
                onSelect={() =>
                  navigate({ to: '/inventory/receive', search: { purchaseOrderId: o.id } })
                }
              >
                <Truck aria-hidden />
                {t('po.receive')}
              </RowMenuItem>
            )}
          </RowMenu>
        )}
        card={(o) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2">
                <Link
                  to="/inventory/purchase-orders/$id"
                  params={{ id: o.id }}
                  className="font-mono font-medium"
                >
                  {o.reference}
                </Link>
                <PoStatusChip status={o.status} />
              </span>
              <span className="truncate text-sm">{o.supplier.name}</span>
              {progress(o)}
            </div>
            <span className="flex shrink-0 flex-col items-end gap-1 text-sm">
              {o.total !== undefined && (
                <span className="font-medium tabular-nums">{priceOrDash(o.total, locale)}</span>
              )}
              {expected(o)}
            </span>
          </div>
        )}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => list.fetchNextPage()}
      />
    </div>
  );
}
