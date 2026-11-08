// Search from anywhere (ADR 0029, 0034): Ctrl+K or the header's search opens
// the canvas's command palette. What is typed searches orders, products or
// customers in their own lists (each already searches by number, name and
// phone); below, every page the sidebar reaches, grouped as it groups them.
// The arrows move through the results, Enter opens one, Escape closes.
import { useNavigate } from '@tanstack/react-router';
import { type LucideIcon, Package, Search, ShoppingBag, Users } from 'lucide-react';
import { Fragment, type KeyboardEvent, useState } from 'react';
import { useLocale } from '../i18n';
import { type NavTo, useNav } from './nav';
import { usePermission } from './permission-gate';
import { DialogContent, DialogTitle, Dialog as ShadDialog } from './ui/shadcn/dialog';

type Target = { key: string; label: string; icon: LucideIcon; go: () => Promise<void> };
type Group = { key: string; label: string; items: Target[] };

const item =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm leading-5 outline-none hover:bg-accent focus-visible:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';
const kbd =
  'inline-flex h-5 items-center rounded-md bg-muted px-1 font-sans text-xs font-medium text-muted-foreground';

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
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

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
                icon: ShoppingBag,
                go: () => navigate({ to: '/orders', search: { q } }),
              },
            ]
          : []),
        ...(products
          ? [
              {
                key: 'p',
                label: t('search.products', { q }),
                icon: Package,
                go: () => navigate({ to: '/products', search: { q } }),
              },
            ]
          : []),
        ...(customers
          ? [
              {
                key: 'c',
                label: t('search.customers', { q }),
                icon: Users,
                go: () => navigate({ to: '/customers', search: { q } }),
              },
            ]
          : []),
      ]
    : [];
  // "Go to" holds the pages of their own; then each area with its pages. An
  // area's name matches all of its pages.
  const go = (to: NavTo) => () => navigate({ to });
  const items = nav.groups.flatMap((g) => g.items);
  const groups: Group[] = [
    {
      key: 'go',
      label: t('search.pages'),
      items: items
        .filter((i) => !i.children && match(t(i.label)))
        .map((i) => ({ key: i.key, label: t(i.label), icon: i.icon, go: go(i.to) })),
    },
    ...items
      .filter((i) => i.children)
      .map((i) => ({
        key: i.key,
        label: t(i.label),
        items: (i.children ?? [])
          .filter((c) => match(t(c.label)) || match(t(i.label)))
          .map((c) => ({ key: c.to, label: t(c.label), icon: i.icon, go: go(c.to) })),
      })),
  ].filter((g) => g.items.length > 0);
  const first = searches[0] ?? groups[0]?.items[0];

  async function pick(target: Target | undefined) {
    if (!target) return;
    close(false);
    await target.go();
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const box = e.currentTarget;
    const all = Array.from(box.querySelectorAll<HTMLButtonElement>('[data-cmd]'));
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? Math.min(at + 1, all.length - 1) : at - 1;
    if (next < 0) box.querySelector<HTMLInputElement>('input')?.focus();
    else all[next]?.focus();
  }

  return (
    <ShadDialog open={open} onOpenChange={close}>
      <DialogContent
        aria-describedby={undefined}
        onKeyDown={onKey}
        showCloseButton={false}
        className="block gap-0 overflow-hidden rounded-[10px] border-border bg-popover p-0 text-foreground sm:max-w-lg"
      >
        <DialogTitle className="sr-only">{t('search.open')}</DialogTitle>
        <form
          className="flex h-12 items-center gap-2 border-b border-border px-3"
          onSubmit={(e) => {
            e.preventDefault();
            void pick(first);
          }}
        >
          <Search aria-hidden className="size-4 shrink-0 opacity-50" />
          <input
            type="text"
            autoComplete="off"
            aria-label={t('search.open')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:shadow-none md:text-sm"
          />
        </form>
        <div className="max-h-[300px] overflow-y-auto">
          {searches.length > 0 && (
            <fieldset aria-label={t('search.open')} className="p-1">
              <p className="px-2 py-1.5 text-xs leading-4 font-medium text-muted-foreground">
                {t('search.open')}
              </p>
              {searches.map((s) => (
                <button key={s.key} type="button" data-cmd className={item} onClick={() => pick(s)}>
                  <s.icon aria-hidden />
                  {s.label}
                </button>
              ))}
            </fieldset>
          )}
          {groups.map((g, i) => (
            <Fragment key={g.key}>
              {(i > 0 || searches.length > 0) && <div className="h-px bg-border" />}
              <fieldset aria-label={g.label} className="p-1">
                <p className="px-2 py-1.5 text-xs leading-4 font-medium text-muted-foreground">
                  {g.label}
                </p>
                {g.items.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    data-cmd
                    className={item}
                    onClick={() => pick(p)}
                  >
                    <p.icon aria-hidden />
                    {p.label}
                  </button>
                ))}
              </fieldset>
            </Fragment>
          ))}
          {groups.length === 0 && searches.length === 0 && (
            <p className="py-6 text-center text-sm">{t('list.noResults')}</p>
          )}
        </div>
        <div className="hidden h-10 items-center gap-4 border-t border-border px-3 text-xs text-muted-foreground md:flex">
          <span className="inline-flex items-center gap-1.5">
            <kbd className={kbd}>↑</kbd>
            <kbd className={kbd}>↓</kbd>
            {t('search.navigate')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd className={kbd}>↵</kbd>
            {t('search.enter')}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <kbd className={kbd}>esc</kbd>
            {t('action.close')}
          </span>
        </div>
      </DialogContent>
    </ShadDialog>
  );
}
