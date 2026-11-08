// The product list (phase-2-plan §7, PR 9; ADR 0033): status tabs, search
// and filter buttons, rows on phones and a table from md that open the
// product, and selection for a bulk price edit in the selection bar.
import { dhakaToUtc, utcToDhaka } from '@managemind/shared/storefront';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { CircleCheck, Download, ImageOff, Plus, SquarePen, Tag, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { DateField } from '../components/date-field';
import {
  FilterButtons,
  FilterChips,
  type FilterDef,
  RowMenu,
  RowMenuItem,
  SearchInput,
  SelectionBar,
  SortDrawer,
  StageTabs,
} from '../components/list-tools';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { StatusBadge as Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogFooter } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import {
  attributesQuery,
  categoriesQuery,
  categoryOptions,
  formatRange,
  type Product,
  type ProductFilters,
  type ProductSort,
  type ProductSummary,
  pick,
  priceInput,
  productQuery,
  productsList,
  readPrice,
} from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { usePagedList } from '../lib/paged';
import { ExportButton } from './export';

export type ProductSearch = Omit<ProductFilters, 'status'> & {
  status?: 'draft' | 'active' | 'archived' | undefined;
  page?: number | undefined;
  sort?: ProductSort | undefined;
};

const STATUSES = ['active', 'draft', 'archived'] as const;

export function ProductsPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as ProductSearch;
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('catalog.write');
  const canStock = usePermission('inventory.read');
  const [q, setQ] = useState(search.q ?? '');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /** The products whose prices are being edited: the selection, or one row's. */
  const [bulk, setBulk] = useState<string[]>();
  const [changing, setChanging] = useState(false);
  const [exporting, setExporting] = useState(false);

  const setFilter = (patch: Partial<ProductSearch>) =>
    navigate({
      from: '/products/',
      to: '/products',
      search: (prev: ProductSearch) => {
        // A new filter starts again at page 1.
        const next = { ...prev, page: undefined, ...patch };
        return Object.fromEntries(
          Object.entries(next).filter(([, v]) => v !== undefined && v !== '' && v !== false),
        ) as ProductSearch;
      },
      replace: true,
    });

  // Search as you type, after a pause.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? '') !== q.trim()) setFilter({ q: q.trim() || undefined });
    }, 350);
    return () => clearTimeout(id);
  });

  const { page, sort, ...listFilters } = search;
  // The All tab holds every product, archived ones too.
  const apiFilters: ProductFilters = { ...listFilters, status: listFilters.status ?? 'any' };
  const products = usePagedList({
    ...productsList(apiFilters, { sort, counts: true }),
    page,
    onPageChange: (next) =>
      navigate({
        from: '/products/',
        to: '/products',
        search: (prev: ProductSearch) => ({ ...prev, page: next > 1 ? next : undefined }),
      }),
  });
  const categories = useQuery(categoriesQuery);
  const attributes = useQuery(attributesQuery);
  const brand = attributes.data?.find((a) => a.key === 'brand');
  const items = products.items;
  const counts = (products.first as { counts?: Record<string, number> } | undefined)?.counts;
  const title = (p: ProductSummary) => pick(p.titles, locale) ?? t('product.untitled');

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = items.length > 0 && items.every((p) => selected.has(p.id));

  const filters: FilterDef[] = [
    {
      key: 'category',
      multi: true,
      label: t('catalog.category'),
      value: search.categoryId,
      options: categoryOptions(categories.data ?? [], locale).map((c) => ({
        value: c.id,
        label: c.label,
      })),
      onChange: (v) => setFilter({ categoryId: v }),
    },
    ...(brand
      ? [
          {
            key: 'brand',
            multi: true,
            label: pick(brand.name, locale) ?? t('attribute.brand'),
            value: search.brandValueId,
            options: brand.values.map((v) => ({ value: v.id, label: pick(v.label, locale) ?? '' })),
            onChange: (v: string | undefined) => setFilter({ brandValueId: v }),
          },
        ]
      : []),
  ];
  const filtered = Boolean(
    search.q || search.categoryId || search.brandValueId || search.tag || search.lowStock,
  );
  const reset = () => {
    setQ('');
    setFilter({
      q: undefined,
      categoryId: undefined,
      brandValueId: undefined,
      tag: undefined,
      lowStock: undefined,
    });
  };
  const lowStock = canStock && (
    <label className="ml-2 hidden cursor-pointer items-center gap-2 font-medium md:inline-flex">
      <input
        type="checkbox"
        checked={Boolean(search.lowStock)}
        onChange={(e) => setFilter({ lowStock: e.target.checked || undefined })}
      />
      {t('products.lowStockOnly')}
    </label>
  );

  const columns: Column<ProductSummary>[] = [
    {
      header: t('product.title'),
      sortKey: 'title',
      skeleton: 'lines',
      cell: (p) => (
        <span className="flex items-center gap-3">
          <Thumbnail file={p.imageFile} size="size-8" />
          <Link to="/products/$id" params={{ id: p.id }} className="truncate font-medium">
            {title(p)}
          </Link>
        </span>
      ),
    },
    {
      header: t('product.status'),
      skeleton: 'badge',
      cell: (p) => <StatusBadge status={p.status} />,
    },
    {
      header: t('product.price'),
      sortKey: 'price',
      numeric: true,
      cell: (p) => formatRange(p.minPrice, p.maxPrice, locale),
    },
    {
      header: t('product.variants'),
      sortKey: 'variants',
      numeric: true,
      cell: (p) => p.variantCount,
    },
    ...(canStock
      ? [
          {
            header: t('product.stock'),
            sortKey: 'stock',
            numeric: true,
            cell: (p: ProductSummary) =>
              p.available === null || p.available === undefined ? (
                '—'
              ) : (
                <span className={p.lowStock ? 'font-medium text-danger' : undefined}>
                  {p.available}
                  {p.lowStock && <span className="sr-only"> ({t('inventory.low')})</span>}
                </span>
              ),
          },
        ]
      : []),
  ];
  const sorts = [
    { value: 'title', label: t('products.sortTitle') },
    { value: '-title', label: t('products.sortTitleDesc') },
    { value: 'price', label: t('products.sortPriceLow') },
    { value: '-price', label: t('products.sortPriceHigh') },
    ...(canStock ? [{ value: 'stock', label: t('products.sortStockLow') }] : []),
  ];

  async function changeStatus(status: 'active' | 'draft' | 'archived') {
    const ids = [...selected];
    try {
      for (const id of ids) {
        if (status === 'archived') {
          unwrap(await api.POST('/v1/admin/products/{id}/archive', { params: { path: { id } } }));
        } else {
          unwrap(
            await api.PATCH('/v1/admin/products/{id}', {
              params: { path: { id } },
              body: { status },
            }),
          );
        }
      }
      toast(t('products.statusApplied', { count: ids.length }));
      setSelected(new Set());
    } catch (e) {
      toast(saveErrorMessage(e, t));
    } finally {
      setChanging(false);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    }
  }

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        className="mb-0"
        title={t('catalog.products')}
        actions={
          <>
            <ExportButton
              filters={apiFilters}
              selectedIds={[...selected]}
              iconOnPhone
              open={exporting}
              onOpenChange={setExporting}
            />
            {canWrite && (
              <Button asChild>
                <Link to="/products/new">
                  <Plus aria-hidden />
                  {t('products.new')}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <StageTabs
        label={t('product.status')}
        tabs={[
          { key: 'all', label: t('list.all'), count: counts?.any },
          ...STATUSES.map((s) => ({
            key: s,
            label: t(`status.${s}`),
            count: counts?.[s] || undefined,
          })),
        ]}
        value={search.status ?? 'all'}
        onChange={(key) => setFilter({ status: key === 'all' ? undefined : key })}
      />
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-2">
        <SearchInput
          label={t('products.search')}
          value={q}
          onChange={setQ}
          className="w-full md:w-[260px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <FilterButtons
            filters={filters}
            drawerAlways
            onReset={filtered ? reset : undefined}
            showLabel={t('products.showCount', { count: products.total })}
            drawerExtra={
              canStock && (
                <div className="flex min-h-10 items-center justify-between gap-4">
                  <label htmlFor="products-low" className="cursor-pointer font-medium">
                    {t('products.lowStockOnly')}
                  </label>
                  <Switch
                    id="products-low"
                    checked={Boolean(search.lowStock)}
                    onCheckedChange={(on) => setFilter({ lowStock: on || undefined })}
                  />
                </div>
              )
            }
            extra={
              <>
                {search.tag && (
                  <Button variant="secondary" onClick={() => setFilter({ tag: undefined })}>
                    {t('products.tagFilter', { tag: search.tag })}
                    <X aria-hidden />
                  </Button>
                )}
                {lowStock}
              </>
            }
          />
          <SortDrawer
            options={sorts}
            value={sort}
            onChange={(v) => setFilter({ sort: v as ProductSort | undefined })}
          />
        </div>
        <FilterChips
          filters={filters}
          onReset={reset}
          extra={
            search.lowStock
              ? [
                  {
                    label: t('products.lowStock'),
                    onRemove: () => setFilter({ lowStock: undefined }),
                  },
                ]
              : []
          }
        />
      </div>
      <DataList
        label={t('catalog.products')}
        items={items}
        rowKey={(p) => p.id}
        columns={columns}
        isPending={products.isPending}
        error={products.isError ? errorMessage(products.error, t) : undefined}
        onRetry={() => products.refetch()}
        empty={filtered || search.status ? t('products.noMatches') : t('products.empty')}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        pager={products.pager}
        sort={{ value: sort, onChange: (v) => setFilter({ sort: v as ProductSort | undefined }) }}
        summary={t('products.countLabel', { count: products.total })}
        menuOnPhone={false}
        onOpen={(p) => navigate({ to: '/products/$id', params: { id: p.id } })}
        selection={
          canWrite
            ? {
                isSelected: (p) => selected.has(p.id),
                toggle: (p) => toggle(p.id),
                toggleAll: () =>
                  setSelected(allSelected ? new Set() : new Set(items.map((p) => p.id))),
                label: (p) => t('products.select', { title: title(p) }),
              }
            : undefined
        }
        bar={
          <SelectionBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
            actions={[
              { label: t('products.editPrices'), icon: Tag, onClick: () => setBulk([...selected]) },
              {
                label: t('products.changeStatus'),
                icon: CircleCheck,
                onClick: () => setChanging(true),
              },
              {
                label: t('products.exportSelected'),
                icon: Download,
                onClick: () => setExporting(true),
              },
            ]}
          />
        }
        menu={(p) => (
          <RowMenu label={title(p)}>
            <RowMenuItem onSelect={() => navigate({ to: '/products/$id', params: { id: p.id } })}>
              <SquarePen aria-hidden />
              {t('list.open')}
            </RowMenuItem>
            {canWrite && (
              <RowMenuItem onSelect={() => setBulk([p.id])}>
                <Tag aria-hidden />
                {t('products.editPrices')}
              </RowMenuItem>
            )}
          </RowMenu>
        )}
        card={(p) => (
          <div className="flex min-h-12 items-center gap-2">
            <Thumbnail file={p.imageFile} size="size-8" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link to="/products/$id" params={{ id: p.id }} className="truncate font-medium">
                {title(p)}
              </Link>
              <span className="truncate text-[13px] leading-[18px] text-muted-foreground tabular-nums">
                {formatRange(p.minPrice, p.maxPrice, locale)}
                {canStock && p.available !== null && p.available !== undefined && (
                  <>
                    {' · '}
                    <span className={p.lowStock ? 'font-medium text-danger' : undefined}>
                      {t('products.inStock', { count: p.available })}
                    </span>
                  </>
                )}
              </span>
            </div>
            <StatusBadge status={p.status} />
          </div>
        )}
      />
      {changing && (
        <ChangeStatusDialog
          count={selected.size}
          onClose={() => setChanging(false)}
          onPick={changeStatus}
        />
      )}
      {bulk && (
        <BulkPriceDialog
          productIds={bulk}
          onClose={(saved) => {
            setBulk(undefined);
            if (saved) setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

/** The selection's new status: active, draft or archived. */
function ChangeStatusDialog({
  count,
  onClose,
  onPick,
}: {
  count: number;
  onClose: () => void;
  onPick: (status: 'active' | 'draft' | 'archived') => Promise<void>;
}) {
  const { t } = useLocale();
  const [status, setStatus] = useState<'active' | 'draft' | 'archived'>('active');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('products.changeStatus')}
      description={t('products.selectedCount', { count })}
    >
      <div role="radiogroup" aria-label={t('product.status')} className="flex flex-col gap-3">
        {STATUSES.map((s) => (
          <label key={s} className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="bulk-status"
              checked={status === s}
              onChange={() => setStatus(s)}
            />
            {t(`status.${s}`)}
          </label>
        ))}
      </div>
      <DialogFooter>
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t('action.cancel')}
        </Button>
        <Button
          size="lg"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onPick(status);
          }}
        >
          {t('action.save')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export function StatusBadge({ status }: { status: 'draft' | 'active' | 'archived' }) {
  const { t } = useLocale();
  return (
    <Badge tone={status === 'active' ? 'good' : status === 'draft' ? 'ended' : 'outline'}>
      {t(`status.${status}`)}
    </Badge>
  );
}

/** A product's first image, or a placeholder. Files are named by content, so the browser keeps them. */
export function Thumbnail({
  file,
  size = 'size-10',
}: {
  file: string | null | undefined;
  size?: string;
}) {
  return file ? (
    <img
      src={`/api/admin/media/files/${file}`}
      alt=""
      loading="lazy"
      className={`${size} shrink-0 rounded-lg object-cover`}
    />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-lg bg-muted`}>
      <ImageOff aria-hidden className="size-4 text-muted-foreground" />
    </span>
  );
}

/** A variant's option labels: "M / Red", or the product's own title when it has none. */
export function variantLabel(product: Product, variantId: string, locale: 'bn' | 'en'): string {
  const variant = product.variants.find((v) => v.id === variantId);
  const values = product.options.flatMap((o) => o.values);
  const labels = (variant?.optionValueIds ?? []).map(
    (id) => pick(values.find((v) => v.id === id)?.label, locale) ?? '?',
  );
  return labels.length ? labels.join(' / ') : (pick(product.translations, locale)?.title ?? '');
}

interface Row {
  id: string;
  label: string;
  price: string;
  compareAt: string;
  threshold: string;
  sale: string;
  original: {
    price: number;
    compareAtPrice: number | null;
    lowStockThreshold: number | null;
    salePrice: number | null;
    saleStartsAt: string | null;
    saleEndsAt: string | null;
  };
}

/**
 * Price, compare-at, low-stock threshold and a scheduled sale (phase-4-plan
 * §3.14) for every variant of the selected products; the sale's window is
 * one for the whole batch.
 */
function BulkPriceDialog({
  productIds,
  onClose,
}: {
  productIds: string[];
  onClose: (saved: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const results = useQueries({ queries: productIds.map((id) => productQuery(id)) });
  const loading = results.some((r) => r.isPending);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [percent, setPercent] = useState('');
  const [salePercent, setSalePercent] = useState('');
  const [saleStart, setSaleStart] = useState('');
  const [saleEnd, setSaleEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (loading || rows) return;
    setRows(
      results.flatMap((r) =>
        r.data
          ? r.data.variants.map((v) => ({
              id: v.id,
              label: `${pick(r.data.translations, locale)?.title ?? ''}${r.data.options.length ? ` — ${variantLabel(r.data, v.id, locale)}` : ''}`,
              price: priceInput(v.price),
              compareAt: priceInput(v.compareAtPrice),
              threshold: v.lowStockThreshold === null ? '' : String(v.lowStockThreshold),
              sale: priceInput(v.salePrice),
              original: {
                price: v.price,
                compareAtPrice: v.compareAtPrice,
                lowStockThreshold: v.lowStockThreshold,
                salePrice: v.salePrice,
                saleStartsAt: v.saleStartsAt,
                saleEndsAt: v.saleEndsAt,
              },
            }))
          : [],
      ),
    );
    // The batch's window starts as the first sale already set, if any.
    const first = results
      .flatMap((r) => r.data?.variants ?? [])
      .find((v) => v.saleStartsAt && v.saleEndsAt);
    if (first?.saleStartsAt && first.saleEndsAt) {
      setSaleStart(utcToDhaka(first.saleStartsAt));
      setSaleEnd(utcToDhaka(first.saleEndsAt));
    }
  }, [loading, rows, results, locale]);

  const set = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? null);

  function applyPercent() {
    const p = Number(percent.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))));
    if (!Number.isFinite(p) || !rows) return;
    setRows(
      rows.map((r) => ({
        ...r,
        price: priceInput(Math.max(0, Math.round((r.original.price * (100 + p)) / 100))),
      })),
    );
  }

  function applySalePercent() {
    const p = Number(salePercent.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))));
    if (!Number.isFinite(p) || p <= 0 || p >= 100 || !rows) return;
    setRows(
      rows.map((r) => {
        const price = readPrice(r.price);
        return typeof price === 'number'
          ? { ...r, sale: priceInput(Math.round((price * (100 - p)) / 100)) }
          : r;
      }),
    );
  }

  async function save() {
    if (!rows) return;
    const anySale = rows.some((r) => r.sale.trim());
    if (anySale && (!saleStart || !saleEnd || saleEnd <= saleStart)) {
      setError(t('products.saleWindow'));
      return;
    }
    const startsAt = saleStart ? dhakaToUtc(saleStart) : null;
    const endsAt = saleEnd ? dhakaToUtc(saleEnd) : null;
    const edits = [];
    for (const r of rows) {
      const price = readPrice(r.price);
      const compareAt = readPrice(r.compareAt);
      const threshold = r.threshold.trim() === '' ? null : Number(r.threshold);
      if (
        price === undefined ||
        price === null ||
        compareAt === undefined ||
        (threshold !== null && !Number.isInteger(threshold))
      ) {
        setError(t('products.bulkInvalid', { item: r.label }));
        return;
      }
      if (compareAt !== null && compareAt <= price) {
        setError(t('variant.compareAtAbove', { item: r.label }));
        return;
      }
      const sale = readPrice(r.sale);
      if (sale === undefined || (sale !== null && sale >= price)) {
        setError(t('products.saleBelow', { item: r.label }));
        return;
      }
      const edit: {
        id: string;
        price?: number;
        compareAtPrice?: number | null;
        lowStockThreshold?: number | null;
        salePrice?: number | null;
        saleStartsAt?: string | null;
        saleEndsAt?: string | null;
      } = { id: r.id };
      if (price !== r.original.price) edit.price = price;
      if (compareAt !== r.original.compareAtPrice) edit.compareAtPrice = compareAt;
      if (threshold !== r.original.lowStockThreshold) edit.lowStockThreshold = threshold;
      const sameWindow =
        r.original.saleStartsAt !== null &&
        startsAt !== null &&
        Date.parse(r.original.saleStartsAt) === Date.parse(startsAt) &&
        r.original.saleEndsAt !== null &&
        endsAt !== null &&
        Date.parse(r.original.saleEndsAt) === Date.parse(endsAt);
      if (sale === null && r.original.salePrice !== null) edit.salePrice = null;
      if (sale !== null && (sale !== r.original.salePrice || !sameWindow)) {
        edit.salePrice = sale;
        edit.saleStartsAt = startsAt;
        edit.saleEndsAt = endsAt;
      }
      if (Object.keys(edit).length > 1) edits.push(edit);
    }
    if (!edits.length) return onClose(false);
    setBusy(true);
    setError(undefined);
    try {
      for (let i = 0; i < edits.length; i += 200) {
        unwrap(await api.PATCH('/v1/admin/variants', { body: edits.slice(i, i + 200) }));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        ...productIds.map((id) => queryClient.invalidateQueries({ queryKey: ['product', id] })),
      ]);
      toast(t('products.bulkSaved', { count: edits.length }));
      onClose(true);
    } catch (e) {
      setError(saveErrorMessage(e, t));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)} title={t('products.bulkTitle')}>
      {!rows ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="bulk-percent" className="text-sm font-medium">
                {t('products.bulkPercent')}
              </label>
              <Input
                id="bulk-percent"
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                placeholder="10, -5"
              />
            </div>
            <Button variant="secondary" onClick={applyPercent}>
              {t('products.bulkApply')}
            </Button>
          </div>
          <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
            <legend className="px-1 text-sm font-medium">{t('products.sale')}</legend>
            <p className="text-sm text-muted-foreground">{t('products.saleHint')}</p>
            <div className="grid gap-2 md:grid-cols-2">
              <DateField
                time
                label={t('products.saleStart')}
                value={saleStart}
                onChange={setSaleStart}
              />
              <DateField time label={t('products.saleEnd')} value={saleEnd} onChange={setSaleEnd} />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="bulk-sale-percent" className="text-sm font-medium">
                  {t('products.salePercent')}
                </label>
                <Input
                  id="bulk-sale-percent"
                  inputMode="decimal"
                  value={salePercent}
                  onChange={(e) => setSalePercent(e.target.value)}
                  placeholder="20"
                />
              </div>
              <Button variant="secondary" onClick={applySalePercent}>
                {t('products.bulkApply')}
              </Button>
            </div>
          </fieldset>
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
              >
                <span className="text-sm font-medium">{r.label}</span>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Input
                    aria-label={`${t('product.price')} — ${r.label}`}
                    inputMode="decimal"
                    value={r.price}
                    onChange={(e) => set(r.id, { price: e.target.value })}
                  />
                  <Input
                    aria-label={`${t('variant.compareAt')} — ${r.label}`}
                    inputMode="decimal"
                    value={r.compareAt}
                    placeholder={t('variant.compareAt')}
                    onChange={(e) => set(r.id, { compareAt: e.target.value })}
                  />
                  <Input
                    aria-label={`${t('variant.lowStock')} — ${r.label}`}
                    inputMode="numeric"
                    value={r.threshold}
                    placeholder={t('variant.lowStock')}
                    onChange={(e) => set(r.id, { threshold: e.target.value })}
                  />
                  <Input
                    aria-label={`${t('products.salePrice')} — ${r.label}`}
                    inputMode="decimal"
                    value={r.sale}
                    placeholder={t('products.salePrice')}
                    onChange={(e) => set(r.id, { sale: e.target.value })}
                  />
                </div>
              </li>
            ))}
          </ul>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="ghost" onClick={() => onClose(false)}>
              {t('action.cancel')}
            </Button>
            <Button disabled={busy} onClick={save}>
              {t('action.save')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
