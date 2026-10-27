// Inventory → Adjustments (phase-8-plan §3.4, §3.12): every change to stock
// made by hand or by a count, with its reason, who made it and its value at
// the cost then, filtered by reason and date, with totals.
import { formatDateTime } from '@managemind/shared/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CatalogNav } from '../components/catalog-nav';
import { type Column, DataList } from '../components/data-list';
import { ExportButtons } from '../components/export-buttons';
import { Field } from '../components/field';
import { InventoryNav } from '../components/inventory-nav';
import { PageHeader } from '../components/page-header';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { lineLabel } from '../lib/orders';
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
  const [reason, setReason] = useState<Reason | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
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
  const reasonText = (r: string) =>
    (REASONS as readonly string[]).includes(r) ? t(`inventory.reasonLabel.${r as Reason}`) : r;
  const columns: Column<Adjustment>[] = [
    {
      header: t('adjustments.when'),
      cell: (a) => formatDateTime(locale, new Date(a.createdAt)),
    },
    { header: t('po.lines'), cell: (a) => lineLabel(a, locale) },
    {
      header: t('adjustments.reason'),
      cell: (a) => [reasonText(a.reason), a.note].filter(Boolean).join(' · '),
    },
    {
      header: t('inventory.quantity'),
      cell: (a) => (
        <span className={a.quantity < 0 ? 'text-danger' : undefined}>
          {a.quantity > 0 ? `+${a.quantity}` : a.quantity}
        </span>
      ),
    },
    ...(totals?.value !== undefined
      ? [
          {
            header: t('counts.value'),
            cell: (a: Adjustment) =>
              a.value == null
                ? '—'
                : a.value < 0
                  ? `−${priceOrDash(-a.value, locale)}`
                  : priceOrDash(a.value, locale),
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
    <div className="max-w-6xl">
      <PageHeader
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
      <CatalogNav />
      <InventoryNav />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('adjustments.reason')}
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={reason}
            onChange={(e) => setReason(e.target.value as Reason | '')}
          >
            <option value="">{t('adjustments.allReasons')}</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {reasonText(r)}
              </option>
            ))}
          </select>
        </label>
        <Field
          label={t('adjustments.from')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          label={t('adjustments.to')}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      {totals && totals.count > 0 && (
        <p className="mb-3 font-medium">
          {t('adjustments.totals', { count: totals.count, units: totals.units })}
          {totals.value !== undefined &&
            ` · ${t('adjustments.totalValue', {
              value:
                totals.value < 0
                  ? `−${priceOrDash(-totals.value, locale)}`
                  : priceOrDash(totals.value, locale),
            })}`}
          {totals.unvalued > 0 && ` · ${t('adjustments.unvalued', { n: totals.unvalued })}`}
        </p>
      )}
      <DataList
        label={t('adjustments.title')}
        items={items}
        rowKey={(a) => a.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t('adjustments.empty')}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => list.fetchNextPage()}
      />
    </div>
  );
}
