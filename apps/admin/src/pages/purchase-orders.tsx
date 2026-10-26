// Inventory → Purchase orders (phase-8-plan §3.2, §3.12): newest first, by
// status, with how much of each has arrived.
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { CatalogNav } from '../components/catalog-nav';
import { type Column, DataList } from '../components/data-list';
import { InventoryNav } from '../components/inventory-nav';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { dateOnly } from '../lib/orders';
import {
  PO_STATUSES,
  type PurchaseOrderStatus,
  type PurchaseOrderSummary,
  priceOrDash,
} from '../lib/purchasing';

export function PurchaseOrdersPage() {
  const { t, locale } = useLocale();
  const canWrite = usePermission('purchasing.write');
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const list = useInfiniteQuery({
    queryKey: ['purchase-orders', { status }] as const,
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await api.GET('/v1/admin/purchase-orders', {
          params: {
            query: { ...(status ? { status } : {}), ...(pageParam ? { before: pageParam } : {}) },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const columns: Column<PurchaseOrderSummary>[] = [
    {
      header: t('po.number'),
      cell: (o) => (
        <Link
          to="/inventory/purchase-orders/$id"
          params={{ id: o.id }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {o.reference}
        </Link>
      ),
    },
    { header: t('po.supplier'), cell: (o) => o.supplier.name },
    { header: t('po.status'), cell: (o) => t(`po.status.${o.status}`) },
    {
      header: t('po.received'),
      cell: (o) => t('po.progress', { received: o.received, ordered: o.ordered }),
    },
    {
      header: t('po.expectedOn'),
      cell: (o) => (o.expectedOn ? dateOnly(locale, o.expectedOn) : '—'),
    },
    ...(items.some((o) => o.total !== undefined)
      ? [{ header: t('po.total'), cell: (o: PurchaseOrderSummary) => priceOrDash(o.total, locale) }]
      : []),
  ];
  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('po.title')}
        description={t('po.intro')}
        actions={
          canWrite && (
            <Button asChild>
              <Link to="/inventory/purchase-orders/new">{t('po.new')}</Link>
            </Button>
          )
        }
      />
      <CatalogNav />
      <InventoryNav />
      <label className="mb-4 flex max-w-xs flex-col gap-1.5 text-sm font-medium">
        {t('po.status')}
        <select
          className="min-h-11 rounded-md border border-input bg-background px-3"
          value={status}
          onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus | '')}
        >
          <option value="">{t('po.allStatuses')}</option>
          {PO_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`po.status.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <DataList
        label={t('po.title')}
        items={items}
        rowKey={(o) => o.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t('po.empty')}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => list.fetchNextPage()}
      />
    </div>
  );
}
