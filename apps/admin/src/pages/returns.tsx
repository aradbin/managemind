// Returns (phase-5a-plan §7; ADR 0033): newest first, a tab per status and a
// Reason filter. Shoppers' requests wait at "requested" until staff approve or
// reject them. A row opens the return; its menu also opens the order.
import { RETURN_REASONS } from '@managemind/shared/orders';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileText, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import {
  FilterButtons,
  RowMenu,
  RowMenuItem,
  SearchInput,
  StageTabs,
  ToolbarSummary,
} from '../components/list-tools';
import { PageHeader } from '../components/page-header';
import { StatusBadge, type Tone } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/returns';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { dateOnly, pickText } from '../lib/orders';
import { usePagedList } from '../lib/paged';
import { type ReturnSummary, returnsList } from '../lib/returns';

/** A return's status as a status badge: waiting, moving, done or refused. */
export function ReturnStatusChip({ status }: { status: string }) {
  const { t } = useLocale();
  const tone: Tone =
    status === 'requested'
      ? 'waiting'
      : status === 'rejected'
        ? 'bad'
        : status === 'resolved'
          ? 'good'
          : status === 'in_transit'
            ? 'moving'
            : 'progress';
  return <StatusBadge tone={tone}>{t(`return.status.${status}` as AdminKey)}</StatusBadge>;
}

/** The board's tabs: the in-between statuses share one "In progress". */
const TABS = ['all', 'requested', 'in_progress', 'resolved', 'rejected'] as const;
const COUNT_KEY = {
  all: 'all',
  requested: 'requested',
  in_progress: 'inProgress',
  resolved: 'resolved',
  rejected: 'rejected',
} as const;

export function ReturnsPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [tab, setTab] = useState<(typeof TABS)[number]>('all');
  /** One reason or several, comma-separated. */
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);
  const list = usePagedList(returnsList(tab === 'all' ? undefined : tab, reason, q));
  const rows = list.items;
  const counts = list.first?.counts;
  const filtered = Boolean(reason || q);
  const reset = () => {
    setReason(undefined);
    setText('');
  };
  const open = (r: ReturnSummary) => navigate({ to: '/returns/$id', params: { id: r.id } });
  const reasonText = (r: ReturnSummary) => t(`return.reason.${r.reason}` as AdminKey);
  const itemsText = (r: ReturnSummary) => {
    const first = pickText(r.firstItem ?? undefined, locale);
    if (!first) return t('returns.units', { count: r.units });
    return r.moreItems ? t('returns.itemsMore', { first, count: r.moreItems }) : first;
  };
  const columns: Column<ReturnSummary>[] = [
    {
      header: t('returns.col.return'),
      cell: (r) => (
        <Link
          to="/returns/$id"
          params={{ id: r.id }}
          className="font-mono font-medium tracking-[0.02em]"
        >
          {r.displayNumber}
        </Link>
      ),
    },
    {
      header: t('returns.col.order'),
      cell: (r) => (
        <Link
          to="/orders/$id"
          params={{ id: r.orderId }}
          className="relative z-[1] font-mono tracking-[0.02em] text-muted-foreground"
        >
          {r.orderNumber}
        </Link>
      ),
    },
    {
      header: t('returns.col.customer'),
      skeleton: 'lines',
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{r.customerName}</span>
          {r.requestedBy === 'shopper' && (
            <span className="truncate text-[13px] text-muted-foreground">
              {t('returns.byShopper')}
            </span>
          )}
        </span>
      ),
    },
    {
      header: t('returns.col.items'),
      skeleton: 'lines',
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{itemsText(r)}</span>
          <span className="truncate text-[13px] text-muted-foreground">{reasonText(r)}</span>
        </span>
      ),
    },
    {
      header: t('returns.status'),
      skeleton: 'badge',
      cell: (r) => <ReturnStatusChip status={r.status} />,
    },
    {
      header: t('returns.col.asked'),
      cell: (r) => (
        <span className="whitespace-nowrap text-muted-foreground tabular-nums">
          {dateOnly(locale, r.createdAt)}
        </span>
      ),
    },
    {
      header: t('returns.col.value'),
      numeric: true,
      cell: (r) => <span className="font-medium">{formatPrice(r.value ?? 0, locale)}</span>,
    },
  ];
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader className="mb-0" title={t('returns.title')} />
      <StageTabs
        label={t('returns.status')}
        tabs={TABS.map((x) => ({
          key: x,
          label:
            x === 'all'
              ? t('returns.all')
              : x === 'in_progress'
                ? t('returns.inProgress')
                : t(`return.status.${x}` as AdminKey),
          count: x === 'all' ? counts?.all : counts?.[COUNT_KEY[x]] || undefined,
        }))}
        value={tab}
        onChange={setTab}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-[280px] md:flex-none"
          label={t('returns.search')}
          value={text}
          onChange={setText}
        />
        <FilterButtons
          filters={[
            {
              key: 'reason',
              multi: true,
              label: t('returns.reasonFilter'),
              value: reason,
              options: RETURN_REASONS.map((r) => ({
                value: r,
                label: t(`return.reason.${r}` as AdminKey),
              })),
              onChange: setReason,
            },
          ]}
          width={230}
          onReset={filtered ? reset : undefined}
        />
        {counts && counts.open > 0 && (
          <ToolbarSummary>
            {t('returns.summary', {
              count: counts.open,
              value: formatPrice(counts.openValue, locale),
            })}
          </ToolbarSummary>
        )}
      </div>
      <DataList
        label={t('returns.title')}
        items={rows}
        rowKey={(r) => r.id}
        columns={columns}
        grid="80px 76px minmax(0,1.3fr) minmax(0,1.3fr) 128px 96px 96px 36px"
        rowHeight={56}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={filtered || tab !== 'all' ? t('returns.noMatches') : t('returns.empty')}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        pager={list.pager}
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
