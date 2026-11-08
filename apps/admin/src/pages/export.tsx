// Catalog export (phase-2-plan §3.7): the browser pages through the API and
// writes the file, so no Worker CPU is spent building it. The columns are
// the import's, so an exported file imports back unchanged (products match
// by SKU, or by handle, which is the default language's slug).
import { type ColumnRef, columnId, exportHeader } from '@managemind/shared/catalog/import';
import { amountToDecimal } from '@managemind/shared/money';
import { type RichTextDoc, richTextToMarkdown } from '@managemind/shared/rich-text';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Notice } from '../components/notice';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog, DialogFooter } from '../components/ui/dialog';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import {
  type Attribute,
  attributesQuery,
  type Category,
  categoriesQuery,
  compact,
  type Product,
  type ProductFilters,
  storeSettingsQuery,
} from '../lib/catalog';
import { download, toCsv } from '../lib/download';
import { errorMessage } from '../lib/errors';
import { cn } from '../lib/utils';

type Locale = 'bn' | 'en';
type Cells = Record<string, string>;

/** Every column the export writes, in order; cost and stock only for those who may see them. */
export function exportColumns(
  attributes: readonly Attribute[],
  options: { cost: boolean; stock: boolean },
): ColumnRef[] {
  const both = (field: ColumnRef['field']): ColumnRef[] => [
    { field, locale: 'bn' },
    { field, locale: 'en' },
  ];
  return [
    { field: 'handle' },
    ...both('title'),
    ...both('slug'),
    ...both('description'),
    ...both('seoTitle'),
    ...both('seoDescription'),
    { field: 'status' },
    { field: 'categories' },
    { field: 'tags' },
    { field: 'brand' },
    { field: 'vatCategory' },
    ...([1, 2, 3] as const).flatMap((n) => [
      ...both(`option${n}Name` as const),
      ...both(`option${n}Value` as const),
    ]),
    { field: 'sku' },
    { field: 'barcode' },
    { field: 'price' },
    { field: 'compareAtPrice' },
    ...(options.cost ? [{ field: 'costPrice' } as const] : []),
    { field: 'weightGrams' },
    ...(options.stock ? [{ field: 'stock' } as const] : []),
    { field: 'trackInventory' },
    { field: 'allowBackorder' },
    { field: 'lowStockThreshold' },
    ...attributes
      .filter((a) => a.key !== 'brand')
      .flatMap((a): ColumnRef[] =>
        a.type === 'text'
          ? [
              { field: 'attribute', attributeKey: a.key, locale: 'bn' },
              { field: 'attribute', attributeKey: a.key, locale: 'en' },
            ]
          : [{ field: 'attribute', attributeKey: a.key }],
      ),
  ];
}

/** One row per variant; product fields only on the product's first row, as the import reads them. */
export function productRows(
  product: Product,
  context: {
    defaultLocale: Locale;
    categories: readonly Category[];
    attributes: readonly Attribute[];
    uiLocale: Locale;
  },
): Cells[] {
  const { defaultLocale, uiLocale } = context;
  const yes = (b: boolean) => (uiLocale === 'bn' ? (b ? 'হ্যাঁ' : 'না') : b ? 'yes' : 'no');
  const byId = new Map(context.categories.map((c) => [c.id, c]));
  const categoryPath = (id: string): string[] => {
    const c = byId.get(id);
    if (!c) return [];
    const name =
      c.translations[defaultLocale]?.name ??
      c.translations.en?.name ??
      c.translations.bn?.name ??
      '';
    return [...(c.parentId ? categoryPath(c.parentId) : []), name];
  };
  const valueLabel = (attributeId: string, valueId: string) => {
    const attribute = context.attributes.find((a) => a.id === attributeId);
    const value = attribute?.values.find((v) => v.id === valueId);
    return value?.label[defaultLocale] ?? value?.label.en ?? value?.label.bn ?? '';
  };

  const first: Cells = { handle: product.translations[defaultLocale]?.slug ?? product.id };
  for (const lang of ['bn', 'en'] as const) {
    const t = product.translations[lang];
    if (!t) continue;
    first[columnId({ field: 'title', locale: lang })] = t.title;
    first[columnId({ field: 'slug', locale: lang })] = t.slug;
    if (t.description)
      first[columnId({ field: 'description', locale: lang })] = richTextToMarkdown(
        t.description as RichTextDoc,
      );
    if (t.seoTitle) first[columnId({ field: 'seoTitle', locale: lang })] = t.seoTitle;
    if (t.seoDescription)
      first[columnId({ field: 'seoDescription', locale: lang })] = t.seoDescription;
  }
  first.status = product.status;
  first.categories = product.categoryIds.map((id) => categoryPath(id).join(' > ')).join(', ');
  first.tags = product.tags.join(', ');
  if (product.vatCategory) first.vatCategory = product.vatCategory;
  for (const a of product.attributes) {
    if (a.key === 'brand') {
      first.brand = a.valueIds.map((id) => valueLabel(a.attributeId, id)).join(', ');
    } else if (a.type === 'text') {
      for (const lang of ['bn', 'en'] as const) {
        if (a.text[lang])
          first[columnId({ field: 'attribute', attributeKey: a.key, locale: lang })] = a.text[
            lang
          ] as string;
      }
    } else {
      const key = columnId({ field: 'attribute', attributeKey: a.key });
      first[key] =
        a.type === 'number'
          ? String(a.number ?? '')
          : a.type === 'boolean'
            ? a.boolean === null
              ? ''
              : yes(a.boolean)
            : a.valueIds.map((id) => valueLabel(a.attributeId, id)).join(', ');
    }
  }
  product.options.forEach((o, i) => {
    for (const lang of ['bn', 'en'] as const) {
      if (o.name[lang])
        first[columnId({ field: `option${i + 1}Name` as 'option1Name', locale: lang })] = o.name[
          lang
        ] as string;
    }
  });

  const values = product.options.flatMap((o, i) => o.values.map((v) => ({ ...v, option: i })));
  return product.variants.map((v, i) => {
    const row: Cells = i === 0 ? { ...first } : { handle: first.handle as string };
    for (const id of v.optionValueIds) {
      const value = values.find((x) => x.id === id);
      if (!value) continue;
      for (const lang of ['bn', 'en'] as const) {
        if (value.label[lang]) {
          row[
            columnId({ field: `option${value.option + 1}Value` as 'option1Value', locale: lang })
          ] = value.label[lang] as string;
        }
      }
    }
    if (v.sku) row.sku = v.sku;
    if (v.barcode) row.barcode = v.barcode;
    row.price = amountToDecimal(v.price);
    if (v.compareAtPrice !== null) row.compareAtPrice = amountToDecimal(v.compareAtPrice);
    if (v.costPrice !== null && v.costPrice !== undefined)
      row.costPrice = amountToDecimal(v.costPrice);
    if (v.weightGrams !== null) row.weightGrams = String(v.weightGrams);
    if (v.stock) row.stock = String(v.stock.onHand);
    row.trackInventory = yes(v.trackInventory);
    row.allowBackorder = yes(v.allowBackorder);
    if (v.lowStockThreshold !== null) row.lowStockThreshold = String(v.lowStockThreshold);
    return row;
  });
}

