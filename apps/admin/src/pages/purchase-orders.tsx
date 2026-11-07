// Inventory → Purchase orders (phase-8-plan §3.2, §3.12; ADR 0033): newest
// first, a tab per status and a Supplier filter, with how much of each has
// arrived and which are late.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileText, Plus, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { ExportButtons } from '../components/export-buttons';
import {
  FilterButtons,
  RowMenu,
  RowMenuItem,
  SearchInput,
  StageTabs,
  ToolbarSummary,
} from '../components/list-tools';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { StatusBadge, type Tone } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { dateOnly } from '../lib/orders';
import { usePagedList } from '../lib/paged';
import {
  dhakaToday,
  type PurchaseOrderStatus,
  type PurchaseOrderSummary,
  priceOrDash,
  suppliersQuery,
} from '../lib/purchasing';
import { allPages } from '../lib/report-export';

/** A purchase order's status as a status badge (design rule 9). */
export function PoStatusChip({ status }: { status: PurchaseOrderStatus }) {
  const { t } = useLocale();
  const tone: Tone =
    status === 'ordered'
      ? 'progress'
      : status === 'partially_received'
        ? 'waiting'
        : status === 'received'
          ? 'good'
          : status === 'cancelled'
            ? 'outline'
            : 'ended';
  return <StatusBadge tone={tone}>{t(`po.status.${status}`)}</StatusBadge>;
}

/** The tabs: each status, with ordered and partly received as one "To receive". */
const TABS = ['', 'draft', 'to_receive', 'received', 'closed', 'cancelled'] as const;
type Tab = (typeof TABS)[number];
const COUNT_KEY = {
  '': 'all',
  draft: 'draft',
  to_receive: 'toReceive',
  received: 'received',
  closed: 'closed',
  cancelled: 'cancelled',
} as const;

export function PurchaseOrdersPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const canWrite = usePermission('purchasing.write');
  const canReceive = usePermission('inventory.write');
  const [status, setStatus] = useState<Tab>('');
  const [supplierId, setSupplierId] = useState<string>();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);
  const suppliers = useQuery(suppliersQuery());
  const filter = {
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(q ? { q } : {}),
  };
  const list = usePagedList({
    queryKey: ['purchase-orders', filter] as const,
    fetchPage: async (offset, limit) =>
      unwrap(
        await api.GET('/v1/admin/purchase-orders', {
          params: { query: { ...filter, counts: 'true', offset, limit } },
        }),
      ),
  });
  const items = list.items;
  const counts = list.first?.counts;
  const filtered = Boolean(supplierId || q);
  const reset = () => {
    setSupplierId(undefined);
    setText('');
  };
  const open = (o: PurchaseOrderSummary) =>
    navigate({ to: '/inventory/purchase-orders/$id', params: { id: o.id } });
  const receivable = (o: PurchaseOrderSummary) =>
    o.status === 'ordered' || o.status === 'partially_received';
  const progress = (o: PurchaseOrderSummary) =>
    o.status === 'draft' ? (
      '—'
    ) : (
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-4 tabular-nums">
          {t('po.progress', { received: o.received, ordered: o.ordered })}
        </span>
        <span aria-hidden className="block h-1 w-full overflow-hidden rounded-full bg-muted">
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
          className="font-mono font-medium tracking-[0.02em]"
        >
          {o.reference}
        </Link>
      ),
    },
    {
      header: t('po.supplier'),
      cell: (o) => <span className="block truncate">{o.supplier.name}</span>,
    },
    { header: t('po.status'), skeleton: 'badge', cell: (o) => <PoStatusChip status={o.status} /> },
    { header: t('po.received'), skeleton: 'lines', cell: progress },
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
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        className="mb-0"
        title={t('po.title')}
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
        tabs={TABS.map((x) => ({
          key: x,
          label:
            x === '' ? t('po.all') : x === 'to_receive' ? t('po.toReceive') : t(`po.status.${x}`),
          count: x === '' ? counts?.all : counts?.[COUNT_KEY[x]] || undefined,
        }))}
        value={status}
        onChange={(key) => setStatus(key)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-[280px] md:flex-none"
          label={t('po.search')}
          value={text}
          onChange={setText}
        />
        <FilterButtons
          filters={[
            {
              key: 'supplier',
              multi: true,
              label: t('po.supplier'),
              value: supplierId,
              options: (suppliers.data ?? []).map((x) => ({ value: x.id, label: x.name })),
              onChange: setSupplierId,
            },
          ]}
          onReset={filtered ? reset : undefined}
        />
        {counts && counts.toReceive > 0 && (
          <ToolbarSummary>
            {counts.toReceiveValue === undefined
              ? t('po.summaryCount', { count: counts.toReceive })
              : t('po.summary', {
                  count: counts.toReceive,
                  value: formatPrice(counts.toReceiveValue, locale),
                })}
          </ToolbarSummary>
        )}
      </div>
      <DataList
        label={t('po.title')}
        items={items}
        rowKey={(o) => o.id}
        columns={columns}
        grid="96px minmax(0,1.6fr) 130px minmax(0,1.2fr) 120px 110px 40px"
        rowHeight={56}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={status || filtered ? t('po.noMatches') : t('po.empty')}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
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
        pager={list.pager}
      />
    </div>
  );
}
