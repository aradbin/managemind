// Orders → Confirm (phase-6-plan §3.5, §3.8): new COD orders to call, as
// cards with a large Call button. Calling claims the order for 5 minutes
// and opens the call panel with the store's script and the outcomes; after
// an outcome, the next order opens. The tabs: due now, later, unreachable,
// and risky phones first.
import type { CancelCode } from '@managemind/shared/orders';
import { formatPhone } from '@managemind/shared/phone';
import { dhakaToUtc } from '@managemind/shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Phone, Settings } from 'lucide-react';
import { useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { ScoreBadge } from '../components/risk';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import { ApiError, api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import {
  type CallPanel,
  confirmationsQuery,
  dateTime,
  idempotencyKey,
  orderErrorMessage,
  pickText,
  type QueueItem,
  type QueueTab,
  withKey,
} from '../lib/orders';
import { cn } from '../lib/utils';

const TABS = [
  { key: 'to_call', label: 'queue.tab.to_call', count: 'toCall' },
  { key: 'later', label: 'queue.tab.later', count: 'later' },
  { key: 'unreachable', label: 'queue.tab.unreachable', count: 'unreachable' },
  { key: 'risky', label: 'queue.tab.risky', count: null },
] as const satisfies readonly {
  key: QueueTab;
  label: AdminKey;
  count: 'toCall' | 'later' | 'unreachable' | null;
}[];

export function ConfirmQueuePage() {
  const { t } = useLocale();
  const search = useSearch({ strict: false }) as { tab?: QueueTab };
  const tab = search.tab ?? 'to_call';
  const navigate = useNavigate();
  const canWrite = usePermission('orders.write');
  const canSettings = usePermission('settings.read');
  const queue = useQuery(confirmationsQuery(tab));
  const [panel, setPanel] = useState<CallPanel | null>(null);
  const items = queue.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4 pb-20 md:pb-0">
      <PageHeader
        className="mb-0"
        parent={{ to: '/orders', label: t('nav.orders') }}
        title={t('queue.title')}
        description={t('queue.intro')}
        actions={
          canSettings && (
            <Button variant="secondary" asChild>
              <Link to="/settings/confirmation">
                <Settings aria-hidden className="size-4" />
                {t('queue.settings')}
              </Link>
            </Button>
          )
        }
      />
      {queue.data && !queue.data.enabled && (
        <Notice>
          {t('queue.off')}{' '}
          {canSettings && (
            <Link to="/settings/confirmation" className="underline">
              {t('confirmSettings.title')}
            </Link>
          )}
        </Notice>
      )}
      <nav
        aria-label={t('queue.title')}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0"
      >
        {TABS.map((x) => {
          const count = x.count ? queue.data?.counts[x.count] : undefined;
          return (
            <Link
              key={x.key}
              to="/orders/confirm"
              search={x.key === 'to_call' ? {} : { tab: x.key }}
              aria-current={tab === x.key ? 'page' : undefined}
              className={cn(
                'flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-input bg-background px-4 text-sm font-medium text-muted-foreground',
                tab === x.key && 'border-foreground bg-foreground text-background',
              )}
            >
              {t(x.label)}
              {count ? (
                <span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-foreground tabular-nums">
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      {queue.isPending && <p role="status">{t('loading')}</p>}
      {queue.isError && <Notice tone="error">{errorMessage(queue.error, t)}</Notice>}
      {queue.data?.enabled && items.length === 0 && (
        <p className="rounded-xl border border-border bg-background p-6 text-center text-muted-foreground">
          {t(
            tab === 'later'
              ? 'queue.emptyLater'
              : tab === 'unreachable'
                ? 'queue.emptyUnreachable'
                : 'queue.empty',
          )}
        </p>
      )}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.orderId}>
            <QueueCard item={item} canWrite={canWrite} onOpen={(p) => setPanel(p)} />
          </li>
        ))}
      </ul>
      {panel && (
        <CallPanelDialog
          key={panel.orderId}
          panel={panel}
          onClose={() => setPanel(null)}
          onNext={(next) => {
            setPanel(next);
            if (!next)
              void navigate({ to: '/orders/confirm', search: tab === 'to_call' ? {} : { tab } });
          }}
          nextCandidates={items}
        />
      )}
    </div>
  );
}

/** Claims an order and returns its call panel; 409 says who holds it. */
function useClaim() {
  return useMutation({
    mutationFn: async (orderId: string) =>
      unwrap(
        await api.POST('/v1/admin/orders/{id}/confirmation/claim', {
          params: { path: { id: orderId } },
        }),
      ),
  });
}

function QueueCard({
  item,
  canWrite,
  onOpen,
}: {
  item: QueueItem;
  canWrite: boolean;
  onOpen: (panel: CallPanel) => void;
}) {
  const { t, locale } = useLocale();
  const claim = useClaim();
  const heldByOther = item.claim && !item.claim.mine;
  const shown = item.items.slice(0, 3);
  const more = item.itemCount - shown.reduce((n, i) => n + i.quantity, 0);
  return (
    <article
      aria-labelledby={`q-${item.orderId}`}
      className="flex h-full flex-col gap-3 rounded-xl border border-border bg-background p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={`q-${item.orderId}`} className="truncate font-semibold">
            {item.name}
          </h2>
          <span className="text-xs text-muted-foreground">
            <Link
              to="/orders/$id"
              params={{ id: item.orderId }}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {item.displayNumber}
            </Link>{' '}
            · {dateTime(locale, item.placedAt)}
            {pickText(item.area, locale) ? ` · ${pickText(item.area, locale)}` : ''}
          </span>
        </div>
        <span className="flex flex-col items-end gap-1">
          <ScoreBadge risk={item.risk} />
          {item.flags.includes('possible_duplicate') && (
            <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full bg-warning px-2.5 text-xs font-medium text-warning-foreground">
              {t('orders.flag.possible_duplicate')}
            </span>
          )}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5 text-sm">
        {shown.map((i) => (
          <li key={i.variantId} className="truncate">
            {pickText(i.title, locale)} × {i.quantity}
          </li>
        ))}
        {more > 0 && <li className="text-muted-foreground">{t('queue.more', { count: more })}</li>}
      </ul>
      <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold tabular-nums">{formatPrice(item.total, locale)}</span>
        <span className="text-muted-foreground">
          {t('queue.cod', { amount: formatPrice(item.codDue, locale) })}
        </span>
      </p>
      {(item.attempts > 0 || item.lastNote || item.dueAt) && (
        <p className="text-xs text-muted-foreground">
          {[
            item.attempts > 0 && t('queue.attempts', { count: item.attempts }),
            item.lastOutcome && t(`outcome.${item.lastOutcome}` as AdminKey),
            item.dueAt && t('queue.dueAt', { time: dateTime(locale, item.dueAt) }),
            item.lastNote,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {item.linkAnswer === 'confirm' && (
        <p className="rounded-md bg-warning px-2.5 py-1.5 text-xs font-medium text-warning-foreground">
          {t('queue.linkConfirmed')}
        </p>
      )}
      {heldByOther ? (
        <p role="status" className="mt-auto rounded-md bg-muted p-2.5 text-center text-sm">
          {item.claim?.name
            ? t('queue.callingNamed', { name: item.claim.name })
            : t('queue.calling')}
        </p>
      ) : (
        canWrite && (
          <Button
            asChild
            className="mt-auto min-h-12 text-base"
            onClick={() => claim.mutate(item.orderId, { onSuccess: onOpen })}
          >
            <a href={`tel:${item.phone}`}>
              <Phone aria-hidden className="size-5" />
              {t('queue.call', { phone: formatPhone(item.phone) })}
            </a>
          </Button>
        )
      )}
      {claim.error && <Notice tone="error">{claimError(claim.error, t)}</Notice>}
    </article>
  );
}

function claimError(error: unknown, t: ReturnType<typeof useLocale>['t']) {
  if (error instanceof ApiError && error.problem?.code === 'conflict') {
    const name = (error.problem as { claimedBy?: string | null }).claimedBy;
    return name ? t('queue.callingNamed', { name }) : t('queue.calling');
  }
  return orderErrorMessage(error, t);
}

type Choice = 'confirmed' | 'no_answer' | 'call_back' | 'wrong_number' | 'cancelled';

/** When to call back: in an hour, in three, this evening at 8, tomorrow at 10 (Dhaka). */
function callBackTimes(now = new Date()) {
  const dhakaDay = (offset: number) =>
    new Date(now.getTime() + 6 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
  const evening = Date.parse(dhakaToUtc(`${dhakaDay(0)}T20:00`));
  const times: { key: AdminKey; at: Date }[] = [
    { key: 'queue.in1h', at: new Date(now.getTime() + 3_600_000) },
    { key: 'queue.in3h', at: new Date(now.getTime() + 3 * 3_600_000) },
  ];
  if (evening > now.getTime() + 30 * 60_000) {
    times.push({ key: 'queue.evening', at: new Date(evening) });
  }
  times.push({ key: 'queue.tomorrow', at: new Date(dhakaToUtc(`${dhakaDay(1)}T10:00`)) });
  return times;
}

const CALL_CODES = ['shopper_request', 'fake', 'other'] as const satisfies readonly CancelCode[];

function CallPanelDialog({
  panel,
  onClose,
  onNext,
  nextCandidates,
}: {
  panel: CallPanel;
  onClose: () => void;
  onNext: (next: CallPanel | null) => void;
  nextCandidates: QueueItem[];
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canBlock = usePermission('settings.write');
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [code, setCode] = useState<CancelCode | null>(null);
  const [block, setBlock] = useState(false);
  const [key] = useState(idempotencyKey);
  const claim = useClaim();
  const [times] = useState(() => callBackTimes());

  const record = useMutation({
    mutationFn: async (outcome: Choice) =>
      unwrap(
        await api.POST('/v1/admin/orders/{id}/confirmation/outcomes', {
          params: { path: { id: panel.orderId }, ...withKey(key).params },
          body: {
            outcome,
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(outcome === 'call_back' && dueAt ? { dueAt } : {}),
            ...(outcome === 'cancelled' && code ? { code: code as 'shopper_request' } : {}),
            ...(outcome === 'wrong_number' && block ? { block: true } : {}),
          },
        }),
      ),
    onSuccess: async (_r, outcome) => {
      toast(t(`outcome.done.${outcome}` as AdminKey, { number: panel.displayNumber }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['confirmations'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['order', panel.orderId] }),
      ]);
      // The next order nobody else is calling opens by itself.
      const next = nextCandidates.find(
        (i) => i.orderId !== panel.orderId && (!i.claim || i.claim.mine) && !i.dueAt,
      );
      if (!next) return onNext(null);
      claim.mutate(next.orderId, { onSuccess: onNext, onError: () => onNext(null) });
    },
  });
  const needs = {
    call_back: dueAt !== null && note.trim() !== '',
    cancelled: code !== null && (code !== 'other' || note.trim() !== ''),
  };
  const ready =
    choice !== null &&
    (choice === 'call_back' ? needs.call_back : choice === 'cancelled' ? needs.cancelled : true);
  const choices: Choice[] = ['confirmed', 'no_answer', 'call_back', 'wrong_number', 'cancelled'];

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('queue.panelTitle', { number: panel.displayNumber, name: panel.name })}
    >
      <div className="flex flex-col gap-4">
        <Button asChild variant="secondary" className="min-h-12 text-base">
          <a href={`tel:${panel.phone}`}>
            <Phone aria-hidden className="size-5" />
            {formatPhone(panel.phone)}
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          {t('queue.claimedUntil', { time: dateTime(locale, panel.claimedUntil) })}
          {panel.attempts > 0 &&
            ` · ${t('queue.attemptsOf', { count: panel.attempts, max: panel.maxAttempts })}`}
        </p>
        {/* Folded on phones, where the outcomes matter more than the words. */}
        <details className="rounded-lg border border-border p-3" open={window.innerWidth >= 768}>
          <summary className="min-h-8 cursor-pointer text-sm font-medium">
            {t('queue.script')}
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{panel.script}</p>
        </details>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('queue.outcome')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {choices.map((c) => (
              <label
                key={c}
                className={cn(
                  'flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-input px-3 text-sm font-medium',
                  choice === c && 'border-foreground bg-muted',
                  c === 'confirmed' && 'col-span-2',
                )}
              >
                <input
                  type="radio"
                  name="outcome"
                  className="size-5"
                  checked={choice === c}
                  onChange={() => setChoice(c)}
                />
                {t(`outcome.${c}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {choice === 'call_back' && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('queue.when')}</legend>
            {times.map((x) => (
              <label key={x.key} className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="due"
                  className="size-5"
                  checked={dueAt === x.at.toISOString()}
                  onChange={() => setDueAt(x.at.toISOString())}
                />
                {t(x.key)} · {dateTime(locale, x.at.toISOString())}
              </label>
            ))}
          </fieldset>
        )}
        {choice === 'cancelled' && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('order.cancelCode')}</legend>
            {CALL_CODES.map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="call-code"
                  className="size-5"
                  checked={code === c}
                  onChange={() => setCode(c)}
                />
                {t(`cancelCode.${c}`)}
              </label>
            ))}
          </fieldset>
        )}
        {choice === 'wrong_number' && canBlock && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={block}
              onChange={(e) => setBlock(e.target.checked)}
            />
            {t('queue.block')}
          </label>
        )}
        {choice !== null && choice !== 'confirmed' && (
          <Field
            label={
              choice === 'call_back' || (choice === 'cancelled' && code === 'other')
                ? t('queue.note')
                : t('queue.noteOptional')
            }
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
        {record.error && <Notice tone="error">{orderErrorMessage(record.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-between">
          <Link
            to="/orders/$id"
            params={{ id: panel.orderId }}
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            {t('queue.editOrder')}
          </Link>
          <div className="flex flex-col-reverse gap-2 md:flex-row">
            <Button variant="ghost" onClick={onClose} disabled={record.isPending}>
              {t('queue.stop')}
            </Button>
            <Button
              disabled={!ready || record.isPending || claim.isPending}
              onClick={() => choice && record.mutate(choice)}
            >
              {t('queue.save')}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