export { download, toCsv } from '../lib/download';

/** Pages through every product matching the filters. */
async function allProducts(
  filters: ProductFilters,
  onProgress: (n: number) => void,
): Promise<Product[]> {
  const out: Product[] = [];
  let after: string | undefined;
  do {
    const page = unwrap(
      await api.GET('/v1/admin/products/export', {
        params: {
          query: compact({
            ...filters,
            lowStock: filters.lowStock ? ('true' as const) : undefined,
            after,
            limit: 50,
          }),
        },
      }),
    );
    out.push(...page.items);
    onProgress(out.length);
    after = page.nextCursor ?? undefined;
  } while (after);
  return out;
}

export function ExportButton({
  filters,
  selectedIds = [],
  iconOnPhone = false,
  open: controlled,
  onOpenChange,
}: {
  filters: ProductFilters;
  /** The products picked in the list, to export only them. */
  selectedIds?: readonly string[];
  /** On phones the button is an icon, as the phone board draws it. */
  iconOnPhone?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const cost = usePermission('catalog.cost');
  const stock = usePermission('inventory.read');
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (next: boolean) => {
    setOwn(next);
    onOpenChange?.(next);
  };
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [which, setWhich] = useState<'filtered' | 'selected'>('filtered');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const store = useQuery({ ...storeSettingsQuery, enabled: open });
  const categories = useQuery({ ...categoriesQuery, enabled: open });
  const attributes = useQuery({ ...attributesQuery, enabled: open });
  const ready = store.data && categories.data && attributes.data;
  const onlySelected = which === 'selected' && selectedIds.length > 0;

  async function run() {
    if (!store.data || !categories.data || !attributes.data) return;
    setError(undefined);
    setProgress(0);
    try {
      const all = await allProducts(filters, setProgress);
      const products = onlySelected ? all.filter((p) => selectedIds.includes(p.id)) : all;
      const columns = exportColumns(attributes.data, { cost, stock });
      const context = {
        defaultLocale: store.data.defaultLocale,
        categories: categories.data,
        attributes: attributes.data,
        uiLocale: locale,
      };
      const rows = products
        .flatMap((p) => productRows(p, context))
        .map((r) => columns.map((c) => r[columnId(c)] ?? ''));
      const header = columns.map((c) => exportHeader(c, locale));
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'xlsx') {
        const { writeXlsx } = await import('../lib/xlsx');
        download(`products-${stamp}.xlsx`, await writeXlsx(header, rows));
      } else {
        download(
          `products-${stamp}.csv`,
          new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }),
        );
      }
      toast(t('export.done', { count: products.length }));
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size={iconOnPhone ? undefined : 'default'}
        className={iconOnPhone ? 'max-md:w-9 max-md:px-0' : undefined}
        aria-label={t('export.button')}
        onClick={() => setOpen(true)}
      >
        <Download aria-hidden className="size-4" />
        <span className={iconOnPhone ? 'max-md:sr-only' : undefined}>{t('export.button')}</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('export.title')}
        description={t('export.description')}
      >
        {progress !== null ? (
          <p role="status">{t('export.progress', { count: progress })}</p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 font-medium">{t('export.format')}</legend>
              {(['xlsx', 'csv'] as const).map((f) => (
                <label key={f} className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="export-format"
                    checked={format === f}
                    onChange={() => setFormat(f)}
                  />
                  {t(f === 'xlsx' ? 'export.xlsxFile' : 'export.csv')}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 font-medium">{t('export.which')}</legend>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="export-which"
                  checked={!onlySelected}
                  onChange={() => setWhich('filtered')}
                />
                {t('export.matching')}
              </label>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3',
                  selectedIds.length === 0 && 'opacity-50',
                )}
              >
                <input
                  type="radio"
                  name="export-which"
                  disabled={selectedIds.length === 0}
                  checked={onlySelected}
                  onChange={() => setWhich('selected')}
                />
                {t('export.selected', { count: selectedIds.length })}
              </label>
            </fieldset>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter className="pt-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('action.cancel')}
          </Button>
          <Button disabled={!ready || progress !== null} onClick={run}>
            <Download aria-hidden />
            {t('export.button')}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
