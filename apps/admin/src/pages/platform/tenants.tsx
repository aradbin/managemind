// Platform: stores (phase-1-plan §7.3), searched by name or address and
// filtered by status, with their plan and setup progress (phase-5b-plan
// §3.2); super admins open the New store page.

import { TENANT_KINDS } from '@managemind/shared/billing';
import { formatNumber } from '@managemind/shared/i18n';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataList } from '../../components/data-list';
import {
  FilterButtons,
  RowMenu,
  RowMenuItem,
  SearchInput,
  StageTabs,
  ToolbarSummary,
} from '../../components/list-tools';
import { PageHeader } from '../../components/page-header';
import { StoreTile } from '../../components/store-switcher';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useLocale } from '../../i18n';
import '../../i18n/launch';
import { api, meQuery, unwrap } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { dateOnly, pickText } from '../../lib/orders';
import { usePagedList } from '../../lib/paged';
import { StatusBadge, type TenantStatus } from './status';

type Tenant = Awaited<ReturnType<typeof fetchTenants>>['items'][number];

type Tab = TenantStatus | 'setting_up' | '';

async function fetchTenants(
  q: string,
  status: Tab,
  offset = 0,
  limit = 50,
  filters: { kind?: string | undefined; plan?: string | undefined } = {},
) {
  return unwrap(
    await api.GET('/v1/platform/tenants', {
      params: {
        query: {
          limit,
          offset,
          ...(q ? { q } : {}),
          ...(status ? { status } : {}),
          ...(filters.kind ? { kind: filters.kind } : {}),
          ...(filters.plan ? { plan: filters.plan } : {}),
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

const plansQuery = {
  queryKey: ['platform', 'plans'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/platform/plans')),
};

/** The tabs: each status, with active stores still setting up as their own. */
const TABS = ['', 'active', 'setting_up', 'suspended', 'closed', 'purged'] as const;

export function TenantsPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Tab>('');
  const [kind, setKind] = useState<string>();
  const [planCode, setPlanCode] = useState<string>();
  const plans = useQuery(plansQuery);
  const q = useDebounced(query.trim());
  const tenants = usePagedList({
    queryKey: ['platform', 'tenants', q, status, kind ?? null, planCode ?? null],
    fetchPage: (offset: number, limit: number) =>
      fetchTenants(q, status, offset, limit, { kind, plan: planCode }),
  });
  const counts = tenants.first?.counts;
  const filtered = Boolean(q || kind || planCode);
  const reset = () => {
    setQuery('');
    setKind(undefined);
    setPlanCode(undefined);
  };
  const open = (x: Tenant) => navigate({ to: '/platform/tenants/$id', params: { id: x.id } });
  const setup = (x: Tenant) =>
    x.setup ? (
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-4 tabular-nums">
          {t('tenants.setupProgress', { done: x.setup.done, total: x.setup.total })}
        </span>
        <span aria-hidden className="block h-1 w-full overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full ${x.setup.done >= x.setup.total ? 'bg-success' : 'bg-primary'}`}
            style={{ width: `${x.setup.total ? (x.setup.done / x.setup.total) * 100 : 0}%` }}
          />
        </span>
      </span>
    ) : (
      <span className="text-[13px] text-muted-foreground">{t('tenants.setupUnknown')}</span>
    );
  const planName = (x: Tenant) =>
    pickText(plans.data?.find((p) => p.code === x.plan)?.name, locale) || x.plan;
  const plan = (x: Tenant) => (
    <span className="flex items-center gap-2 whitespace-nowrap">
      {planName(x)}
      {x.kind !== 'client' && <Badge>{t(`kind.${x.kind}`)}</Badge>}
    </span>
  );
  return (
    <div className="flex flex-col gap-3 md:gap-4">
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
        tabs={TABS.map((x) => ({
          key: x,
          label:
            x === ''
              ? t('tenants.allStatuses')
              : x === 'setting_up'
                ? t('tenants.settingUp')
                : t(`status.${x}`),
          count: x === '' ? counts?.all : counts?.[x] || undefined,
        }))}
        value={status}
        onChange={(key) => setStatus(key)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-[260px] md:flex-none"
          label={t('tenants.search')}
          value={query}
          onChange={setQuery}
        />
        <FilterButtons
          filters={[
            {
              key: 'kind',
              multi: true,
              label: t('tenants.kind'),
              value: kind,
              options: TENANT_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })),
              onChange: setKind,
            },
            {
              key: 'plan',
              multi: true,
              label: t('tenants.plan'),
              value: planCode,
              options: (plans.data ?? []).map((p) => ({
                value: p.code,
                label: pickText(p.name, locale) || p.code,
              })),
              onChange: setPlanCode,
            },
          ]}
          onReset={filtered ? reset : undefined}
        />
        {tenants.first && (
          <ToolbarSummary>
            {t('tenants.count', { count: formatNumber(locale, tenants.total) })}
          </ToolbarSummary>
        )}
      </div>
      <DataList<Tenant>
        label={t('platform.tenants')}
        items={tenants.items}
        rowKey={(x) => x.id}
        grid="minmax(0,1.6fr) 110px 130px 140px 120px 40px"
        rowHeight={60}
        isPending={tenants.isPending}
        error={tenants.isError ? errorMessage(tenants.error, t) : undefined}
        onRetry={() => tenants.refetch()}
        empty={t('tenants.none')}
        pager={tenants.pager}
        onOpen={open}
        menu={(x) => (
          <RowMenu label={x.name}>
            <RowMenuItem onSelect={() => open(x)}>
              <Store aria-hidden />
              {t('list.open')}
            </RowMenuItem>
          </RowMenu>
        )}
        card={(x) => (
          <div className="flex items-center gap-3">
            <StoreTile name={x.name} className="size-8 rounded-full bg-muted text-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <Link
                to="/platform/tenants/$id"
                params={{ id: x.id }}
                className="truncate font-medium"
              >
                {x.name}
              </Link>
              <span className="truncate text-[13px] text-muted-foreground" lang="en">
                {x.slug}
              </span>
            </div>
            <StatusBadge status={x.status} />
          </div>
        )}
        columns={[
          {
            header: t('tenants.store'),
            skeleton: 'lines',
            cell: (x) => (
              <span className="flex min-w-0 items-center gap-2.5">
                <StoreTile
                  name={x.name}
                  className="size-8 rounded-full bg-muted text-xs font-semibold text-foreground"
                />
                <span className="flex min-w-0 flex-col">
                  <Link
                    to="/platform/tenants/$id"
                    params={{ id: x.id }}
                    className="truncate font-medium"
                  >
                    {x.name}
                  </Link>
                  <span lang="en" className="truncate text-[13px] text-muted-foreground">
                    {x.slug}
                  </span>
                </span>
              </span>
            ),
          },
          {
            header: t('tenants.status'),
            skeleton: 'badge',
            cell: (x) => <StatusBadge status={x.status} />,
          },
          { header: t('tenants.plan'), cell: plan },
          { header: t('tenants.setup'), skeleton: 'lines', cell: setup },
          {
            header: t('tenants.createdAt'),
            cell: (x) => (
              <span className="whitespace-nowrap text-[13px] text-muted-foreground tabular-nums">
                {dateOnly(locale, x.createdAt)}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
