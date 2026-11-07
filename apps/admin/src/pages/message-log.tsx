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
import { StatusBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardFrame } from '../components/ui/card';
import { ChoiceChips } from '../components/ui/segmented';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/messages';
import { api, unwrap } from '../lib/api';
import { formatDateTime } from '../lib/dates';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { type MessageFilters, type MessageRow, messagesQuery } from '../lib/messaging';
import { cn } from '../lib/utils';
import { eventLabel } from './templates';

// In the board's order: waiting, sent, failed, not sent.
const STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
const CHANNELS = ['sms', 'email', 'push'] as const;

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
  const tone = (status: MessageRow['status']) =>
    status === 'sent'
      ? ('good' as const)
      : status === 'failed'
        ? ('bad' as const)
        : status === 'skipped'
          ? ('outline' as const)
          : ('progress' as const);
  const when = (iso: string) =>
    formatDateTime(locale, new Date(iso), {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  const grid =
    'md:grid md:grid-cols-[120px_minmax(0,1.3fr)_minmax(0,1.2fr)_72px_minmax(0,1fr)_112px] md:items-center md:gap-3';
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      {!orderId && (
        <PageHeader
          parent={{ to: '/settings', label: t('settings.title') }}
          title={t('log.title')}
          description={t('log.intro')}
        />
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <ChoiceChips<NonNullable<MessageFilters['status']> | ''>
          label={t('log.status')}
          showLabel
          value={filters.status ?? ''}
          options={[
            { value: '', label: t('log.all') },
            ...STATUSES.map((st) => ({ value: st, label: t(`log.status.${st}`) })),
          ]}
          onChange={(status) => setFilters({ ...filters, status: status || undefined })}
        />
        <ChoiceChips<NonNullable<MessageFilters['channel']> | ''>
          label={t('templates.channel')}
          showLabel
          value={filters.channel ?? ''}
          options={[
            { value: '', label: t('log.all') },
            ...CHANNELS.map((c) => ({ value: c, label: t(`templates.channel.${c}`) })),
          ]}
          onChange={(channel) => setFilters({ ...filters, channel: channel || undefined })}
        />
      </div>
      {log.isPending && <p role="status">{t('loading')}</p>}
      {log.isError && <Notice tone="error">{errorMessage(log.error, t)}</Notice>}
      {resend.error && <Notice tone="error">{saveErrorMessage(resend.error, t)}</Notice>}
      {log.data && rows.length === 0 && (
        <p className="rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-muted-foreground">
          {t('log.empty')}
        </p>
      )}
      {rows.length > 0 && (
        <div className={cn(cardFrame, 'overflow-hidden')}>
          <div
            aria-hidden
            className={cn(
              grid,
              'h-10 bg-muted px-4 text-[13px] font-medium text-muted-foreground max-md:hidden',
            )}
          >
            <span>{t('log.when')}</span>
            <span>{t('log.message')}</span>
            <span>{t('log.to')}</span>
            <span>{t('templates.channel')}</span>
            <span>{t('log.status')}</span>
            <span />
          </div>
          <ul aria-label={t('log.title')}>
            {rows.map((m) => (
              <li
                key={m.id}
                className={cn(
                  grid,
                  'flex flex-col gap-1 border-t border-border px-4 py-3 text-[13px] first:border-t-0 md:min-h-14 md:py-2 md:first:border-t',
                )}
              >
                <span className="text-muted-foreground tabular-nums md:text-foreground">
                  {when(m.createdAt)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{t(eventLabel(m.event))}</span>
                  {m.orderId && !orderId && (
                    <Link
                      to="/orders/$id"
                      params={{ id: m.orderId }}
                      className="w-fit font-mono text-xs text-muted-foreground hover:underline"
                    >
                      {m.orderNumber ?? t('log.order')}
                    </Link>
                  )}
                </span>
                <span className="min-w-0 break-all">{m.recipient}</span>
                <span>{t(`templates.channel.${m.channel}`)}</span>
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <StatusBadge tone={tone(m.status)}>
                    {t(`log.status.${m.status}`)}
                    {m.deliveryStatus && ` · ${t(`log.delivery.${m.deliveryStatus}`)}`}
                  </StatusBadge>
                  {m.reason && (
                    <span className="text-xs text-muted-foreground">{reasonText(t, m)}</span>
                  )}
                </span>
                <span className="md:text-right">
                  {canResend && m.status === 'failed' && (
                    <Button
                      variant="ghost"
                      className="max-md:-ml-2.5"
                      disabled={resend.isPending}
                      onClick={() => resend.mutate(m.id)}
                    >
                      {t('log.resend')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {log.hasNextPage && (
        <Button
          variant="secondary"
          className="self-start"
          disabled={log.isFetchingNextPage}
          onClick={() => log.fetchNextPage()}
        >
          {t('log.more')}
        </Button>
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
  'no_template',
  'opted_out',
  'sent_by_whatsapp',
  'whatsapp_failed',
] as const;

/** A skip reason in words; a provider's own error as it gave it. */
function reasonText(t: (key: AdminKey) => string, m: MessageRow): string {
  const reason = m.reason ?? '';
  return (SKIP_REASONS as readonly string[]).includes(reason)
    ? t(`log.reason.${reason}` as AdminKey)
    : reason;
}
