// Returns (phase-5a-plan §7): newest first, filtered by status. Shoppers'
// requests wait at "requested" until staff approve or reject them.

import { RETURN_RECORD_STATUSES } from '@managemind/shared/orders';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Breadcrumb } from '../components/breadcrumb';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/returns';
import { errorMessage } from '../lib/errors';
import { dateTime } from '../lib/orders';
import { type ReturnStatus, type ReturnSummary, returnsQuery } from '../lib/returns';

export function ReturnStatusChip({ status }: { status: string }) {
  const { t } = useLocale();
  const tone =
    status === 'requested'
      ? 'bg-warning text-warning-foreground'
      : status === 'rejected'
        ? 'bg-danger-soft text-danger'
        : status === 'resolved'
          ? 'bg-success-soft text-success'
          : 'bg-primary-soft text-primary';
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {t(`return.status.${status}` as AdminKey)}
    </span>
  );
}

export function ReturnsPage() {
  const { t, locale } = useLocale();
  const [status, setStatus] = useState<ReturnStatus | undefined>(undefined);
  const list = useInfiniteQuery({
    queryKey: ['returns', status ?? null] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => returnsQuery(status, pageParam).queryFn(),
    getNextPageParam: (last: ReturnSummary[]) =>
      last.length === 50 ? last[last.length - 1]?.createdAt : undefined,
  });
  const rows = list.data?.pages.flat() ?? [];
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Breadcrumb to="/orders" label={t('nav.orders')} current={t('returns.title')} />
      <PageHeader title={t('returns.title')} description={t('returns.intro')} />
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
        {t('returns.status')}
        <select
          className="min-h-11 rounded-md border border-input bg-background px-3 font-normal"
          value={status ?? ''}
          onChange={(e) => setStatus((e.target.value || undefined) as ReturnStatus | undefined)}
        >
          <option value="">{t('returns.all')}</option>
          {RETURN_RECORD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`return.status.${s}` as AdminKey)}
            </option>
          ))}
        </select>
      </label>
      {list.isPending && <p role="status">{t('loading')}</p>}
      {list.isError && <Notice tone="error">{errorMessage(list.error, t)}</Notice>}
      {list.data && rows.length === 0 && (
        <p className="text-muted-foreground">{t('returns.empty')}</p>
      )}
      {rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                to="/returns/$id"
                params={{ id: r.id }}
                className="flex min-h-16 flex-wrap items-center gap-3 p-3 hover:bg-muted"
              >
                <span className="flex flex-1 flex-col">
                  <span className="font-medium">
                    {r.displayNumber} · {r.orderNumber} · {r.customerName}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t(`return.reason.${r.reason}` as AdminKey)} ·{' '}
                    {t('returns.units', { count: r.units })} · {dateTime(locale, r.createdAt)}
                    {r.requestedBy === 'shopper' && ` · ${t('returns.byShopper')}`}
                  </span>
                </span>
                <ReturnStatusChip status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <div>
          <Button
            variant="secondary"
            disabled={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          >
            {t('returns.more')}
          </Button>
        </div>
      )}
    </div>
  );
}
