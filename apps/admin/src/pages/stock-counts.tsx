// Inventory → Counts (phase-8-plan §3.5, §3.12; ADR 0033): the counts, newest
// first, a tab per status, and starting one for the whole location, a
// category, a tag or chosen items.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileText, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import { RowMenu, RowMenuItem, StageTabs } from '../components/list-tools';
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

const STATUSES = ['counting', 'review', 'applied', 'cancelled'] as const;
type CountStatus = StockCountSummary['status'];

/** A count's status as a status badge (design rule 9). */
function CountStatusChip({ status }: { status: CountStatus }) {
  const { t } = useLocale();
  const tone =
    status === 'counting' || status === 'applying'
      ? 'bg-info text-info-foreground'
      : status === 'review'
        ? 'bg-warning text-warning-foreground'
        : status === 'applied'
          ? 'bg-success-soft text-success'
          : 'border border-border text-muted-foreground';
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-md px-2 text-xs font-medium ${tone}`}
    >
      {t(`counts.status.${status}`)}
    </span>
  );
}

export function StockCountsPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const canWrite = usePermission('inventory.write');
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<CountStatus | ''>('');
  const categories = useQuery(categoriesQuery);
  const list = useInfiniteQuery({
    queryKey: ['stock-counts', status] as const,
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await api.GET('/v1/admin/stock-counts', {
          params: {
            query: { ...(status ? { status } : {}), ...(pageParam ? { before: pageParam } : {}) },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const open = (c: StockCountSummary) =>
    navigate({ to: '/inventory/counts/$id', params: { id: c.id } });
  /** What is counted, as specifically as the scope says. */
  const what = (c: StockCountSummary) => {
    const scope = c.scope as {
      kind: ScopeKind;
      categoryId?: string;
      tag?: string;
      variantIds?: string[];
    };
    if (scope.kind === 'category') {
      const name = categoryOptions(categories.data ?? [], locale).find(
        (o) => o.id === scope.categoryId,
      )?.label;
      return name ? t('counts.whatCategory', { name }) : t('counts.scope.category');
    }
    if (scope.kind === 'tag' && scope.tag) return t('counts.whatTag', { tag: scope.tag });
    if (scope.kind === 'variants') {
      return t('counts.whatItems', { count: scope.variantIds?.length ?? c.lineCount });
    }
    return t(`counts.scope.${scope.kind}`);
  };
  const progress = (c: StockCountSummary) => (
    <span className="flex flex-col gap-1">
      <span className="text-xs">
        {t('counts.progress', { counted: c.countedLines, total: c.lineCount })}
      </span>
      <span aria-hidden className="block h-1 w-28 overflow-hidden rounded-full bg-muted">
        <span
          className={`block h-full rounded-full ${c.lineCount && c.countedLines >= c.lineCount ? 'bg-success' : 'bg-primary'}`}
          style={{
            width: `${c.lineCount ? Math.min(100, (c.countedLines / c.lineCount) * 100) : 0}%`,
          }}
        />
      </span>
    </span>
  );
  const columns: Column<StockCountSummary>[] = [
    {
      header: t('counts.number'),
      cell: (c) => (
        <Link
          to="/inventory/counts/$id"
          params={{ id: c.id }}
          className="font-mono font-medium underline-offset-2 hover:underline"
        >
          {c.reference}
        </Link>
      ),
    },
    { header: t('counts.what'), cell: what },
    { header: t('po.status'), cell: (c) => <CountStatusChip status={c.status} /> },
    { header: t('counts.counted'), cell: progress },
    {
      header: t('counts.started'),
      cell: (c) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {dateOnly(locale, c.createdAt)}
        </span>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t('counts.title')}
        description={t('counts.intro')}
        actions={
          canWrite && (
            <Button onClick={() => setStarting(true)}>
              <Plus aria-hidden />
              {t('counts.new')}
            </Button>
          )
        }
      />
      <StageTabs
        label={t('po.status')}
        tabs={[
          { key: '', label: t('counts.all') },
          ...STATUSES.map((x) => ({ key: x, label: t(`counts.status.${x}`) })),
        ]}
        value={status}
        onChange={(key) => setStatus(key as CountStatus | '')}
      />
      <DataList
        label={t('counts.title')}
        items={items}
        rowKey={(c) => c.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={status ? t('counts.noMatches') : t('counts.empty')}
        emptyAction={
          !status && canWrite ? (
            <Button variant="secondary" onClick={() => setStarting(true)}>
              {t('counts.new')}
            </Button>
          ) : undefined
        }
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => list.fetchNextPage()}
        onOpen={open}
        menu={(c) => (
          <RowMenu label={c.reference}>
            <RowMenuItem onSelect={() => open(c)}>
              <FileText aria-hidden />
              {t('list.open')}
            </RowMenuItem>
          </RowMenu>
        )}
        card={(c) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-2">
                <Link
                  to="/inventory/counts/$id"
                  params={{ id: c.id }}
                  className="font-mono font-medium"
                >
                  {c.reference}
                </Link>
                <CountStatusChip status={c.status} />
              </span>
              <span className="truncate text-sm">{what(c)}</span>
              {progress(c)}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {dateOnly(locale, c.createdAt)}
            </span>
          </div>
        )}
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
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('counts.what')}</legend>
          {/* Radio cards: each choice changes the form and needs a sentence (design rule 3). */}
          <div className="grid gap-2 md:grid-cols-2">
            {SCOPES.map((s) => (
              <label
                key={s}
                className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border p-3 text-sm has-checked:border-primary has-checked:bg-muted/60"
              >
                <input
                  type="radio"
                  name="scope"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={kind === s}
                  onChange={() => setKind(s)}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{t(`counts.scope.${s}`)}</span>
                  <span className="text-muted-foreground">{t(`counts.scopeHint.${s}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {kind === 'category' && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('counts.category')}
            <select
              className="min-h-10 rounded-lg border border-input bg-background px-3 text-base font-normal shadow-xs md:min-h-9 md:text-sm"
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
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={!valid || start.isPending}>
            {t('counts.start')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
