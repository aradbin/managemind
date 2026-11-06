// A product's variants: a grid from md, a card per variant on phones
// (phase-2-plan §7). Prices accept Bangla digits, ৳ and separators; cost
// prices show only with catalog.cost; stock only with inventory.read.

import { formatNumber } from '@managemind/shared/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { type Product, priceInput, productKeys, readPrice, type Variant } from '../../lib/catalog';
import { saveErrorMessage } from '../../lib/errors';
import { variantLabel } from '../../pages/products';
import { Field } from '../field';
import { usePermission } from '../permission-gate';
import { useToast } from '../toast';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Sheet, SheetBody, SheetFooter } from '../ui/sheet';
import { Switch } from '../ui/switch';

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

  const [editing, setEditing] = useState<Variant | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [allPrice, setAllPrice] = useState('');
  const isLow = (v: Variant) =>
    v.trackInventory &&
    v.stock !== undefined &&
    v.lowStockThreshold !== null &&
    v.stock.available <= v.lowStockThreshold;

  return (
    <fieldset disabled={disabled || save.isPending} className="m-0 min-w-0 border-0 p-0">
      {/* "Set all prices", as drawn above the table. */}
      <div className="flex min-h-11 items-center justify-end gap-2 border-b border-border px-4 py-1.5 md:px-5">
        {allOpen ? (
          <>
            <span className="mr-auto text-muted-foreground">{t('variants.setEvery')}</span>
            <span className="relative block w-[120px]">
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
              >
                ৳
              </span>
              <Input
                inputMode="decimal"
                aria-label={t('variants.everyPrice')}
                className="h-8 pl-[22px] md:h-8"
                value={allPrice}
                onChange={(e) => setAllPrice(e.target.value)}
              />
            </span>
            <Button variant="secondary" onClick={() => setAllOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              disabled={!allPrice.trim()}
              onClick={() => {
                for (const v of product.variants) set(v.id, { price: allPrice });
                setAllOpen(false);
                setAllPrice('');
              }}
            >
              {t('variants.apply')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" className="-mr-2.5 px-2.5" onClick={() => setAllOpen(true)}>
            {t('variants.setAll')}
          </Button>
        )}
      </div>
      <table className="w-full border-collapse">
        <caption className="sr-only">{t('variants.title')}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="h-10 px-2 pl-4 text-left font-medium md:pl-5">
              {t('variants.variant')}
            </th>
            <th scope="col" className="h-10 w-[140px] px-2 text-left font-medium">
              {t('product.price')}
            </th>
            {stock && (
              <th scope="col" className="h-10 w-[110px] px-2 text-right font-medium">
                {t('productView.available')}
              </th>
            )}
            <th scope="col" className="h-10 w-12 px-2 pr-4">
              <span className="sr-only">{t('variants.edit')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {product.variants.map((v) => (
            <tr key={v.id} className="border-b border-border last:border-b-0">
              <th scope="row" className="px-2 py-2 pl-4 text-left font-medium md:pl-5">
                {label(v)}
                {errors[v.id] && (
                  <span role="alert" className="block text-xs font-normal text-danger">
                    {errors[v.id]}
                  </span>
                )}
              </th>
              <td className="px-2 py-2">
                <span className="relative block">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
                  >
                    ৳
                  </span>
                  <Input
                    inputMode="decimal"
                    aria-label={`${t('product.price')} — ${label(v)}`}
                    className="h-8 pl-[22px] tabular-nums md:h-8"
                    value={drafts[v.id]?.price ?? ''}
                    onChange={(e) => set(v.id, { price: e.target.value })}
                  />
                </span>
              </td>
              {stock && (
                <td className="px-2 py-2 text-right tabular-nums">
                  {v.stock && v.trackInventory ? (
                    isLow(v) ? (
                      <span className="font-medium text-danger">
                        {formatNumber(locale, v.stock.available)}
                        <span className="sr-only"> ({t('inventory.lowBadge')})</span>
                      </span>
                    ) : (
                      formatNumber(locale, v.stock.available)
                    )
                  ) : (
                    '—'
                  )}
                </td>
              )}
              <td className="px-2 py-2 pr-4 text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 md:size-8"
                  aria-haspopup="dialog"
                  aria-label={t('variants.editOne', { variant: label(v) })}
                  onClick={() => setEditing(v)}
                >
                  <Pencil aria-hidden />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(dirty || save.isError) && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 md:px-5">
          {save.isError && save.error.message !== 'invalid' && (
            <span className="mr-auto text-sm text-danger">{saveErrorMessage(save.error, t)}</span>
          )}
          <Button disabled={disabled || save.isPending} onClick={() => save.mutate()}>
            {t('variants.save')}
          </Button>
        </div>
      )}
      {editing && (
        <Sheet
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title={label(editing)}
          description={t('variants.editHint')}
        >
          <SheetBody>
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={t('variant.compareAt')}
                hint={t('variants.compareAtHint')}
                inputMode="decimal"
                value={drafts[editing.id]?.compareAt ?? ''}
                onChange={(e) => set(editing.id, { compareAt: e.target.value })}
              />
              {cost && (
                <Field
                  label={t('variant.cost')}
                  inputMode="decimal"
                  value={drafts[editing.id]?.cost ?? ''}
                  onChange={(e) => set(editing.id, { cost: e.target.value })}
                />
              )}
              <Field
                label={t('variant.sku')}
                value={drafts[editing.id]?.sku ?? ''}
                onChange={(e) => set(editing.id, { sku: e.target.value })}
              />
              <Field
                label={t('variant.barcode')}
                value={drafts[editing.id]?.barcode ?? ''}
                onChange={(e) => set(editing.id, { barcode: e.target.value })}
              />
              <Field
                label={t('variant.weight')}
                inputMode="numeric"
                value={drafts[editing.id]?.weight ?? ''}
                onChange={(e) => set(editing.id, { weight: e.target.value })}
              />
              <Field
                label={t('variant.lowStock')}
                inputMode="numeric"
                value={drafts[editing.id]?.threshold ?? ''}
                onChange={(e) => set(editing.id, { threshold: e.target.value })}
              />
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4">
              <label htmlFor="variant-track" className="cursor-pointer">
                {t('variant.track')}
              </label>
              <Switch
                id="variant-track"
                checked={drafts[editing.id]?.track ?? false}
                onCheckedChange={(on) => set(editing.id, { track: on })}
              />
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4">
              <label htmlFor="variant-backorder" className="cursor-pointer">
                {t('variant.backorder')}
              </label>
              <Switch
                id="variant-backorder"
                checked={drafts[editing.id]?.backorder ?? false}
                onCheckedChange={(on) => set(editing.id, { backorder: on })}
              />
            </div>
            {editing.stock && (
              <Link
                to="/inventory"
                search={{ q: editing.sku ?? undefined }}
                className="text-sm underline underline-offset-4"
              >
                {t('variants.stockSummary', {
                  onHand: editing.stock.onHand,
                  available: editing.stock.available,
                })}
              </Link>
            )}
          </SheetBody>
          <SheetFooter>
            <Button onClick={() => setEditing(null)}>{t('variants.done')}</Button>
          </SheetFooter>
        </Sheet>
      )}
    </fieldset>
  );
}
