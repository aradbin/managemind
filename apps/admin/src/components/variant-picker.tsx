// Finds a product variant by title or SKU for an order (phase-4-plan §3.12),
// with what is available to sell, so staff see stock before they promise it.
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useLocale } from '../i18n';
import type { InventoryRow } from '../lib/catalog';
import { lineLabel, variantSearchQuery } from '../lib/orders';
import { Input } from './ui/input';

export function VariantPicker({ onPick }: { onPick: (row: InventoryRow) => void }) {
  const { t, locale } = useLocale();
  const id = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useQuery(variantSearchQuery(q));
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {t('order.addProduct')}
      </label>
      <Input
        id={id}
        type="search"
        placeholder={t('order.searchProducts')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
      {q && results.isPending && <p role="status">{t('loading')}</p>}
      {q && results.data && results.data.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('order.noProducts')}</p>
      )}
      {results.data && results.data.length > 0 && (
        <ul
          aria-label={t('order.searchResults')}
          className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border"
        >
          {results.data.map((row) => {
            const out = row.trackInventory && !row.allowBackorder && row.available <= 0;
            return (
              <li key={row.variantId}>
                <button
                  type="button"
                  disabled={out}
                  onClick={() => {
                    onPick(row);
                    setText('');
                    setQ('');
                  }}
                  className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted disabled:opacity-50"
                >
                  <Plus aria-hidden className="size-4 shrink-0" />
                  <span className="flex flex-1 flex-col">
                    <span>
                      {lineLabel({ title: row.titles, optionLabels: row.optionLabels }, locale)}
                    </span>
                    {row.sku && <span className="text-xs text-muted-foreground">{row.sku}</span>}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {row.trackInventory
                      ? t('order.available', { count: row.available })
                      : t('order.notTracked')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
