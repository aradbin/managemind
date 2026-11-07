// The owner's setup checklist on the dashboard (phase-5b-plan §3.2, §7):
// what the store still needs before its first order, each item linked to
// where it is done, until every required item is done. Compact since the
// redesign (ADR 0029): progress and the next step, the full list on demand,
// as the canvas draws it (ADR 0034).
import { formatNumber } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/launch';
import { api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { cn } from '../lib/utils';
import { usePermission } from './permission-gate';
import { Button } from './ui/button';
import { cardPadded, cardTitle } from './ui/card';

type Item =
  | 'profile'
  | 'logo'
  | 'products'
  | 'delivery'
  | 'payments'
  | 'legal'
  | 'email'
  | 'sms'
  | 'domain'
  | 'terms';

/** Where each item is done. Terms are accepted from the prompt every owner sees. */
const WHERE = {
  profile: '/settings/store',
  logo: '/online-store/theme',
  products: '/products/new',
  delivery: '/settings/delivery',
  payments: '/settings/payments',
  legal: '/online-store/pages',
  email: '/settings/messages',
  sms: '/settings/messages',
  domain: '/settings/domains',
} as const satisfies Partial<Record<Item, string>>;

export const setupQuery = {
  queryKey: ['setup'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/setup')),
};

export function SetupCard() {
  const { t, locale } = useLocale();
  const canRead = usePermission('settings.read');
  const canWrite = usePermission('settings.write');
  const queryClient = useQueryClient();
  const setup = useQuery({ ...setupQuery, enabled: canRead });
  const [open, setOpen] = useState(false);
  const listId = useId();
  const store = useQuery({ ...storeSettingsQuery, enabled: canRead });
  const keep = useMutation({
    mutationFn: async () =>
      unwrap(await api.PATCH('/v1/admin/store', { body: { setup: { subdomainFinal: true } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['setup'] });
      await queryClient.invalidateQueries({ queryKey: ['store'] });
    },
  });
  if (!setup.data || setup.data.complete) return null;
  const host = store.data ? new URL(store.data.storeUrl).host : '';
  const { done, total, items } = setup.data;
  const next = items.find((i) => !i.done && !i.optional && i.item in WHERE);
  const share = total ? Math.round((done / total) * 100) : 0;
  return (
    <section aria-labelledby="setup-card-h" className={cn(cardPadded, 'gap-3.5 md:gap-3.5')}>
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="relative inline-flex size-11 shrink-0 rounded-full"
          style={{
            background: `conic-gradient(var(--color-primary) ${share}%, var(--color-muted) 0)`,
          }}
        >
          <span className="absolute inset-[5px] flex items-center justify-center rounded-full bg-card text-[11px] font-semibold tabular-nums">
            {formatNumber(locale, share)}%
          </span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="setup-card-h" className={cardTitle}>
            {t('setup.title')}
          </h2>
          <p className="text-[13px] text-muted-foreground">{t('setup.intro', { done, total })}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {next && (
          <Button asChild className="max-md:flex-1">
            <Link to={WHERE[next.item as keyof typeof WHERE]}>
              {t('setup.next', { item: t(`checklist.item.${next.item}` as AdminKey) })}
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        )}
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen(!open)}
          className="[&[aria-expanded=true]>svg]:rotate-180"
        >
          {t('setup.allSteps')}
          <ChevronDown aria-hidden className="transition-transform duration-200" />
        </Button>
      </div>
      {open && (
        <>
          <ul id={listId} className="flex flex-col">
            {items.map((i) => {
              const label = t(`checklist.item.${i.item}` as AdminKey);
              const to = i.item in WHERE ? WHERE[i.item as keyof typeof WHERE] : undefined;
              return (
                <li key={i.item} className="flex min-h-9 items-center gap-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-border',
                      i.done && 'border-success bg-success text-white',
                    )}
                  >
                    {i.done && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="sr-only">
                    {t(i.done ? 'checklist.done' : 'checklist.todo')}:{' '}
                  </span>
                  {!i.done && to ? (
                    <Link to={to} className="underline underline-offset-[3px]">
                      {label}
                    </Link>
                  ) : (
                    <span className={i.done ? 'text-muted-foreground' : ''}>{label}</span>
                  )}
                  {i.optional && (
                    <span className="text-xs text-muted-foreground">
                      ({t('checklist.optional')})
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {items.some((i) => i.item === 'domain' && !i.done) && canWrite && host && (
            <Button
              variant="secondary"
              className="self-start"
              disabled={keep.isPending}
              onClick={() => keep.mutate()}
            >
              {t('setup.keepSubdomain', { host })}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
