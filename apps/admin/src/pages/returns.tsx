// Returns (phase-5a-plan §7; ADR 0033): newest first, a tab per status and a
// Reason filter. Shoppers' requests wait at "requested" until staff approve or
// reject them. A row opens the return; its menu also opens the order.
import { RETURN_REASONS, RETURN_RECORD_STATUSES } from '@managemind/shared/orders';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileText, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { FilterButtons, RowMenu, RowMenuItem, StageTabs } from '../components/list-tools';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/returns';
import { errorMessage } from '../lib/errors';
import { dateOnly } from '../lib/orders';
import {
  type ReturnReason,
  type ReturnStatus,
  type ReturnSummary,
  returnsQuery,
} from '../lib/returns';

/** A return's status as a status badge: waiting, moving, done or refused. */
export function ReturnStatusChip({ status }: { status: string }) {
  const { t } = useLocale();
  const tone =
    status === 'requested'
      ? 'bg-warning text-warning-foreground'
      : status === 'rejected'
        ? 'bg-danger-soft text-danger'
        : status === 'resolved'
          ? 'bg-success-soft text-success'
          : status === 'in_transit'
            ? 'bg-shipped text-shipped-foreground'
            : 'bg-info text-info-foreground';
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-md px-2 text-xs font-medium ${tone}`}
    >
      {t(`return.status.${status}` as AdminKey)}
    </span>
  );
}

export function ReturnsPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ReturnStatus | undefined>(undefined);
  const [reason, setReason] = useState<ReturnReason | undefined>(undefined);
  const list = useInfiniteQuery({
    queryKey: ['returns', status ?? null, reason ?? null] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => returnsQuery(status, pageParam, reason).queryFn(),
    getNextPageParam: (last: ReturnSummary[]) =>
      last.length === 50 ? last[last.length - 1]?.createdAt : undefined,
  });
  const rows = list.data?.pages.flat() ?? [];
  const open = (r: ReturnSummary) => navigate({ to: '/returns/$id', params: { id: r.id } });
  const reasonText = (r: ReturnSummary) => t(`return.reason.${r.reason}` as AdminKey);
  const columns: Column<ReturnSummary>[] = [
    {
      header: t('returns.col.return'),
      cell: (r) => (
        <Link
          to="/returns/$id"
          params={{ id: r.id }}
          className="font-mono font-medium underline-offset-2 hover:underline"
        >
          {r.displayNumber}
        </Link>
      ),
    },
    {
      header: t('returns.col.order'),
      cell: (r) => <span className="font-mono text-muted-foreground">{r.orderNumber}</span>,
    },
    {
      header: t('returns.col.customer'),
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium">{r.customerName}</span>
          {r.requestedBy === 'shopper' && (
            <span className="text-xs text-muted-foreground">{t('returns.byShopper')}</span>
          )}
        </span>
      ),
    },
    { header: t('returns.col.reason'), cell: reasonText },
    { header: t('returns.status'), cell: (r) => <ReturnStatusChip status={r.status} /> },
    {
      header: t('returns.col.asked'),
      cell: (r) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {dateOnly(locale, r.createdAt)}
        </span>
      ),
    },
    { header: t('returns.col.units'), numeric: true, cell: (r) => r.units },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader className="mb-0" title={t('returns.title')} description={t('returns.intro')} />
      <StageTabs
        label={t('returns.status')}
        tabs={[
          { key: 'all', label: t('returns.all') },
          ...RETURN_RECORD_STATUSES.map((s) => ({
            key: s,
            label: t(`return.status.${s}` as AdminKey),
          })),
        ]}
        value={status ?? 'all'}
        onChange={(key) => setStatus(key === 'all' ? undefined : (key as ReturnStatus))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterButtons
          filters={[
            {
              key: 'reason',
              label: t('returns.reasonFilter'),
              value: reason,
              options: RETURN_REASONS.map((r) => ({
                value: r,
                label: t(`return.reason.${r}` as AdminKey),
              })),
              onChange: (v) => setReason(v as ReturnReason | undefined),
            },
          ]}
          onReset={reason ? () => setReason(undefined) : undefined}
        />
      </div>
      <DataList
        label={t('returns.title')}
        items={list.data ? rows : undefined}
        rowKey={(r) => r.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={reason || status ? t('returns.noMatches') : t('returns.empty')}
        emptyAction={
          reason ? (
            <Button variant="secondary" onClick={() => setReason(undefined)}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => list.fetchNextPage()}
        onOpen={open}
        menu={(r) => (
          <RowMenu label={r.displayNumber}>
            <RowMenuItem onSelect={() => open(r)}>
              <FileText aria-hidden />
              {t('list.open')}
            </RowMenuItem>
            <RowMenuItem
              onSelect={() => navigate({ to: '/orders/$id', params: { id: r.orderId } })}
            >
              <ShoppingBag aria-hidden />
              {t('returns.openOrder')}
            </RowMenuItem>
          </RowMenu>
        )}
        card={(r) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <Link to="/returns/$id" params={{ id: r.id }} className="font-mono font-medium">
                  {r.displayNumber}
                </Link>
                <span className="font-mono text-sm text-muted-foreground">{r.orderNumber}</span>
              </span>
              <span className="truncate text-sm">{r.customerName}</span>
              <span className="text-xs text-muted-foreground">
                {reasonText(r)} · {t('returns.units', { count: r.units })} ·{' '}
                {dateOnly(locale, r.createdAt)}
              </span>
            </div>
            <ReturnStatusChip status={r.status} />
          </div>
        )}
      />
    </div>
  );
}
