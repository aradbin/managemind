// Orders → Courier returns (phase-7-plan §3.5, Q9): parcels a courier says
// it brought back. Received puts them back in stock, as Phase 5A's return
// of a failed shipment does; nothing is restocked before staff see it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/couriers';
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
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        parent={{ to: '/orders', label: t('nav.orders') }}
        title={t('couriers.returns.title')}
        description={t('couriers.returns.description')}
      />
      {list.isPending && <p role="status">{t('loading')}</p>}
      {list.isError && <Notice tone="error">{errorMessage(list.error, t)}</Notice>}
      {list.data && list.data.length === 0 && (
        <p className="text-muted-foreground">{t('couriers.returns.empty')}</p>
      )}
      {receive.error && <Notice tone="error">{saveErrorMessage(receive.error, t)}</Notice>}
      {list.data && list.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background">
          {list.data.map((r) => (
            <li key={r.shipmentId} className="flex flex-wrap items-center gap-3 p-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link
                  to="/orders/$id"
                  params={{ id: r.orderId }}
                  className="font-medium text-primary hover:underline"
                >
                  {r.displayNumber} · {r.name}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {courierName(r.courier, t)}
                  {r.consignmentId && ` · ${r.consignmentId}`} ·{' '}
                  {t('couriers.returns.items', { n: r.items })} ·{' '}
                  {dateTime(locale, r.returnedByCourierAt)}
                </span>
                {r.failedReason && <span className="text-sm">{r.failedReason}</span>}
              </div>
              {canWrite && (
                <Button disabled={receive.isPending} onClick={() => receive.mutate(r.shipmentId)}>
                  {t('couriers.received')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
