// Platform: stores (phase-1-plan §7.3), searched by name or address and
// filtered by status, with their plan and setup progress (phase-5b-plan
// §3.2); super admins open the New store page.
import { useInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataList } from '../../components/data-list';
import { SearchInput, StageTabs } from '../../components/list-tools';
import { PageHeader } from '../../components/page-header';
import { Button } from '../../components/ui/button';
import { useLocale } from '../../i18n';
import '../../i18n/launch';
import { api, meQuery, unwrap } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { dateOnly } from '../../lib/orders';
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
  const navigate = useNavigate();
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
  const open = (x: Tenant) => navigate({ to: '/platform/tenants/$id', params: { id: x.id } });
  const setup = (x: Tenant) =>
    x.setup ? (
      <span className="flex flex-col gap-1">
        <span className="text-xs">
          {t('tenants.setupProgress', { done: x.setup.done, total: x.setup.total })}
        </span>
        <span aria-hidden className="block h-1 w-24 overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full ${x.setup.done >= x.setup.total ? 'bg-success' : 'bg-primary'}`}
            style={{ width: `${x.setup.total ? (x.setup.done / x.setup.total) * 100 : 0}%` }}
          />
        </span>
      </span>
    ) : (
      <span className="text-muted-foreground">{t('tenants.setupUnknown')}</span>
    );
  const plan = (x: Tenant) => (
    <span className="flex items-center gap-2 whitespace-nowrap" lang="en">
      {x.plan}
      {x.kind !== 'client' && (
        <span
          lang={locale}
          className="rounded-md border border-border px-1.5 text-xs font-medium text-muted-foreground"
        >
          {t(`kind.${x.kind}`)}
        </span>
      )}
    </span>
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t('platform.tenants')}
        actions={
          me.user.platformRole === 'super_admin' && (
            <Button asChild>
              <Link to="/platform/tenants/new">
                <Plus aria-hidden />
                {t('newStore.title')}
              </Link>
            </Button>
          )
        }
      />
      <StageTabs
        label={t('tenants.status')}
        tabs={[
          { key: '', label: t('tenants.allStatuses') },
          ...TENANT_STATUSES.map((s) => ({ key: s, label: t(`status.${s}`) })),
        ]}
        value={status}
        onChange={(key) => setStatus(key as TenantStatus | '')}
      />
      <SearchInput
        className="w-full md:w-72"
        label={t('tenants.search')}
        value={query}
        onChange={setQuery}
      />
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
        onOpen={open}
        card={(x) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Link to="/platform/tenants/$id" params={{ id: x.id }} className="font-medium">
                {x.name}
              </Link>
              <span className="font-mono text-xs text-muted-foreground" lang="en">
                {x.slug}
              </span>
              {setup(x)}
            </div>
            <span className="flex shrink-0 flex-col items-end gap-1 text-sm">
              <StatusBadge status={x.status} />
              {plan(x)}
            </span>
          </div>
        )}
        columns={[
          {
            header: t('store.name'),
            cell: (x) => (
              <Link
                to="/platform/tenants/$id"
                params={{ id: x.id }}
                className="font-medium underline-offset-2 hover:underline"
              >
                {x.name}
              </Link>
            ),
          },
          {
            header: t('tenants.slug'),
            cell: (x) => (
              <span lang="en" className="font-mono text-xs text-muted-foreground">
                {x.slug}
              </span>
            ),
          },
          { header: t('tenants.status'), cell: (x) => <StatusBadge status={x.status} /> },
          { header: t('tenants.plan'), cell: plan },
          { header: t('tenants.setup'), cell: setup },
          {
            header: t('tenants.createdAt'),
            cell: (x) => (
              <span className="whitespace-nowrap text-muted-foreground">
                {dateOnly(locale, x.createdAt)}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
