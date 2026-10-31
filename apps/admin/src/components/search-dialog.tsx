// Search from anywhere (ADR 0029): Ctrl+K or the top bar's search opens it.
// What is typed searches orders, products or customers in their own lists
// (each already searches by number, name and phone), and matches page names.
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useLocale } from '../i18n';
import { type NavTo, useNav } from './nav';
import { usePermission } from './permission-gate';
import { Dialog } from './ui/dialog';

type Target = { key: string; label: string; go: () => Promise<void> };

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const nav = useNav();
  const [query, setQuery] = useState('');
  const orders = usePermission('orders.read');
  const products = usePermission('catalog.read');
  const customers = usePermission('customers.read');
  const q = query.trim();

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) setQuery('');
  };
  const searches: Target[] = q
    ? [
        ...(orders
          ? [
              {
                key: 'o',
                label: t('search.orders', { q }),
                go: () => navigate({ to: '/orders', search: { q } }),
              },
            ]
          : []),
        ...(products
          ? [
              {
                key: 'p',
                label: t('search.products', { q }),
                go: () => navigate({ to: '/products', search: { q } }),
              },
            ]
          : []),
        ...(customers
          ? [
              {
                key: 'c',
                label: t('search.customers', { q }),
                go: () => navigate({ to: '/customers', search: { q } }),
              },
            ]
          : []),
      ]
    : [];
  // Every page the sidebar lists; an area's pages read "Catalog › Products".
  const all: { to: NavTo; label: string }[] = nav.groups.flatMap((g) =>
    g.items.flatMap((i) =>
      i.children
        ? i.children.map((c) => ({ to: c.to, label: `${t(i.label)} › ${t(c.label)}` }))
        : [{ to: i.to, label: t(i.label) }],
    ),
  );
  const seen = new Set<string>();
  const pages: Target[] = all
    .filter((i) => !seen.has(i.to) && seen.add(i.to))
    .filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()))
    .map((i) => ({ key: i.to, label: i.label, go: () => navigate({ to: i.to }) }));

  async function pick(target: Target | undefined) {
    if (!target) return;
    close(false);
    await target.go();
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void pick(searches[0] ?? pages[0]);
  }

  const row =
    'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-muted focus-visible:bg-muted';
  return (
    <Dialog open={open} onOpenChange={close} title={t('search.open')}>
      <form onSubmit={submit}>
        <label className="flex min-h-12 items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:outline-2 focus-within:outline-ring">
          <Search aria-hidden className="size-5 text-muted-foreground" />
          <span className="sr-only">{t('search.open')}</span>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </label>
      </form>
      {!q && <p className="text-sm text-muted-foreground">{t('search.hint')}</p>}
      {searches.length > 0 && (
        <ul className="flex flex-col gap-1">
          {searches.map((s) => (
            <li key={s.key}>
              <button type="button" className={row} onClick={() => pick(s)}>
                <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{s.label}</span>
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {pages.length > 0 && (
        <section aria-labelledby="search-pages" className="flex flex-col gap-1">
          <h3 id="search-pages" className="px-3 text-xs font-semibold text-muted-foreground">
            {t('search.pages')}
          </h3>
          <ul className="flex flex-col gap-1">
            {pages.map((p) => (
              <li key={p.key}>
                <button type="button" className={row} onClick={() => pick(p)}>
                  <span className="flex-1 truncate">{p.label}</span>
                  <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
