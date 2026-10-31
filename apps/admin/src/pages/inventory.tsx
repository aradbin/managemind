// Inventory (phase-2-plan §3.8, §7): stock per variant with a low-stock
// filter, an adjust dialog (receive, count, damage, …, always with a reason)
// and each variant's movement history. Every change is a ledger entry.
import { formatDateTime } from '@managemind/shared/i18n';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import { compact, type InventoryRow, pick } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { costHistoryQuery, priceOrDash } from '../lib/purchasing';

export type InventorySearch = { q?: string | undefined; lowStock?: boolean | undefined };

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
  const options = row.optionLabels
    .map((l) => pick(l, locale))
    .filter(Boolean)
    .join(' / ');
  return options ? `${title} — ${options}` : title;
};

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
          search: { ...search, q: q.trim() || undefined },
          replace: true,
        });
      }
    }, 350);
    return () => clearTimeout(id);
  });
  const levels = useInfiniteQuery({
    queryKey: ['inventory', search],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await api.GET('/v1/admin/inventory', {
          params: {
            query: compact({
              q: search.q,
              lowStock: search.lowStock ? ('true' as const) : undefined,
              after: pageParam,
              limit: 50,
            }),
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = useMemo(() => levels.data?.pages.flatMap((p) => p.items) ?? [], [levels.data]);
  const columns: Column<InventoryRow>[] = [
    {
      header: t('inventory.item'),
      cell: (r) => (
        <Link
          to="/products/$id"
          params={{ id: r.productId }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {rowLabel(r, locale)}
        </Link>
      ),
    },
    { header: t('variant.sku'), cell: (r) => r.sku ?? '—' },
    { header: t('inventory.onHand'), cell: (r) => r.onHand },
    { header: t('inventory.reserved'), cell: (r) => r.reserved },
    {
      header: t('inventory.available'),
      cell: (r) => (
        <span className={r.lowStock ? 'font-semibold text-danger' : undefined}>
          {r.trackInventory ? r.available : t('inventory.untracked')}
          {r.lowStock && <span className="sr-only"> ({t('inventory.low')})</span>}
        </span>
      ),
    },
    {
      header: t('inventory.actions'),
      actions: true,
      cell: (r) => (
        <span className="flex gap-2">
          {canWrite && (
            <Button variant="secondary" onClick={() => setAdjusting(r)}>
              {t('inventory.adjust')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setHistory(r)}>
            {t('inventory.history')}
          </Button>
        </span>
      ),
    },
  ];
  return (
    <div className="max-w-6xl">
      <PageHeader title={t('catalog.inventory')} description={t('inventory.intro')} />
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
        <Input
          type="search"
          aria-label={t('inventory.search')}
          placeholder={t('inventory.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="md:max-w-sm"
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={Boolean(search.lowStock)}
            onChange={(e) =>
              navigate({
                to: '/inventory',
                search: { ...search, lowStock: e.target.checked || undefined },
                replace: true,
              })
            }
          />
          {t('products.lowStockOnly')}
        </label>
      </div>
      <DataList
        label={t('catalog.inventory')}
        items={items}
        rowKey={(r) => r.variantId}
        columns={columns}
        isPending={levels.isPending}
        error={levels.isError ? errorMessage(levels.error, t) : undefined}
        onRetry={() => levels.refetch()}
        empty={t('inventory.empty')}
        hasMore={levels.hasNextPage}
        loadingMore={levels.isFetchingNextPage}
        onLoadMore={() => levels.fetchNextPage()}
      />
      {adjusting && <AdjustDialog row={adjusting} onClose={() => setAdjusting(null)} />}
      {history && <HistoryDialog row={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function AdjustDialog({ row, onClose }: { row: InventoryRow; onClose: () => void }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('received');
  // With purchasing, stock bought is received there, so its cost is kept (phase-8-plan §3.4).
  const canReceive = usePermission('purchasing.write');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(() => crypto.randomUUID());
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
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('inventory.adjustTitle')}
      description={rowLabel(row, locale)}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <p className="text-sm">
          {t('inventory.current', { onHand: row.onHand, reserved: row.reserved })}
        </p>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{t('inventory.reason')}</legend>
          {MODES.map((m) => (
            <label key={m} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="mode"
                className="size-5"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {t(`inventory.mode.${m}`)}
            </label>
          ))}
        </fieldset>
        {mode === 'received' && canReceive && (
          <Notice tone="info">
            <Link
              to="/inventory/receive"
              className="font-medium text-primary hover:underline"
              onClick={onClose}
            >
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
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={!valid || save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function HistoryDialog({ row, onClose }: { row: InventoryRow; onClose: () => void }) {
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
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('inventory.historyTitle')}
      description={rowLabel(row, locale)}
    >
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
                <span className={m.quantity < 0 ? 'text-danger' : undefined}>
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
    </Dialog>
  );
}
