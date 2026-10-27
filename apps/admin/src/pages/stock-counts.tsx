// Inventory → Counts (phase-8-plan §3.5, §3.12): the counts, newest first,
// and starting one for the whole location, a category, a tag or chosen items.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { CatalogNav } from '../components/catalog-nav';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import { InventoryNav } from '../components/inventory-nav';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { VariantPicker } from '../components/variant-picker';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { categoriesQuery, categoryOptions } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateOnly, lineLabel } from '../lib/orders';
import { PURCHASING_KEYS, type StockCountSummary } from '../lib/purchasing';

const SCOPES = ['all', 'category', 'tag', 'variants'] as const;
type ScopeKind = (typeof SCOPES)[number];

export function StockCountsPage() {
  const { t, locale } = useLocale();
  const canWrite = usePermission('inventory.write');
  const [starting, setStarting] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ['stock-counts'] as const,
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await api.GET('/v1/admin/stock-counts', {
          params: { query: pageParam ? { before: pageParam } : {} },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const columns: Column<StockCountSummary>[] = [
    {
      header: t('counts.number'),
      cell: (c) => (
        <Link
          to="/inventory/counts/$id"
          params={{ id: c.id }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {c.reference}
        </Link>
      ),
    },
    {
      header: t('counts.what'),
      cell: (c) => t(`counts.scope.${(c.scope as { kind: ScopeKind }).kind}`),
    },
    { header: t('po.status'), cell: (c) => t(`counts.status.${c.status}`) },
    {
      header: t('counts.counted'),
      cell: (c) => t('counts.progress', { counted: c.countedLines, total: c.lineCount }),
    },
    { header: t('counts.started'), cell: (c) => dateOnly(locale, c.createdAt) },
  ];
  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('counts.title')}
        description={t('counts.intro')}
        actions={canWrite && <Button onClick={() => setStarting(true)}>{t('counts.new')}</Button>}
      />
      <CatalogNav />
      <InventoryNav />
      <DataList
        label={t('counts.title')}
        items={items}
        rowKey={(c) => c.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t('counts.empty')}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => list.fetchNextPage()}
      />
      {starting && <NewCountDialog onClose={() => setStarting(false)} />}
    </div>
  );
}

function NewCountDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ScopeKind>('all');
  const [categoryId, setCategoryId] = useState('');
  const [tag, setTag] = useState('');
  const [chosen, setChosen] = useState<{ id: string; label: string }[]>([]);
  const [note, setNote] = useState('');
  const categories = useQuery({ ...categoriesQuery, enabled: kind === 'category' });
  const valid =
    kind === 'all' ||
    (kind === 'category' && categoryId !== '') ||
    (kind === 'tag' && tag.trim() !== '') ||
    (kind === 'variants' && chosen.length > 0);
  const start = useMutation({
    mutationFn: async () => {
      const scope =
        kind === 'category'
          ? { kind, categoryId }
          : kind === 'tag'
            ? { kind, tag: tag.trim() }
            : kind === 'variants'
              ? { kind, variantIds: chosen.map((c) => c.id) }
              : { kind };
      return unwrap(
        await api.POST('/v1/admin/stock-counts', {
          body: { scope, ...(note.trim() ? { note: note.trim() } : {}) },
        }),
      );
    },
    onSuccess: async (count) => {
      for (const key of PURCHASING_KEYS) await queryClient.invalidateQueries({ queryKey: key });
      onClose();
      navigate({ to: '/inventory/counts/$id', params: { id: count.id } });
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('counts.new')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) start.mutate();
        }}
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{t('counts.what')}</legend>
          {SCOPES.map((s) => (
            <label key={s} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="scope"
                className="size-5"
                checked={kind === s}
                onChange={() => setKind(s)}
              />
              {t(`counts.scope.${s}`)}
            </label>
          ))}
        </fieldset>
        {kind === 'category' && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('counts.category')}
            <select
              className="min-h-11 rounded-md border border-input bg-background px-3"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="" />
              {categoryOptions(categories.data ?? [], locale).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'tag' && (
          <Field
            label={t('counts.tag')}
            value={tag}
            maxLength={50}
            onChange={(e) => setTag(e.target.value)}
          />
        )}
        {kind === 'variants' && (
          <div className="flex flex-col gap-2">
            {chosen.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {chosen.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    {c.label}
                    <Button
                      variant="ghost"
                      onClick={() => setChosen(chosen.filter((x) => x.id !== c.id))}
                    >
                      {t('po.remove', { item: c.label })}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <VariantPicker
              anyStock
              onPick={(row) => {
                if (chosen.some((c) => c.id === row.variantId)) return;
                setChosen([
                  ...chosen,
                  {
                    id: row.variantId,
                    label: lineLabel({ title: row.titles, optionLabels: row.optionLabels }, locale),
                  },
                ]);
              }}
            />
          </div>
        )}
        <Field
          label={`${t('counts.note')} (${t('form.optional')})`}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
        {start.isError && <Notice tone="error">{saveErrorMessage(start.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={!valid || start.isPending}>
            {t('counts.start')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
