// The owner's setup checklist on the dashboard (phase-5b-plan §3.2, §7):
// what the store still needs before its first order, each item linked to
// where it is done, until every required item is done. Compact since the
// redesign (ADR 0029): progress and the next step, the full list on demand.
import { formatNumber } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Circle, CircleCheck } from 'lucide-react';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/launch';
import { api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { usePermission } from './permission-gate';
import { Button } from './ui/button';

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
    <section
      aria-labelledby="setup-card-h"
      className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5"
    >
      <div className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="relative inline-flex size-12 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(var(--color-primary) ${share}%, var(--color-muted) 0)`,
          }}
        >
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-background text-xs font-semibold tabular-nums">
            {formatNumber(locale, done)}/{formatNumber(locale, total)}
          </span>
        </span>
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
          <h2 id="setup-card-h" className="font-semibold">
            {t('setup.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('setup.intro', { done, total })}</p>
        </div>
        {next && (
          <Button asChild>
            <Link to={WHERE[next.item as keyof typeof WHERE]}>
              {t('setup.next', { item: t(`checklist.item.${next.item}` as AdminKey) })}
            </Link>
          </Button>
        )}
      </div>
      <details className="group border-t border-border pt-2">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-primary">
          <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
          {t('setup.allSteps')}
        </summary>
        <ul className="flex flex-col gap-1 pt-1">
          {items.map((i) => {
            const label = t(`checklist.item.${i.item}` as AdminKey);
            const to = i.item in WHERE ? WHERE[i.item as keyof typeof WHERE] : undefined;
            return (
              <li key={i.item} className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
                {i.done ? (
                  <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
                ) : (
                  <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                )}
                <span className="sr-only">{t(i.done ? 'checklist.done' : 'checklist.todo')}: </span>
                <span className="min-w-0 flex-1">
                  {!i.done && to ? (
                    <Link to={to} className="text-primary underline-offset-2 hover:underline">
                      {label}
                    </Link>
                  ) : (
                    <span className={i.done ? 'text-muted-foreground' : ''}>{label}</span>
                  )}
                  {i.optional && (
                    <span className="ms-2 text-sm text-muted-foreground">
                      ({t('checklist.optional')})
                    </span>
                  )}
                </span>
                {i.item === 'domain' && !i.done && canWrite && host && (
                  <Button
                    variant="secondary"
                    disabled={keep.isPending}
                    onClick={() => keep.mutate()}
                  >
                    {t('setup.keepSubdomain', { host })}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
