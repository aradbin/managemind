// Finds a product variant by title or SKU for an order (phase-4-plan §3.12),
// with what is available to sell, so staff see stock before they promise it.
// As the canvas draws it (ADR 0034, .mm-addrow): a dashed "Add a product"
// row that opens a search box and the matching products under it.
import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useLocale } from '../i18n';
import type { InventoryRow } from '../lib/catalog';
import { lineLabel, variantSearchQuery } from '../lib/orders';
import { cn } from '../lib/utils';

export function VariantPicker({
  onPick,
  anyStock = false,
}: {
  onPick: (row: InventoryRow) => void;
  /** Buying and counting: items out of stock can be picked too. */
  anyStock?: boolean;
}) {
  const { t, locale } = useLocale();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useQuery(variantSearchQuery(q));
  const show = (next: boolean) => {
    setOpen(next);
    setText('');
    setQ('');
  };
  return (
    <Popover.Root open={open} onOpenChange={show}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          className="flex h-11 w-full items-center gap-2 rounded-[10px] border border-dashed border-input px-3 text-left text-[15px] text-muted-foreground hover:bg-accent hover:text-foreground md:h-10 md:text-sm"
        >
          <Plus aria-hidden className="size-4" />
          {t('order.addProduct')}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          aria-label={t('order.addProduct')}
          className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-[max(var(--radix-popover-trigger-width),15rem)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-md"
        >
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 md:h-9">
            <Search aria-hidden className="size-4 shrink-0 opacity-50" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the list opened to be searched.
              autoFocus
              type="search"
              aria-label={t('order.searchProducts')}
              aria-controls={listId}
              placeholder={t('order.searchProducts')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:shadow-none md:text-sm"
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={t('order.searchResults')}
            className="max-h-[280px] min-h-0 flex-1 overflow-y-auto p-1"
          >
            {q && results.isPending && (
              <p role="status" className="px-2 py-5 text-center text-sm text-muted-foreground">
                {t('loading')}
              </p>
            )}
            {q && results.data?.length === 0 && (
              <p className="px-2 py-5 text-center text-sm text-muted-foreground">
                {t('order.noProducts')}
              </p>
            )}
            {results.data?.map((row) => {
              const out =
                !anyStock && row.trackInventory && !row.allowBackorder && row.available <= 0;
              return (
                <button
                  key={row.variantId}
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={out}
                  onClick={() => {
                    onPick(row);
                    show(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm leading-5 hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">
                      {lineLabel({ title: row.titles, optionLabels: row.optionLabels }, locale)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[
                        row.sku,
                        row.trackInventory
                          ? t('order.available', { count: row.available })
                          : t('order.notTracked'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
