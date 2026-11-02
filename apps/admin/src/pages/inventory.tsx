// Inventory (phase-2-plan §3.8, §7; ADR 0033): stock per variant with a
// low-stock filter, an adjust panel (receive, count, damage, …, always with a
// reason) and each variant's history in a panel. Every change is a ledger
// entry.
import { formatDateTime, formatNumber } from '@managemind/shared/i18n';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { History, Package, SlidersHorizontal, Truck, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { ExportButtons } from '../components/export-buttons';
import { Field } from '../components/field';
import { RowMenu, RowMenuItem, SearchInput, ToolbarSummary } from '../components/list-tools';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { StatusBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Sheet, SheetBody, SheetFooter, SheetForm } from '../components/ui/sheet';
import { StatRow } from '../components/ui/stat-row';
import { useLocale } from '../i18n';
// The receive hint and the cost history live with the purchasing screens' messages.
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { compact, formatPrice, type InventoryRow, pick } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { usePagedList } from '../lib/paged';
import { costHistoryQuery, priceOrDash } from '../lib/purchasing';
import { cn } from '../lib/utils';

export type InventorySearch = {
  q?: string | undefined;
  lowStock?: boolean | undefined;
  page?: number | undefined;
};

const MODES = [
  'received',
  'count',
  'damaged',
  'lost',
  'expired',
  'sample',
  'returned',
  'correction',
] as const;
type Mode = (typeof MODES)[number];
/** Modes that take stock out (phase-8-plan §3.4). */
const OUT_MODES: readonly Mode[] = ['damaged', 'lost', 'expired', 'sample'];

const REASONS = [
  'received',
  'count',
  'damaged',
  'lost',
  'returned',
  'correction',
  'import',
  'expired',
  'sample',
  'other',
] as const;
/** A movement's reason in words; reasons from later phases (orders) show as they are. */
const reasonLabel = (reason: string, t: ReturnType<typeof useLocale>['t']) =>
  (REASONS as readonly string[]).includes(reason)
    ? t(`inventory.reasonLabel.${reason as (typeof REASONS)[number]}`)
    : reason;

const rowLabel = (row: InventoryRow, locale: 'bn' | 'en') => {
  const title = pick(row.titles, locale) ?? '—';
  const options = optionsOf(row, locale);
  return options ? `${title} — ${options}` : title;
};

const optionsOf = (row: InventoryRow, locale: 'bn' | 'en') =>
  row.optionLabels
    .map((l) => pick(l, locale))
    .filter(Boolean)
    .join(' / ');

/** The adjust panel's choices, in the groups the design shows. */
const GROUPS = [
  ['add', ['received', 'returned', 'correction']],
  ['out', ['damaged', 'lost', 'expired', 'sample']],
  ['set', ['count']],
] as const satisfies readonly (readonly ['add' | 'out' | 'set', readonly Mode[]])[];

export function InventoryPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as InventorySearch;
  const navigate = useNavigate();
  const canWrite = usePermission('inventory.write');
  const [q, setQ] = useState(search.q ?? '');
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const [history, setHistory] = useState<InventoryRow | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? '') !== q.trim()) {
        navigate({
          to: '/inventory',
          search: { ...search, q: q.trim() || undefined, page: undefined },
          replace: true,
        });
      }
    }, 350);
    return () => clearTimeout(id);
  });
  const { page, ...filters } = search;
  const fetchLevels = async (offset: number, limit: number, summary = false) =>
    unwrap(
      await api.GET('/v1/admin/inventory', {
        params: {
          query: compact({
            q: filters.q,
            lowStock: filters.lowStock ? ('true' as const) : undefined,
            summary: summary ? ('true' as const) : undefined,
            offset,
            limit,
          }),
        },
      }),
    );
  const levels = usePagedList({
    queryKey: ['inventory', filters],
    fetchPage: (offset: number, limit: number) => fetchLevels(offset, limit, true),
    page,
    onPageChange: (next) =>
      navigate({ to: '/inventory', search: { ...search, page: next > 1 ? next : undefined } }),
  });
  const items = levels.items;
  const summary = (
    levels.first as
      | { summary?: { tracked: number; units: number; lowStock: number; valueAtCost?: number } }
      | undefined
  )?.summary;
  const filtered = Boolean(search.q || search.lowStock);
  const setLow = (on: boolean) =>
    navigate({
      to: '/inventory',
      search: { ...search, lowStock: on || undefined, page: undefined },
      replace: true,
    });
  const reset = () => {
    setQ('');
    navigate({ to: '/inventory', search: {}, replace: true });
  };
  const available = (r: InventoryRow) =>
    r.trackInventory ? (
      <span className="inline-flex items-center justify-end gap-1.5">
        {r.lowStock && <StatusBadge tone="bad">{t('inventory.lowBadge')}</StatusBadge>}
        <span className={cn('font-semibold tabular-nums', r.lowStock && 'text-danger')}>
          {formatNumber(locale, r.available)}
        </span>
      </span>
    ) : (
      <span className="text-muted-foreground">{t('inventory.untracked')}</span>
    );
  const menu = (r: InventoryRow) => (
    <RowMenu label={rowLabel(r, locale)}>
      {canWrite && r.trackInventory && (
        <RowMenuItem onSelect={() => setAdjusting(r)}>
          <SlidersHorizontal aria-hidden />
          {t('inventory.adjustTitle')}
        </RowMenuItem>
      )}
      <RowMenuItem onSelect={() => setHistory(r)}>
        <History aria-hidden />
        {t('inventory.historyTitle')}
      </RowMenuItem>
      <RowMenuItem onSelect={() => navigate({ to: '/products/$id', params: { id: r.productId } })}>
        <Package aria-hidden />
        {t('inventory.openProduct')}
      </RowMenuItem>
    </RowMenu>
  );
  const columns: Column<InventoryRow>[] = [
    {
      header: t('inventory.item'),
      skeleton: 'lines',
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <button
            type="button"
            className="truncate text-left font-medium"
            onClick={() => setHistory(r)}
          >
            {pick(r.titles, locale) ?? '—'}
          </button>
          {optionsOf(r, locale) && (
            <span className="truncate text-[13px] text-muted-foreground">
              {optionsOf(r, locale)}
            </span>
          )}
        </span>
      ),
    },
    {
      header: t('variant.sku'),
      cell: (r) => (
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {r.sku ?? '—'}
        </span>
      ),
    },
    {
      header: t('inventory.onHand'),
      numeric: true,
      cell: (r) => (r.trackInventory ? formatNumber(locale, r.onHand) : '—'),
    },
    {
      header: t('inventory.reserved'),
      numeric: true,
      cell: (r) => (
        <span className="text-muted-foreground">
          {r.trackInventory ? formatNumber(locale, r.reserved) : '—'}
        </span>
      ),
    },
    { header: t('inventory.available'), numeric: true, cell: available },
    {
      header: t('inventory.actions'),
      actions: true,
      cell: (r) => (
        <span className="flex items-center justify-end gap-1">
          {canWrite && r.trackInventory && (
            <Button
              variant="secondary"
              className="relative z-[1] h-7 px-2.5 has-[>svg]:px-2.5 md:h-7"
              aria-label={t('inventory.adjustFor', { item: rowLabel(r, locale) })}
              onClick={() => setAdjusting(r)}
            >
              {t('inventory.adjust')}
            </Button>
          )}
          {menu(r)}
        </span>
      ),
    },
  ];
  const exportHead = [
    t('inventory.item'),
    t('variant.sku'),
    t('inventory.onHand'),
    t('inventory.reserved'),
    t('inventory.available'),
  ];
  async function exportRows() {
    const out: (string | number)[][] = [];
    for (let offset = 0; ; offset += 200) {
      const page = await fetchLevels(offset, 200);
      for (const r of page.items) {
        out.push([rowLabel(r, locale), r.sku ?? '', r.onHand, r.reserved, r.available]);
      }
      if (offset + 200 >= page.total) return out;
    }
  }
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        className="mb-0"
        title={t('catalog.inventory')}
        actions={
          <>
            <span className="hidden md:contents">
              <ExportButtons
                name="stock"
                chevron={false}
                what={t('catalog.inventory')}
                head={exportHead}
                rows={exportRows}
              />
            </span>
            {canWrite && (
              <Button asChild>
                <Link to="/inventory/receive">
                  <Truck aria-hidden />
                  {t('nav.receiveStock')}
                </Link>
              </Button>
            )}
          </>
        }
      />
      {summary && (
        <StatRow
          stats={[
            { label: t('inventory.statTracked'), value: formatNumber(locale, summary.tracked) },
            { label: t('inventory.statUnits'), value: formatNumber(locale, summary.units) },
            ...(summary.valueAtCost !== undefined
              ? [
                  {
                    label: t('inventory.statValue'),
                    value: formatPrice(Math.round(summary.valueAtCost / 100) * 100, locale),
                  },
                ]
              : []),
            {
              label: t('inventory.statLow'),
              alert: summary.lowStock > 0,
              value: (
                <button
                  type="button"
                  aria-pressed={Boolean(search.lowStock)}
                  aria-label={t('inventory.statLowAria', { count: summary.lowStock })}
                  onClick={() => setLow(!search.lowStock)}
                  className="underline decoration-transparent underline-offset-[3px] hover:decoration-current aria-pressed:decoration-current"
                >
                  {formatNumber(locale, summary.lowStock)}
                </button>
              ),
            },
          ]}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-[280px] md:flex-none"
          label={t('inventory.search')}
          value={q}
          onChange={setQ}
        />
        <label className="ml-2 hidden cursor-pointer items-center gap-2 font-medium md:inline-flex">
          <input
            type="checkbox"
            checked={Boolean(search.lowStock)}
            onChange={(e) => setLow(e.target.checked)}
          />
          {t('products.lowStockOnly')}
        </label>
        {filtered && (
          <Button variant="ghost" onClick={reset}>
            {t('list.reset')}
            <X aria-hidden />
          </Button>
        )}
        {levels.first && (
          <ToolbarSummary>
            {t('inventory.itemCount', { count: formatNumber(locale, levels.total) })}
          </ToolbarSummary>
        )}
      </div>
      <DataList
        label={t('catalog.inventory')}
        items={items}
        rowKey={(r) => r.variantId}
        columns={columns}
        grid="minmax(0,2.4fr) minmax(0,1fr) 84px 84px 120px 132px"
        rowHeight={52}
        isPending={levels.isPending}
        error={levels.isError ? errorMessage(levels.error, t) : undefined}
        onRetry={() => levels.refetch()}
        empty={filtered ? t('inventory.noMatches') : t('inventory.empty')}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        pager={levels.pager}
        onOpen={setHistory}
        card={(r) => (
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{pick(r.titles, locale) ?? '—'}</span>
              <span className="truncate text-[13px] leading-[18px] text-muted-foreground">
                {[optionsOf(r, locale), r.sku].filter(Boolean).join(' · ')}
              </span>
            </div>
            <span className="shrink-0">{available(r)}</span>
            <span className="-mr-2 shrink-0">{menu(r)}</span>
          </div>
        )}
      />
      {adjusting && <AdjustSheet row={adjusting} onClose={() => setAdjusting(null)} />}
      {history && (
        <HistorySheet
          row={history}
          onClose={() => setHistory(null)}
          onAdjust={
            canWrite
              ? () => {
                  setAdjusting(history);
                  setHistory(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function AdjustSheet({ row, onClose }: { row: InventoryRow; onClose: () => void }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('received');
  // With purchasing, stock bought is received there, so its cost is kept (phase-8-plan §3.4).
  const canReceive = usePermission('purchasing.write');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const name = useId();
  const amount = Number(quantity.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim());
  const valid =
    quantity.trim() !== '' &&
    Number.isInteger(amount) &&
    (mode === 'count' ? amount >= 0 : amount > 0);
  const save = useMutation({
    mutationFn: async () => {
      // Damage and loss take stock away; receiving and returns add; a count sets it.
      const line =
        mode === 'count'
          ? {
              mode: 'set' as const,
              variantId: row.variantId,
              onHand: amount,
              reason: 'count' as const,
            }
          : {
              mode: 'delta' as const,
              variantId: row.variantId,
              quantity: OUT_MODES.includes(mode) ? -amount : amount,
              reason: mode,
            };
      return unwrap(
        await api.POST('/v1/admin/inventory/adjustments', {
          headers: { 'idempotency-key': key },
          body: [{ ...line, ...(note.trim() ? { note: note.trim() } : {}) }],
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      await queryClient.invalidateQueries({ queryKey: ['product', row.productId] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['movements', row.variantId] });
      toast(t('inventory.adjusted'));
      onClose();
    },
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('inventory.adjustTitle')}
      description={rowLabel(row, locale)}
    >
      <SheetForm
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <SheetBody>
          <Notice>{t('inventory.current', { onHand: row.onHand, reserved: row.reserved })}</Notice>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 font-medium">{t('inventory.reason')}</legend>
            {GROUPS.map(([group, modes]) => (
              <div key={group} className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {t(`inventory.group.${group}`)}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {modes.map((m) => (
                    <label
                      key={m}
                      className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] border border-border px-3 text-sm has-checked:border-primary has-checked:bg-muted/60"
                    >
                      <input
                        type="radio"
                        name={name}
                        className="shrink-0"
                        checked={mode === m}
                        onChange={() => setMode(m)}
                      />
                      {t(`inventory.mode.${m}`)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          {mode === 'received' && canReceive && (
            <Notice tone="info">
              <Link to="/inventory/receive" className="font-medium underline" onClick={onClose}>
                {t('inventory.receiveHint')}
              </Link>
            </Notice>
          )}
          <Field
            label={mode === 'count' ? t('inventory.countedQuantity') : t('inventory.quantity')}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <Field
            label={`${t('inventory.note')} (${t('form.optional')})`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        </SheetBody>
        <SheetFooter>
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={!valid || save.isPending}>
            {t('action.save')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </Sheet>
  );
}

function HistorySheet({
  row,
  onClose,
  onAdjust,
}: {
  row: InventoryRow;
  onClose: () => void;
  onAdjust?: (() => void) | undefined;
}) {
  const { t, locale } = useLocale();
  const movements = useInfiniteQuery({
    queryKey: ['movements', row.variantId],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await api.GET('/v1/admin/variants/{id}/movements', {
          params: { path: { id: row.variantId }, query: compact({ before: pageParam, limit: 50 }) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = movements.data?.pages.flatMap((p) => p.items) ?? [];
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: async () => unwrap(await api.GET('/v1/admin/locations')),
  });
  const many = (locations.data?.length ?? 0) > 1;
  const seesCost = usePermission('catalog.cost');
  const costs = useQuery({ ...costHistoryQuery(row.variantId), enabled: seesCost });
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('inventory.historyTitle')}
      description={`${rowLabel(row, locale)} · ${t('inventory.onHandNow', { count: row.onHand })}`}
    >
      <SheetBody className="gap-6">
        {seesCost && costs.data && (
          <section className="flex flex-col gap-1">
            <h3 className="font-medium">{t('cost.history')}</h3>
            {costs.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('cost.empty')}</p>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {costs.data.items.slice(0, 10).map((c) => (
                  <li key={c.id} className="flex flex-col gap-0.5 py-2 text-sm">
                    <span className="flex justify-between gap-2">
                      <span className="font-medium">{t(`cost.source.${c.source}`)}</span>
                      <span className="tabular-nums">
                        {t('cost.change', {
                          old: priceOrDash(c.oldCost, locale),
                          new: priceOrDash(c.newCost, locale),
                        })}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateTime(locale, new Date(c.createdAt))} ·{' '}
                      {t('cost.onHand', { n: c.onHand })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
        <section className="flex flex-col gap-1">
          <h3 className="font-medium">{t('inventory.changes')}</h3>
          {movements.isPending ? (
            <p role="status">{t('loading')}</p>
          ) : movements.isError ? (
            <Notice tone="error">{errorMessage(movements.error, t)}</Notice>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground">{t('inventory.noMovements')}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {items.map((m) => (
                <li key={m.id} className="flex flex-col gap-0.5 py-2 text-sm">
                  <span className="flex justify-between gap-2">
                    <span className="font-medium">{t(`movement.${m.type}`)}</span>
                    <span
                      className={
                        m.quantity < 0
                          ? 'font-medium text-danger tabular-nums'
                          : 'font-medium tabular-nums'
                      }
                    >
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {formatDateTime(locale, new Date(m.createdAt))} · {reasonLabel(m.reason, t)}
                    {many && ` · ${locations.data?.find((l) => l.id === m.locationId)?.name ?? ''}`}
                  </span>
                  {m.note && <span>{m.note}</span>}
                </li>
              ))}
            </ol>
          )}
          {movements.hasNextPage && (
            <Button
              variant="secondary"
              disabled={movements.isFetchingNextPage}
              onClick={() => movements.fetchNextPage()}
            >
              {t('list.more')}
            </Button>
          )}
        </section>
      </SheetBody>
      <SheetFooter>
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t('action.close')}
        </Button>
        {onAdjust && (
          <Button size="lg" onClick={onAdjust}>
            <SlidersHorizontal aria-hidden />
            {t('inventory.adjustTitle')}
          </Button>
        )}
      </SheetFooter>
    </Sheet>
  );
}
