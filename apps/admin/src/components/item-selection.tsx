// Which items a promotion's condition or action is about (phase-4-plan
// §3.13): categories, collections and single products, any match counts.
import { useQueries, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import {
  categoriesQuery,
  categoryOptions,
  collectionsQuery,
  pick,
  productQuery,
} from '../lib/catalog';
import type { Selection } from '../lib/promotions';
import { Button } from './ui/button';
import { Input } from './ui/input';

/** The names of what a selection holds, for summaries: categories, collections, then products. */
export function useSelectionNames(selections: Selection[]): (s: Selection) => string[] {
  const { locale } = useLocale();
  const categories = useQuery(categoriesQuery);
  const collections = useQuery(collectionsQuery);
  const ids = [...new Set(selections.flatMap((s) => s.productIds))];
  const products = useQueries({
    queries: ids.map((id) => ({ ...productQuery(id), staleTime: 60_000 })),
  });
  const productName = new Map(
    products.flatMap((p) =>
      p.data ? [[p.data.id, pick(p.data.translations, locale)?.title ?? '—'] as const] : [],
    ),
  );
  return (s) => [
    ...s.categoryIds.map(
      (id) => pick(categories.data?.find((c) => c.id === id)?.translations, locale)?.name ?? '…',
    ),
    ...s.collectionIds.map(
      (id) => pick(collections.data?.find((c) => c.id === id)?.translations, locale)?.name ?? '…',
    ),
    ...s.productIds.map((id) => productName.get(id) ?? '…'),
  ];
}

export function ItemSelection({
  legend,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  value: Selection;
  onChange: (next: Selection) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const categories = useQuery(categoriesQuery);
  const collections = useQuery(collectionsQuery);
  const names = useSelectionNames([value]);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const found = useQuery({
    queryKey: ['product-pick', q] as const,
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/products', { params: { query: { q, limit: 10 } } })).items,
    enabled: q.length > 0,
  });
  const toggle = (key: keyof Selection, itemId: string) => {
    const list = value[key];
    onChange({
      ...value,
      [key]: list.includes(itemId) ? list.filter((x) => x !== itemId) : [...list, itemId],
    });
  };
  const chosen = names(value);
  const all = [
    ...value.categoryIds.map((x) => ['categoryIds', x] as const),
    ...value.collectionIds.map((x) => ['collectionIds', x] as const),
    ...value.productIds.map((x) => ['productIds', x] as const),
  ];
  return (
    <fieldset
      disabled={disabled}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      {all.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('promo.chosen')}>
          {all.map(([key, itemId], i) => (
            <li key={`${key}-${itemId}`}>
              <Button
                variant="secondary"
                className="min-h-9 px-3"
                aria-label={t('promo.removeItem', { item: chosen[i] ?? '' })}
                onClick={() => toggle(key, itemId)}
              >
                {chosen[i]}
                <X aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('promo.addCategory')}
          <select
            className="min-h-11 rounded-md border border-border bg-background px-3 text-base font-normal"
            value=""
            onChange={(e) => e.target.value && toggle('categoryIds', e.target.value)}
          >
            <option value="">{t('place.choose')}</option>
            {categoryOptions(categories.data ?? [], locale)
              .filter((c) => !value.categoryIds.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('promo.addCollection')}
          <select
            className="min-h-11 rounded-md border border-border bg-background px-3 text-base font-normal"
            value=""
            onChange={(e) => e.target.value && toggle('collectionIds', e.target.value)}
          >
            <option value="">{t('place.choose')}</option>
            {(collections.data ?? [])
              .filter((c) => !value.collectionIds.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c.translations, locale)?.name ?? '—'}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {t('promo.addProduct')}
        </label>
        <Input
          id={id}
          type="search"
          autoComplete="off"
          placeholder={t('order.searchProducts')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {found.data && found.data.length > 0 && (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {found.data.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center px-3 text-left hover:bg-muted disabled:opacity-50"
                  disabled={value.productIds.includes(p.id)}
                  onClick={() => {
                    toggle('productIds', p.id);
                    setText('');
                    setQ('');
                  }}
                >
                  {pick(p.titles, locale) ?? '—'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
