// Inventory → Adjustments (phase-8-plan §3.4, §3.12): every change to stock
// made by hand or by a count, with its reason, who made it and its value at
// the cost then, filtered by reason and date with filter buttons, with totals.
import { formatNumber } from '@managemind/shared/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { ExportButtons } from '../components/export-buttons';
import { FilterButtons } from '../components/list-tools';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { dateRangeFilter, dateTime, lineLabel, pickText } from '../lib/orders';
import { type Adjustment, priceOrDash } from '../lib/purchasing';
import { allPages } from '../lib/report-export';

const REASONS = [
  'received',
  'count',
  'damaged',
  'lost',
  'expired',
  'sample',
  'returned',
  'correction',
  'import',
  'other',
] as const;
type Reason = (typeof REASONS)[number];

export function AdjustmentsPage() {
  const { t, locale } = useLocale();
  const [reason, setReason] = useState<Reason | undefined>();
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const filters = {
    ...(reason ? { reason } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const list = useInfiniteQuery({
    queryKey: ['adjustments', filters] as const,
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await api.GET('/v1/admin/inventory/adjustments', {
          params: { query: { ...filters, ...(pageParam ? { before: pageParam } : {}) } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const totals = list.data?.pages[0]?.totals;
  const filtered = Boolean(reason || from || to);
  const reset = () => {
    setReason(undefined);
    setFrom(undefined);
    setTo(undefined);
  };
  const reasonText = (r: string) =>
    (REASONS as readonly string[]).includes(r) ? t(`inventory.reasonLabel.${r as Reason}`) : r;
  const money = (v: number) => (v < 0 ? `−${priceOrDash(-v, locale)}` : priceOrDash(v, locale));
  const options = (a: Adjustment) =>
    a.optionLabels
      .map((o) => pickText(o, locale))
      .filter(Boolean)
      .join(' / ');
  const quantity = (a: Adjustment) => (
    <span className={a.quantity < 0 ? 'font-medium text-danger' : 'font-medium'}>
      {a.quantity > 0
        ? `+${formatNumber(locale, a.quantity)}`
        : `−${formatNumber(locale, -a.quantity)}`}
    </span>
  );
  const why = (a: Adjustment) => (
    <span className="flex flex-wrap items-center gap-2">
      <span className="rounded-md border border-border px-1.5 text-xs font-medium text-muted-foreground">
        {reasonText(a.reason)}
      </span>
      {a.note && <span className="text-sm">{a.note}</span>}
    </span>
  );
  const columns: Column<Adjustment>[] = [
    {
      header: t('adjustments.when'),
      cell: (a) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {dateTime(locale, a.createdAt)}
        </span>
      ),
    },
    {
      header: t('po.lines'),
      cell: (a) => (
        <span className="flex flex-col">
          <span className="font-medium">{pickText(a.title, locale)}</span>
          {options(a) && <span className="text-xs text-muted-foreground">{options(a)}</span>}
        </span>
      ),
    },
    { header: t('adjustments.reason'), cell: why },
    { header: t('inventory.quantity'), numeric: true, cell: quantity },
    ...(totals?.value !== undefined
      ? [
          {
            header: t('counts.value'),
            numeric: true,
            cell: (a: Adjustment) => (a.value == null ? '—' : money(a.value)),
          },
        ]
      : []),
  ];
  const exportAll = async () => {
    const all = await allPages(async (cursor) =>
      unwrap(
        await api.GET('/v1/admin/inventory/adjustments', {
          params: { query: { ...filters, ...(cursor ? { before: cursor } : {}) } },
        }),
      ),
    );
    return all.map((a) => [
      a.createdAt.slice(0, 10),
      [lineLabel(a, locale), a.sku].filter(Boolean).join(' · '),
      reasonText(a.reason),
      a.note ?? '',
      a.quantity,
      ...(totals?.value !== undefined ? [a.value == null ? null : { money: a.value }] : []),
    ]);
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t('adjustments.title')}
        description={t('adjustments.intro')}
        actions={
          items.length > 0 ? (
            <ExportButtons
              name="adjustments"
              what={t('adjustments.title')}
              head={[
                t('adjustments.when'),
                t('po.lines'),
                t('adjustments.reason'),
                t('inventory.note'),
                t('inventory.quantity'),
                ...(totals?.value !== undefined ? [t('counts.value')] : []),
              ]}
              rows={exportAll}
            />
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterButtons
          filters={[
            {
              key: 'reason',
              label: t('adjustments.reason'),
              value: reason,
              options: REASONS.map((r) => ({ value: r, label: reasonText(r) })),
              onChange: (v) => setReason(v as Reason | undefined),
            },
            dateRangeFilter({
              key: 'date',
              label: t('adjustments.date'),
              from,
              to,
              onChange: (range) => {
                setFrom(range.from);
                setTo(range.to);
              },
              t,
            }),
          ]}
          onReset={filtered ? reset : undefined}
        />
        {totals && totals.count > 0 && (
          <p className="ml-auto text-sm text-muted-foreground">
            {t('adjustments.totals', { count: totals.count, units: totals.units })}
            {totals.value !== undefined &&
              ` · ${t('adjustments.totalValue', { value: money(totals.value) })}`}
            {totals.unvalued > 0 && ` · ${t('adjustments.unvalued', { n: totals.unvalued })}`}
          </p>
        )}
      </div>
      <DataList
        label={t('adjustments.title')}
        items={items}
        rowKey={(a) => a.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={filtered ? t('adjustments.noMatches') : t('adjustments.empty')}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => list.fetchNextPage()}
        card={(a) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-medium">{lineLabel(a, locale)}</span>
              {why(a)}
              <span className="text-xs text-muted-foreground">{dateTime(locale, a.createdAt)}</span>
            </div>
            <span className="flex shrink-0 flex-col items-end text-sm tabular-nums">
              {quantity(a)}
              {a.value != null && <span className="text-muted-foreground">{money(a.value)}</span>}
            </span>
          </div>
        )}
      />
    </div>
  );
}
