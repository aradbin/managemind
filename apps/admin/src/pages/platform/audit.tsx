// The platform audit log (super admins), newest first, as its board draws
// it (ADR 0034): when, who, the action and the store, with a search, Action
// and Store filters, the count, and each entry's before and after values
// under Details.
import { formatNumber } from '@managemind/shared/i18n';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataList } from '../../components/data-list';
import { FilterButtons, SearchInput, ToolbarSummary } from '../../components/list-tools';
import { PageHeader } from '../../components/page-header';
import { Button } from '../../components/ui/button';
import { useLocale } from '../../i18n';
import { api, meQuery, unwrap } from '../../lib/api';
import { formatDateTime } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { usePagedList } from '../../lib/paged';
import { cn } from '../../lib/utils';

interface Entry {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

async function fetchAudit(
  q: string,
  offset: number,
  limit: number,
  filters: { action?: string | undefined; tenant?: string | undefined },
) {
  const page = unwrap(
    await api.GET('/v1/platform/audit-log', {
      params: {
        query: {
          limit,
          offset,
          ...(q ? { q } : {}),
          ...(filters.action ? { action: filters.action } : {}),
          ...(filters.tenant ? { tenant: filters.tenant } : {}),
        },
      },
    }),
  );
  return { ...page, items: page.items as unknown as Entry[] };
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

export function AuditPage() {
  const { t, locale } = useLocale();
  useSuspenseQuery(meQuery);
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<string>();
  const [tenant, setTenant] = useState<string>();
  const [open, setOpen] = useState<string | null>(null);
  const q = useDebounced(query.trim());
  const log = usePagedList({
    queryKey: ['platform', 'audit', q, action ?? null, tenant ?? null],
    fetchPage: (offset: number, limit: number) => fetchAudit(q, offset, limit, { action, tenant }),
  });
  const first = log.first;
  const filtered = Boolean(q || action || tenant);
  const reset = () => {
    setQuery('');
    setAction(undefined);
    setTenant(undefined);
  };
  const when = (e: Entry) =>
    formatDateTime(locale, new Date(e.createdAt), {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  const actor = (e: Entry) =>
    e.actorName ?? (e.actorType === 'system' ? t('audit.system') : e.actorType);
  const store = (e: Entry) =>
    e.tenantId ? (
      <Link
        to="/platform/tenants/$id"
        params={{ id: e.tenantId }}
        className="underline decoration-border underline-offset-[3px]"
      >
        {e.tenantName ?? e.tenantId.slice(-8)}
      </Link>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  const toggle = (e: Entry) =>
    e.before || e.after ? (
      <Button
        variant="ghost"
        className="h-7 px-2 md:h-7"
        aria-expanded={open === e.id}
        aria-label={t('audit.detailsOf', { action: e.action })}
        onClick={() => setOpen(open === e.id ? null : e.id)}
      >
        {t('audit.details')}
        <ChevronDown
          aria-hidden
          className={cn('transition-transform', open === e.id && 'rotate-180')}
        />
      </Button>
    ) : (
      <span />
    );
  const json = (e: Entry) => (
    <pre
      lang="en"
      className="m-0 rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-[18px] whitespace-pre-wrap break-all"
    >
      {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
    </pre>
  );
  return (
    <div className="flex w-full max-w-[1080px] flex-col gap-3 md:gap-4">
      <PageHeader className="mb-0" title={t('platform.audit')} description={t('audit.intro')} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-[280px] md:flex-none"
          label={t('audit.search')}
          value={query}
          onChange={setQuery}
        />
        <FilterButtons
          filters={[
            {
              key: 'action',
              multi: true,
              label: t('audit.action'),
              value: action,
              options: (first?.actions ?? []).map((a) => ({ value: a, label: a })),
              onChange: setAction,
            },
            {
              key: 'tenant',
              multi: true,
              label: t('audit.store'),
              value: tenant,
              options: (first?.stores ?? []).map((s) => ({ value: s.id, label: s.name })),
              onChange: setTenant,
            },
          ]}
          onReset={filtered ? reset : undefined}
        />
        {first && (
          <ToolbarSummary>
            {t('audit.count', { count: formatNumber(locale, log.total) })}
          </ToolbarSummary>
        )}
      </div>
      <DataList<Entry>
        label={t('platform.audit')}
        items={log.items}
        rowKey={(e) => e.id}
        grid="128px minmax(0,0.9fr) minmax(0,1fr) minmax(0,1fr) 96px"
        rowHeight={52}
        isPending={log.isPending}
        error={log.isError ? errorMessage(log.error, t) : undefined}
        onRetry={() => log.refetch()}
        empty={t('audit.none')}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.clearFilters')}
            </Button>
          ) : undefined
        }
        pager={log.pager}
        menu={toggle}
        menuOnPhone={false}
        detail={(e) => (open === e.id ? json(e) : null)}
        card={(e) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <code lang="en" className="min-w-0 flex-1 truncate font-mono text-[13px]">
                {e.action}
              </code>
              {Boolean(e.before || e.after) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mr-1 size-8"
                  aria-expanded={open === e.id}
                  aria-label={t('audit.detailsOf', { action: e.action })}
                  onClick={() => setOpen(open === e.id ? null : e.id)}
                >
                  <ChevronDown
                    aria-hidden
                    className={cn('transition-transform', open === e.id && 'rotate-180')}
                  />
                </Button>
              )}
            </span>
            <span className="truncate text-[13px] text-muted-foreground">
              {when(e)} · {actor(e)}
              {e.tenantId ? ` · ${e.tenantName ?? '—'}` : ' · —'}
            </span>
            {open === e.id && json(e)}
          </div>
        )}
        columns={[
          {
            header: t('audit.when'),
            cell: (e) => (
              <span className="text-[13px] text-muted-foreground tabular-nums">{when(e)}</span>
            ),
          },
          {
            header: t('audit.actor'),
            cell: (e) => <span className="block truncate">{actor(e)}</span>,
          },
          {
            header: t('audit.action'),
            cell: (e) => (
              <code lang="en" className="block truncate font-mono text-[13px]">
                {e.action}
              </code>
            ),
          },
          {
            header: t('audit.store'),
            cell: (e) => <span className="block truncate">{store(e)}</span>,
          },
        ]}
      />
    </div>
  );
}
