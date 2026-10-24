// The owner's setup checklist on the dashboard (phase-5b-plan §3.2, §7):
// what the store still needs before its first order, each item linked to
// where it is done, until every required item is done.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, Circle } from 'lucide-react';
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
  const { t } = useLocale();
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
  return (
    <section
      aria-labelledby="setup-card-h"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <h2 id="setup-card-h" className="font-semibold">
        {t('setup.title')}
      </h2>
      <p className="text-muted-foreground">
        {t('setup.intro', { done: setup.data.done, total: setup.data.total })}
      </p>
      <ul className="flex flex-col gap-2">
        {setup.data.items.map((i) => {
          const label = t(`checklist.item.${i.item}` as AdminKey);
          const to = i.item in WHERE ? WHERE[i.item as keyof typeof WHERE] : undefined;
          return (
            <li key={i.item} className="flex flex-wrap items-center gap-2">
              {i.done ? (
                <Check aria-hidden className="size-5 shrink-0 text-success" />
              ) : (
                <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              )}
              <span className="sr-only">{t(i.done ? 'checklist.done' : 'checklist.todo')}: </span>
              {!i.done && to ? (
                <Link to={to} className="text-primary underline-offset-2 hover:underline">
                  {label}
                </Link>
              ) : (
                <span className={i.done ? 'text-muted-foreground' : ''}>{label}</span>
              )}
              {i.optional && (
                <span className="text-sm text-muted-foreground">({t('checklist.optional')})</span>
              )}
              {i.item === 'domain' && !i.done && canWrite && host && (
                <Button variant="ghost" disabled={keep.isPending} onClick={() => keep.mutate()}>
                  {t('setup.keepSubdomain', { host })}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
