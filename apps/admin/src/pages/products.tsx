// The product list (phase-2-plan §7, PR 9): search and filters, cards on
// phones and a table from md, and selection for a bulk price edit.
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ImageOff, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CatalogNav } from '../components/catalog-nav';
import { type Column, DataList } from '../components/data-list';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import {
  attributesQuery,
  categoriesQuery,
  categoryOptions,
  formatRange,
  type Product,
  type ProductFilters,
  type ProductSummary,
  pick,
  priceInput,
  productQuery,
  productsQuery,
  readPrice,
} from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { ExportButton } from './export';

export type ProductSearch = ProductFilters;

const selectClass =
  'min-h-11 rounded-md border border-border bg-background px-3 text-base md:text-sm';

export function ProductsPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as ProductSearch;
  const navigate = useNavigate();
  const canWrite = usePermission('catalog.write');
  const canStock = usePermission('inventory.read');
  const [q, setQ] = useState(search.q ?? '');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState(false);

  const setFilter = (patch: Partial<ProductSearch>) =>
    navigate({
      to: '/products',
      search: (prev: ProductSearch) => {
        const next = { ...prev, ...patch };
        return Object.fromEntries(
          Object.entries(next).filter(([, v]) => v !== undefined && v !== '' && v !== false),
        );
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

  const products = useInfiniteQuery(productsQuery(search));
  const categories = useQuery(categoriesQuery);
  const attributes = useQuery(attributesQuery);
  const brand = attributes.data?.find((a) => a.key === 'brand');
  const items = useMemo(() => products.data?.pages.flatMap((p) => p.items) ?? [], [products.data]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns: Column<ProductSummary>[] = [
    {
      header: t('product.title'),
      cell: (p) => (
        <span className="flex items-center gap-3">
          {canWrite && (
            <input
              type="checkbox"
              className="size-5 shrink-0"
              aria-label={t('products.select', { title: pick(p.titles, locale) ?? '' })}
              checked={selected.has(p.id)}
              onChange={() => toggle(p.id)}
            />
          )}
          <Thumbnail file={p.imageFile} />
          <Link
            to="/products/$id"
            params={{ id: p.id }}
            className="font-medium underline-offset-2 hover:underline"
          >
            {pick(p.titles, locale) ?? t('product.untitled')}
          </Link>
        </span>
      ),
    },
    { header: t('product.status'), cell: (p) => <StatusBadge status={p.status} /> },
    { header: t('product.price'), cell: (p) => formatRange(p.minPrice, p.maxPrice, locale) },
    { header: t('product.variants'), cell: (p) => p.variantCount },
    ...(canStock
      ? [
          {
            header: t('product.stock'),
            cell: (p: ProductSummary) =>
              p.available === null || p.available === undefined ? (
                '—'
              ) : (
                <span className={p.lowStock ? 'font-semibold text-danger' : undefined}>
                  {p.available}
                  {p.lowStock && <span className="sr-only"> ({t('inventory.low')})</span>}
                </span>
              ),
          },
        ]
      : []),
  ];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('catalog.products')}
        actions={
          <>
            <ExportButton filters={search} />
            {canWrite && selected.size > 0 && (
              <Button variant="secondary" onClick={() => setBulk(true)}>
                {t('products.bulkEdit', { count: selected.size })}
              </Button>
            )}
            {canWrite && (
              <Button asChild>
                <Link to="/products/new">
                  <Plus aria-hidden className="size-4" />
                  {t('products.new')}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <CatalogNav />
      <div className="mb-4 grid gap-2 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
        <Input
          type="search"
          aria-label={t('products.search')}
          placeholder={t('products.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label={t('product.status')}
          className={selectClass}
          value={search.status ?? ''}
          onChange={(e) =>
            setFilter({ status: (e.target.value || undefined) as ProductSearch['status'] })
          }
        >
          <option value="">{t('products.allStatuses')}</option>
          <option value="active">{t('status.active')}</option>
          <option value="draft">{t('status.draft')}</option>
          <option value="archived">{t('status.archived')}</option>
        </select>
        <select
          aria-label={t('catalog.category')}
          className={selectClass}
          value={search.categoryId ?? ''}
          onChange={(e) => setFilter({ categoryId: e.target.value || undefined })}
        >
          <option value="">{t('products.allCategories')}</option>
          {categoryOptions(categories.data ?? [], locale).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {brand && brand.values.length > 0 && (
          <select
            aria-label={pick(brand.name, locale) ?? t('attribute.brand')}
            className={selectClass}
            value={search.brandValueId ?? ''}
            onChange={(e) => setFilter({ brandValueId: e.target.value || undefined })}
          >
            <option value="">{t('products.allBrands')}</option>
            {brand.values.map((v) => (
              <option key={v.id} value={v.id}>
                {pick(v.label, locale)}
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap items-center gap-4 md:col-span-4">
          {search.tag && (
            <Button variant="secondary" onClick={() => setFilter({ tag: undefined })}>
              {t('products.tagFilter', { tag: search.tag })} ×
            </Button>
          )}
          {canStock && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={Boolean(search.lowStock)}
                onChange={(e) => setFilter({ lowStock: e.target.checked || undefined })}
              />
              {t('products.lowStockOnly')}
            </label>
          )}
        </div>
      </div>
      <DataList
        label={t('catalog.products')}
        items={items}
        rowKey={(p) => p.id}
        columns={columns}
        isPending={products.isPending}
        error={products.isError ? errorMessage(products.error, t) : undefined}
        onRetry={() => products.refetch()}
        empty={
          search.q || search.status || search.categoryId
            ? t('products.noMatches')
            : t('products.empty')
        }
        hasMore={products.hasNextPage}
        loadingMore={products.isFetchingNextPage}
        onLoadMore={() => products.fetchNextPage()}
      />
      {bulk && (
        <BulkPriceDialog
          productIds={[...selected]}
          onClose={(saved) => {
            setBulk(false);
            if (saved) setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: 'draft' | 'active' | 'archived' }) {
  const { t } = useLocale();
  const tone =
    status === 'active'
      ? 'bg-success/15 text-success'
      : status === 'draft'
        ? 'bg-muted text-muted-foreground'
        : 'bg-warning/20 text-warning-foreground';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {t(`status.${status}`)}
    </span>
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
      className={`${size} shrink-0 rounded object-cover`}
    />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded bg-muted`}>
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
  original: { price: number; compareAtPrice: number | null; lowStockThreshold: number | null };
}

/** Price, compare-at and low-stock threshold for every variant of the selected products. */
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
              original: {
                price: v.price,
                compareAtPrice: v.compareAtPrice,
                lowStockThreshold: v.lowStockThreshold,
              },
            }))
          : [],
      ),
    );
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

  async function save() {
    if (!rows) return;
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
      const edit: {
        id: string;
        price?: number;
        compareAtPrice?: number | null;
        lowStockThreshold?: number | null;
      } = { id: r.id };
      if (price !== r.original.price) edit.price = price;
      if (compareAt !== r.original.compareAtPrice) edit.compareAtPrice = compareAt;
      if (threshold !== r.original.lowStockThreshold) edit.lowStockThreshold = threshold;
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
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <span className="text-sm font-medium">{r.label}</span>
                <div className="grid grid-cols-3 gap-2">
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
