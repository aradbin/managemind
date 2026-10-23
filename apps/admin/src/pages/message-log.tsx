// Settings → Notifications → Delivery log (phase-5a-plan §3.6, §7): every
// message the store sent, skipped or failed to send, newest first. A failed
// one can be sent again. Kept for 90 days.
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/messages';
import { api, unwrap } from '../lib/api';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { type MessageFilters, type MessageRow, messagesQuery } from '../lib/messaging';
import { dateTime } from '../lib/orders';
import { eventLabel } from './templates';

const STATUSES = ['failed', 'skipped', 'queued', 'sent'] as const;
const CHANNELS = ['sms', 'email', 'push'] as const;

const select = 'min-h-11 rounded-md border border-input bg-background px-3 font-normal';

export function MessageLogPage({ orderId }: { orderId?: string | undefined } = {}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canResend = usePermission('orders.write');
  const [filters, setFilters] = useState<MessageFilters>({ orderId });
  const log = useInfiniteQuery({
    queryKey: ['messages', filters] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => messagesQuery(filters, pageParam).queryFn(),
    getNextPageParam: (last: MessageRow[]) =>
      last.length === 50 ? last[last.length - 1]?.createdAt : undefined,
  });
  const resend = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.POST('/v1/admin/messages/{id}/resend', { params: { path: { id } } })),
    onSuccess: async () => {
      toast(t('log.resent'));
      await queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
  const rows = log.data?.pages.flat() ?? [];
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={t('log.title')} description={t('log.intro')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('log.status')}
          <select
            className={select}
            value={filters.status ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                status: (e.target.value || undefined) as MessageFilters['status'],
              })
            }
          >
            <option value="">{t('log.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`log.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('templates.channel')}
          <select
            className={select}
            value={filters.channel ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                channel: (e.target.value || undefined) as MessageFilters['channel'],
              })
            }
          >
            <option value="">{t('log.all')}</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`templates.channel.${c}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {log.isPending && <p role="status">{t('loading')}</p>}
      {log.isError && <Notice tone="error">{errorMessage(log.error, t)}</Notice>}
      {resend.error && <Notice tone="error">{saveErrorMessage(resend.error, t)}</Notice>}
      {log.data && rows.length === 0 && <p className="text-muted-foreground">{t('log.empty')}</p>}
      {rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">
                  {t(eventLabel(m.event))} · {t(`templates.channel.${m.channel}`)}
                </span>
                <span className="break-all text-sm text-muted-foreground">
                  {m.recipient} · {dateTime(locale, m.createdAt)}
                  {m.orderId && !orderId && (
                    <>
                      {' · '}
                      <Link to="/orders/$id" params={{ id: m.orderId }} className="underline">
                        {t('log.order')}
                      </Link>
                    </>
                  )}
                </span>
                <span className={m.status === 'failed' ? 'text-sm text-destructive' : 'text-sm'}>
                  {t(`log.status.${m.status}`)}
                  {m.reason && ` · ${reasonText(t, m)}`}
                </span>
              </span>
              {canResend && m.status === 'failed' && (
                <Button
                  variant="secondary"
                  disabled={resend.isPending}
                  onClick={() => resend.mutate(m.id)}
                >
                  {t('log.resend')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {log.hasNextPage && (
        <div>
          <Button
            variant="secondary"
            disabled={log.isFetchingNextPage}
            onClick={() => log.fetchNextPage()}
          >
            {t('log.more')}
          </Button>
        </div>
      )}
    </div>
  );
}

const SKIP_REASONS = [
  'no_gateway',
  'no_address',
  'no_device',
  'no_push_key',
  'quota',
  'no_sender',
] as const;

/** A skip reason in words; a provider's own error as it gave it. */
function reasonText(t: (key: AdminKey) => string, m: MessageRow): string {
  const reason = m.reason ?? '';
  return (SKIP_REASONS as readonly string[]).includes(reason)
    ? t(`log.reason.${reason}` as AdminKey)
    : reason;
}
