// A product's variants: a grid from md, a card per variant on phones
// (phase-2-plan §7). Prices accept Bangla digits, ৳ and separators; cost
// prices show only with catalog.cost; stock only with inventory.read.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { type Product, priceInput, productKeys, readPrice, type Variant } from '../../lib/catalog';
import { saveErrorMessage } from '../../lib/errors';
import { variantLabel } from '../../pages/products';
import { Notice } from '../notice';
import { usePermission } from '../permission-gate';
import { useToast } from '../toast';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface Draft {
  sku: string;
  barcode: string;
  price: string;
  compareAt: string;
  cost: string;
  weight: string;
  threshold: string;
  track: boolean;
  backorder: boolean;
}

const toDraft = (v: Variant): Draft => ({
  sku: v.sku ?? '',
  barcode: v.barcode ?? '',
  price: priceInput(v.price),
  compareAt: priceInput(v.compareAtPrice),
  cost: priceInput(v.costPrice),
  weight: v.weightGrams === null ? '' : String(v.weightGrams),
  threshold: v.lowStockThreshold === null ? '' : String(v.lowStockThreshold),
  track: v.trackInventory,
  backorder: v.allowBackorder,
});

const wholeOrNull = (text: string): number | null | undefined => {
  const t = text.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : undefined;
};

/** The fields of a draft that differ from the variant, ready to send; or an error key. */
function changes(v: Variant, d: Draft, cost: boolean) {
  const price = readPrice(d.price);
  const compareAt = readPrice(d.compareAt);
  const costPrice = cost ? readPrice(d.cost) : null;
  const weight = wholeOrNull(d.weight);
  const threshold = wholeOrNull(d.threshold);
  if (price === undefined || price === null) return { error: 'variant.invalidPrice' as const };
  if (compareAt === undefined || costPrice === undefined)
    return { error: 'variant.invalidPrice' as const };
  if (weight === undefined || threshold === undefined) return { error: 'form.invalid' as const };
  if (compareAt !== null && compareAt <= price)
    return { error: 'variant.compareAtAboveShort' as const };
  const patch: Record<string, unknown> = {};
  if ((d.sku.trim() || null) !== v.sku) patch.sku = d.sku.trim() || null;
  if ((d.barcode.trim() || null) !== v.barcode) patch.barcode = d.barcode.trim() || null;
  if (price !== v.price) patch.price = price;
  if (compareAt !== v.compareAtPrice) patch.compareAtPrice = compareAt;
  if (cost && costPrice !== (v.costPrice ?? null)) patch.costPrice = costPrice;
  if (weight !== v.weightGrams) patch.weightGrams = weight;
  if (threshold !== v.lowStockThreshold) patch.lowStockThreshold = threshold;
  if (d.track !== v.trackInventory) patch.trackInventory = d.track;
  if (d.backorder !== v.allowBackorder) patch.allowBackorder = d.backorder;
  return { patch };
}

