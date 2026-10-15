// The platform audit log (super admins), newest first: who did what to
// which store, with the before and after values.
import { formatDateTime } from '@managemind/shared/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { DataList } from '../../components/data-list';
import { PageHeader } from '../../components/page-header';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { errorMessage } from '../../lib/errors';

interface Entry {
  id: string;
  tenantId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

const short = (id: string | null) => (id ? id.slice(-8) : '—');

export function AuditPage() {
  const { t, locale } = useLocale();
  const log = useInfiniteQuery({
    queryKey: ['platform', 'audit'],
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/v1/platform/audit-log', {
          params: { query: { limit: 50, ...(pageParam ? { before: pageParam } : {}) } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <PageHeader title={t('platform.audit')} />
      <DataList<Entry>
        label={t('platform.audit')}
        items={log.data?.pages.flatMap((p) => p.items as unknown as Entry[])}
        rowKey={(e) => e.id}
        isPending={log.isPending}
        error={log.isError ? errorMessage(log.error, t) : undefined}
        onRetry={() => log.refetch()}
        hasMore={log.hasNextPage}
        loadingMore={log.isFetchingNextPage}
        onLoadMore={() => log.fetchNextPage()}
        columns={[
          { header: t('audit.action'), cell: (e) => <code lang="en">{e.action}</code> },
          { header: t('audit.when'), cell: (e) => formatDateTime(locale, new Date(e.createdAt)) },
          {
            header: t('audit.actor'),
            cell: (e) => (
              <span lang="en" title={e.actorId ?? undefined}>
                {e.actorType} {short(e.actorId)}
              </span>
            ),
          },
          {
            header: t('audit.store'),
            cell: (e) => (
              <span lang="en" title={e.tenantId ?? undefined}>
                {short(e.tenantId)}
              </span>
            ),
          },
          {
            header: t('audit.details'),
            cell: (e) =>
              e.before || e.after ? (
                <details>
                  <summary className="min-h-11 cursor-pointer leading-[2.75rem]">
                    {t('audit.details')}
                  </summary>
                  <pre
                    lang="en"
                    className="max-w-full overflow-x-auto whitespace-pre-wrap break-all text-xs"
                  >
                    {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
                  </pre>
                </details>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </div>
  );
}
