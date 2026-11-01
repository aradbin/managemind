// Orders → Courier returns (phase-7-plan §3.5, Q9): parcels a courier says
// it brought back, as a list (ADR 0033). Received puts them back in stock, as Phase 5A's return
// of a failed shipment does; nothing is restocked before staff see it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { PackageCheck } from 'lucide-react';
import { type Column, DataList } from '../components/data-list';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/couriers';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { courierName, courierReturnsQuery } from '../lib/couriers';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateTime } from '../lib/orders';

export function CourierReturnsPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('orders.write');
  const list = useQuery(courierReturnsQuery);
  const receive = useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await api.POST('/v1/admin/shipments/{id}/return', {
          params: { path: { id } },
          body: {},
        }),
      ),
    onSuccess: async () => {
      toast(t('couriers.receivedDone'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: courierReturnsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
      ]);
    },
  });
  type Row = NonNullable<typeof list.data>[number];
  const received = (r: Row) =>
    canWrite && (
      <Button
        variant="secondary"
        disabled={receive.isPending}
        onClick={() => receive.mutate(r.shipmentId)}
      >
        <PackageCheck aria-hidden />
        {t('couriers.received')}
      </Button>
    );
  const columns: Column<Row>[] = [
    {
      header: t('order.number'),
      cell: (r) => (
        <Link
          to="/orders/$id"
          params={{ id: r.orderId }}
          className="font-mono font-medium underline-offset-2 hover:underline"
        >
          {r.displayNumber}
        </Link>
      ),
    },
    { header: t('order.customer'), cell: (r) => <span className="font-medium">{r.name}</span> },
    {
      header: t('couriers.returns.courier'),
      cell: (r) => (
        <span className="flex flex-col">
          {courierName(r.courier, t)}
          {r.consignmentId && (
            <span className="font-mono text-xs text-muted-foreground">{r.consignmentId}</span>
          )}
        </span>
      ),
    },
    {
      header: t('couriers.returns.why'),
      wide: true,
      cell: (r) => <span className="text-muted-foreground">{r.failedReason ?? '—'}</span>,
    },
    {
      header: t('couriers.returns.cameBack'),
      cell: (r) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {dateTime(locale, r.returnedByCourierAt)}
        </span>
      ),
    },
    {
      header: t('couriers.returns.itemsCol'),
      numeric: true,
      cell: (r) => r.items,
    },
    { header: t('couriers.received'), actions: true, cell: received },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t('couriers.returns.title')}
        description={t('couriers.returns.description')}
      />
      {receive.error && <Notice tone="error">{saveErrorMessage(receive.error, t)}</Notice>}
      <DataList
        label={t('couriers.returns.title')}
        items={list.data}
        rowKey={(r) => r.shipmentId}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t('couriers.returns.empty')}
        card={(r) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <Link to="/orders/$id" params={{ id: r.orderId }} className="font-mono font-medium">
                  {r.displayNumber}
                </Link>
                <span className="truncate text-sm">{r.name}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {courierName(r.courier, t)}
                {r.consignmentId && ` · ${r.consignmentId}`} ·{' '}
                {t('couriers.returns.items', { n: r.items })} ·{' '}
                {dateTime(locale, r.returnedByCourierAt)}
              </span>
              {r.failedReason && <span className="text-sm">{r.failedReason}</span>}
            </div>
            <span className="shrink-0">{received(r)}</span>
          </div>
        )}
      />
    </div>
  );
}
