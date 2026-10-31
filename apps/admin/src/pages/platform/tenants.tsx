// Platform: stores (phase-1-plan §7.3), searched by name or address and
// filtered by status, with their plan and setup progress (phase-5b-plan
// §3.2); super admins open the New store page.
import { formatDateTime } from '@managemind/shared/i18n';
import { useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { DataList } from '../../components/data-list';
import { Field } from '../../components/field';
import { PageHeader } from '../../components/page-header';
import { useLocale } from '../../i18n';
import '../../i18n/launch';
import { api, meQuery, unwrap } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { StatusBadge, TENANT_STATUSES, type TenantStatus } from './status';

type Tenant = Awaited<ReturnType<typeof fetchTenants>>['items'][number];

async function fetchTenants(q: string, status: TenantStatus | '', after?: string) {
  return unwrap(
    await api.GET('/v1/platform/tenants', {
      params: {
        query: {
          limit: 50,
          ...(q ? { q } : {}),
          ...(status ? { status } : {}),
          ...(after ? { after } : {}),
        },
      },
    }),
  );
}

/** The value after the user stops typing for a moment. */
function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function TenantsPage() {
  const { t, locale } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<TenantStatus | ''>('');
  const q = useDebounced(query.trim());
  const tenants = useInfiniteQuery({
    queryKey: ['platform', 'tenants', q, status],
    queryFn: ({ pageParam }) => fetchTenants(q, status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <PageHeader
        title={t('platform.tenants')}
        actions={
          me.user.platformRole === 'super_admin' && (
            <Link
              to="/platform/tenants/new"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-medium text-primary-foreground"
            >
              {t('newStore.title')}
            </Link>
          )
        }
      />
      <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
        <Field
          label={t('tenants.search')}
          type="search"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tenant-status" className="text-sm font-medium">
            {t('tenants.status')}
          </label>
          <select
            id="tenant-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as TenantStatus | '')}
            className="min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm"
          >
            <option value="">{t('tenants.allStatuses')}</option>
            {TENANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <DataList<Tenant>
        label={t('platform.tenants')}
        items={tenants.data?.pages.flatMap((p) => p.items)}
        rowKey={(x) => x.id}
        isPending={tenants.isPending}
        error={tenants.isError ? errorMessage(tenants.error, t) : undefined}
        onRetry={() => tenants.refetch()}
        empty={t('tenants.none')}
        hasMore={tenants.hasNextPage}
        loadingMore={tenants.isFetchingNextPage}
        onLoadMore={() => tenants.fetchNextPage()}
        columns={[
          {
            header: t('store.name'),
            cell: (x) => (
              <Link
                to="/platform/tenants/$id"
                params={{ id: x.id }}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {x.name}
              </Link>
            ),
          },
          { header: t('tenants.slug'), cell: (x) => <span lang="en">{x.slug}</span> },
          { header: t('tenants.status'), cell: (x) => <StatusBadge status={x.status} /> },
          {
            header: t('tenants.plan'),
            cell: (x) => (
              <span lang="en">
                {x.plan}
                {x.kind !== 'client' && (
                  <span lang={locale} className="ms-2 rounded bg-muted px-2 py-0.5 text-xs">
                    {t(`kind.${x.kind}`)}
                  </span>
                )}
              </span>
            ),
          },
          {
            header: t('tenants.setup'),
            cell: (x) =>
              x.setup
                ? t('tenants.setupProgress', { done: x.setup.done, total: x.setup.total })
                : t('tenants.setupUnknown'),
          },
          {
            header: t('tenants.createdAt'),
            cell: (x) => formatDateTime(locale, new Date(x.createdAt), { dateStyle: 'medium' }),
          },
        ]}
      />
    </div>
  );
}
