// Switch store (phase-1-plan §7.3): a sheet on phones, a dialog on larger
// screens, with search once there are more than 5 stores. Stores reached
// through a support grant show until when. The trigger takes the look of
// where it sits (ADR 0033): the top of the sidebar, the phone header, or a
// row on the Menu page.
import { formatDateTime } from '@managemind/shared/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { useLocale } from '../i18n';
import type { Me } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { switchStore } from '../lib/store';
import { cn } from '../lib/utils';
import { Field } from './field';
import { Notice } from './notice';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

const SEARCH_FROM = 6;

/** Up to two letters for a store's tile: the first of its first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase();
}

/** A store's tile in the store list: its initials. */
export function StoreTile({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-xs font-semibold text-primary-foreground',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** The platform's mark, as the canvas draws it at the top of the sidebar and the phone header. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-sidebar-primary text-sm font-semibold text-primary-foreground dark:text-white',
        className,
      )}
    >
      m
    </span>
  );
}

export function StoreSwitcher({
  me,
  look = 'header',
}: {
  me: Me;
  look?: 'header' | 'sidebar' | 'row';
}) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const current = me.stores.find((s) => s.tenantId === me.activeStore);
  const q = query.trim().toLowerCase();
  const stores = q
    ? me.stores.filter((s) => s.name.toLowerCase().includes(q) || s.slug.includes(q))
    : me.stores;

  async function choose(tenantId: string) {
    if (tenantId === me.activeStore) return setOpen(false);
    setBusy(true);
    setError(undefined);
    try {
      await switchStore(queryClient, tenantId);
      // Everything else on screen belonged to the other store.
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      setOpen(false);
      await navigate({ to: '/' });
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (me.stores.length === 0) return <p className="truncate font-medium">{me.user.name}</p>;
  const label = `${t('store.switch')}: ${current?.name ?? ''}`;
  return (
    <>
      {look === 'header' ? (
        <Button
          variant="ghost"
          className="min-w-0 max-w-full justify-start gap-2 pr-2 pl-1 has-[>svg]:pr-2 has-[>svg]:pl-1"
          aria-label={label}
          onClick={() => setOpen(true)}
        >
          <BrandMark className="size-7 rounded-lg" />
          <span className="truncate font-semibold">{current?.name ?? t('store.switch')}</span>
          <ChevronsUpDown aria-hidden className="!size-4 shrink-0" />
        </Button>
      ) : (
        <button
          type="button"
          aria-label={label}
          onClick={() => setOpen(true)}
          className={cn(
            'flex w-full min-w-0 items-center text-left hover:bg-accent',
            look === 'sidebar' ? 'h-12 gap-2 rounded-lg p-2' : 'min-h-16 gap-3 px-3 py-2',
          )}
        >
          {look === 'sidebar' ? (
            <BrandMark />
          ) : (
            current && (
              <StoreTile
                name={current.name}
                className="size-10 rounded-full text-[13px] font-medium"
              />
            )
          )}
          <span className="flex min-w-0 flex-1 flex-col leading-4">
            <span className="truncate text-sm leading-5 font-semibold">
              {current?.name ?? t('store.switch')}
            </span>
            {current && (
              <span
                className={cn(
                  'truncate text-muted-foreground',
                  look === 'sidebar' ? 'text-xs' : 'text-[13px] leading-[18px]',
                )}
              >
                {look === 'sidebar'
                  ? t(`role.${current.role}`)
                  : `${t(`role.${current.role}`)} · ${t('store.switch')}`}
              </span>
            )}
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0" />
        </button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
        title={t('store.switch')}
      >
        {me.stores.length >= SEARCH_FROM && (
          <Field
            label={t('store.search')}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {stores.length === 0 ? (
          <p className="text-muted-foreground">{t('store.none')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {stores.map((s) => {
              const active = s.tenantId === me.activeStore;
              return (
                <li key={s.tenantId}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => choose(s.tenantId)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted disabled:opacity-50"
                  >
                    <StoreTile name={s.name} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{s.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {s.supportUntil
                          ? t('store.supportUntil', {
                              time: formatDateTime(locale, new Date(s.supportUntil), {
                                timeStyle: 'short',
                              }),
                            })
                          : t(`role.${s.role}`)}
                      </span>
                    </span>
                    {active && <Check aria-hidden className="size-5 shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>
    </>
  );
}