/** Remount it (key) when the variants change, so new variants get their drafts. */
export function VariantTable({ product, disabled }: { product: Product; disabled?: boolean }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const cost = usePermission('catalog.cost');
  const stock = usePermission('inventory.read');
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(product.variants.map((v) => [v.id, toDraft(v)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] as Draft), ...patch } }));

  const save = useMutation({
    mutationFn: async () => {
      const found: Record<string, string> = {};
      const patches: [string, Record<string, unknown>][] = [];
      for (const v of product.variants) {
        const result = changes(v, drafts[v.id] as Draft, cost);
        if ('error' in result) found[v.id] = t(result.error as 'form.invalid');
        else if (Object.keys(result.patch).length) patches.push([v.id, result.patch]);
      }
      setErrors(found);
      if (Object.keys(found).length) throw new Error('invalid');
      for (const [id, body] of patches) {
        unwrap(await api.PATCH('/v1/admin/variants/{id}', { params: { path: { id } }, body }));
      }
      return patches.length;
    },
    onSuccess: async (count) => {
      for (const k of productKeys(product.id)) await queryClient.invalidateQueries({ queryKey: k });
      if (count) toast(t('variants.saved', { count }));
    },
  });

  const dirty = product.variants.some((v) => {
    const r = changes(v, drafts[v.id] as Draft, cost);
    return 'error' in r || Object.keys(r.patch).length > 0;
  });
  const label = (v: Variant) => variantLabel(product, v.id, locale);

  const field = (
    v: Variant,
    name: keyof Draft,
    text: string,
    extra: { inputMode?: 'decimal' | 'numeric' } = {},
  ) => (
    <Input
      aria-label={`${text} — ${label(v)}`}
      value={drafts[v.id]?.[name] as string}
      onChange={(e) => set(v.id, { [name]: e.target.value })}
      className="min-w-24"
      {...extra}
    />
  );
  const check = (v: Variant, name: 'track' | 'backorder', text: string) => (
    <input
      type="checkbox"
      className="size-5"
      aria-label={`${text} — ${label(v)}`}
      checked={drafts[v.id]?.[name] as boolean}
      onChange={(e) => set(v.id, { [name]: e.target.checked })}
    />
  );
  const stockCell = (v: Variant) =>
    v.stock ? (
      <Link to="/inventory" search={{ q: v.sku ?? undefined }} className="underline">
        {t('variants.stockSummary', { onHand: v.stock.onHand, available: v.stock.available })}
      </Link>
    ) : null;

  return (
    <section aria-labelledby="variants-heading" className="flex flex-col gap-4">
      <h2 id="variants-heading" className="text-lg font-semibold">
        {t('variants.title')}
      </h2>
      <fieldset disabled={disabled || save.isPending} className="contents">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('variants.title')}</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="p-2">
                  {t('variants.variant')}
                </th>
                <th scope="col" className="p-2">
                  {t('product.price')}
                </th>
                <th scope="col" className="p-2">
                  {t('variant.compareAt')}
                </th>
                {cost && (
                  <th scope="col" className="p-2">
                    {t('variant.cost')}
                  </th>
                )}
                <th scope="col" className="p-2">
                  {t('variant.sku')}
                </th>
                <th scope="col" className="p-2">
                  {t('variant.barcode')}
                </th>
                <th scope="col" className="p-2">
                  {t('variant.weight')}
                </th>
                <th scope="col" className="p-2">
                  {t('variant.lowStock')}
                </th>
                <th scope="col" className="p-2">
                  {t('variant.track')}
                </th>
                <th scope="col" className="p-2">
                  {t('variant.backorder')}
                </th>
                {stock && (
                  <th scope="col" className="p-2">
                    {t('product.stock')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {product.variants.map((v) => (
                <tr key={v.id} className="align-top">
                  <th scope="row" className="p-2 font-medium">
                    {label(v)}
                    {errors[v.id] && (
                      <p role="alert" className="text-xs font-normal text-danger">
                        {errors[v.id]}
                      </p>
                    )}
                  </th>
                  <td className="p-2">
                    {field(v, 'price', t('product.price'), { inputMode: 'decimal' })}
                  </td>
                  <td className="p-2">
                    {field(v, 'compareAt', t('variant.compareAt'), { inputMode: 'decimal' })}
                  </td>
                  {cost && (
                    <td className="p-2">
                      {field(v, 'cost', t('variant.cost'), { inputMode: 'decimal' })}
                    </td>
                  )}
                  <td className="p-2">{field(v, 'sku', t('variant.sku'))}</td>
                  <td className="p-2">{field(v, 'barcode', t('variant.barcode'))}</td>
                  <td className="p-2">
                    {field(v, 'weight', t('variant.weight'), { inputMode: 'numeric' })}
                  </td>
                  <td className="p-2">
                    {field(v, 'threshold', t('variant.lowStock'), { inputMode: 'numeric' })}
                  </td>
                  <td className="p-2">{check(v, 'track', t('variant.track'))}</td>
                  <td className="p-2">{check(v, 'backorder', t('variant.backorder'))}</td>
                  {stock && <td className="p-2">{stockCell(v)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="flex flex-col gap-3 md:hidden" aria-label={t('variants.title')}>
          {product.variants.map((v) => (
            <li key={v.id} className="flex flex-col gap-3 rounded-md border border-border p-3">
              <p className="font-medium">{label(v)}</p>
              {errors[v.id] && (
                <p role="alert" className="text-sm text-danger">
                  {errors[v.id]}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Labelled text={t('product.price')}>
                  {field(v, 'price', t('product.price'), { inputMode: 'decimal' })}
                </Labelled>
                <Labelled text={t('variant.compareAt')}>
                  {field(v, 'compareAt', t('variant.compareAt'), { inputMode: 'decimal' })}
                </Labelled>
                {cost && (
                  <Labelled text={t('variant.cost')}>
                    {field(v, 'cost', t('variant.cost'), { inputMode: 'decimal' })}
                  </Labelled>
                )}
                <Labelled text={t('variant.sku')}>{field(v, 'sku', t('variant.sku'))}</Labelled>
                <Labelled text={t('variant.barcode')}>
                  {field(v, 'barcode', t('variant.barcode'))}
                </Labelled>
                <Labelled text={t('variant.weight')}>
                  {field(v, 'weight', t('variant.weight'), { inputMode: 'numeric' })}
                </Labelled>
                <Labelled text={t('variant.lowStock')}>
                  {field(v, 'threshold', t('variant.lowStock'), { inputMode: 'numeric' })}
                </Labelled>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="flex items-center gap-2">
                  {check(v, 'track', t('variant.track'))}
                  {t('variant.track')}
                </span>
                <span className="flex items-center gap-2">
                  {check(v, 'backorder', t('variant.backorder'))}
                  {t('variant.backorder')}
                </span>
              </div>
              {stock && <p className="text-sm">{stockCell(v)}</p>}
            </li>
          ))}
        </ul>
      </fieldset>
      {save.isError && save.error.message !== 'invalid' && (
        <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>
      )}
      {dirty && (
        <div>
          <Button disabled={disabled || save.isPending} onClick={() => save.mutate()}>
            {t('variants.save')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** A visible caption over an input that already has its accessible name. */
function Labelled({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span aria-hidden className="text-xs text-muted-foreground">
        {text}
      </span>
      {children}
    </div>
  );
}
