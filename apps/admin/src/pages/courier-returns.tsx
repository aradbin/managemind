// Orders → Courier returns (phase-7-plan §3.5, Q9): parcels a courier says
// it brought back, as a list (ADR 0033). Received puts them back in stock, as Phase 5A's return
// of a failed shipment does; nothing is restocked before staff see it.
import { formatNumber } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { type Column, DataList } from '../components/data-list';
import { SearchInput, StageTabs, ToolbarSummary } from '../components/list-tools';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { StatusBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/couriers';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { type CourierReturn, courierName, courierReturnsQuery } from '../lib/couriers';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateTime } from '../lib/orders';

export function CourierReturnsPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('orders.write');
  const [tab, setTab] = useState<'coming' | 'received'>('coming');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);
  const list = useQuery(courierReturnsQuery(tab, q));
  const counts = list.data?.counts;
  // Received restocks the parcel's items, so it asks first.
  const [confirming, setConfirming] = useState<CourierReturn | null>(null);
  const receive = useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await api.POST('/v1/admin/shipments/{id}/return', {
          params: { path: { id } },
          body: {},
        }),
      ),
    onSuccess: async () => {
      setConfirming(null);
      toast(t('couriers.receivedDone'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['courier-returns'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
      ]);
    },
  });
  const received = (r: CourierReturn) =>
    canWrite &&
    r.state !== 'received' && (
      <Button
        variant="secondary"
        className="relative z-[1]"
        disabled={receive.isPending && receive.variables === r.shipmentId}
        onClick={() => {
          receive.reset();
          setConfirming(r);
        }}
      >
        <Check aria-hidden />
        {t('couriers.received')}
      </Button>
    );
  const parcel = (r: CourierReturn) =>
    [
      r.firstItem
        ? r.firstItem.quantity > 1
          ? `${formatNumber(locale, r.firstItem.quantity)} × ${r.firstItem.title}`
          : r.firstItem.title
        : t('couriers.returns.items', { n: r.items }),
      formatPrice(r.value, locale),
    ].join(' · ');
  const state = (r: CourierReturn) => (
    <StatusBadge
      tone={r.state === 'handed_back' ? 'waiting' : r.state === 'on_its_way' ? 'moving' : 'good'}
    >
      {t(`couriers.returns.state.${r.state}`)}
    </StatusBadge>
  );
  const columns: Column<CourierReturn>[] = [
    {
      header: t('order.number'),
      cell: (r) => (
        <Link
          to="/orders/$id"
          params={{ id: r.orderId }}
          className="font-mono font-medium tracking-[0.02em]"
        >
          {r.displayNumber}
        </Link>
      ),
    },
    {
      header: t('order.customer'),
      skeleton: 'lines',
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{r.name}</span>
          <span className="truncate text-[13px] text-muted-foreground">{parcel(r)}</span>
        </span>
      ),
    },
    {
      header: t('couriers.returns.courier'),
      skeleton: 'lines',
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          {courierName(r.courier, t)}
          {r.consignmentId && (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {r.consignmentId}
            </span>
          )}
        </span>
      ),
    },
    {
      header: t('couriers.returns.whyBack'),
      cell: (r) => <span className="block truncate">{r.failedReason ?? '—'}</span>,
    },
    {
      header: t('couriers.returns.since'),
      cell: (r) => (
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {dateTime(locale, r.since)}
        </span>
      ),
    },
    { header: t('order.status'), skeleton: 'badge', cell: state },
    { header: t('couriers.received'), actions: true, cell: received },
  ];
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader className="mb-0" title={t('couriers.returns.title')} />
      <StageTabs
        label={t('couriers.returns.title')}
        tabs={[
          { key: 'coming', label: t('couriers.returns.coming'), count: counts?.coming },
          {
            key: 'received',
            label: t('couriers.returns.receivedTab'),
            count: counts?.received || undefined,
          },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-[320px] md:flex-none"
          label={t('couriers.returns.search')}
          value={text}
          onChange={setText}
        />
        {counts && counts.coming > 0 && (
          <ToolbarSummary>
            {t('couriers.returns.summary', {
              count: counts.coming,
              value: formatPrice(counts.comingValue, locale),
            })}
          </ToolbarSummary>
        )}
      </div>
      <DataList
        label={t('couriers.returns.title')}
        items={list.data?.items}
        rowKey={(r) => r.shipmentId}
        columns={columns}
        grid="76px minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1.4fr) 110px 120px 128px"
        rowHeight={60}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t(q ? 'couriers.returns.noMatches' : 'couriers.returns.empty')}
        card={(r) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <Link
                  to="/orders/$id"
                  params={{ id: r.orderId }}
                  className="font-mono font-semibold tracking-[0.02em]"
                >
                  {r.displayNumber}
                </Link>
                {state(r)}
              </span>
              <span className="truncate">{r.name}</span>
              <span className="truncate text-[13px] text-muted-foreground">
                {courierName(r.courier, t)}
                {r.failedReason ? ` · ${r.failedReason}` : ''}
              </span>
            </div>
            <span className="shrink-0">{received(r)}</span>
          </div>
        )}
      />
      <p className="text-[13px] text-muted-foreground">{t('couriers.returns.footnote')}</p>
      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && !receive.isPending && setConfirming(null)}
          title={t('couriers.receiveTitle', { number: confirming.displayNumber })}
          confirmLabel={t('couriers.received')}
          destructive={false}
          busy={receive.isPending}
          error={receive.error ? saveErrorMessage(receive.error, t) : undefined}
          onConfirm={() => receive.mutate(confirming.shipmentId)}
        >
          <p>{t('couriers.receiveBody', { parcel: parcel(confirming) })}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
