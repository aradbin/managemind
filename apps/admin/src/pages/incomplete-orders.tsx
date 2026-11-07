// Orders → Incomplete (phase-6-plan §3.2, §3.8): checkouts shoppers left
// after typing a phone, shown once they stopped typing for the store's
// delay. Staff call, note it, dismiss it, or create the order in one click:
// the manual order screen starts from the record, which becomes converted.
import { formatPhone } from '@managemind/shared/phone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  CircleX,
  MessageCircle,
  Package,
  Phone,
  PhoneCall,
  Plus,
  ShoppingCart,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { fieldLabel } from '../components/field-styles';
import {
  RowMenu,
  RowMenuItem,
  RowMenuSeparator,
  SearchInput,
  StageTabs,
  ToolbarSummary,
} from '../components/list-tools';
import { Notice } from '../components/notice';
import { BackLink, PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { ScoreBadge } from '../components/risk';
import { useToast } from '../components/toast';
import { StatusBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { Textarea } from '../components/ui/input';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
import { errorMessage } from '../lib/errors';
import {
  dateTime,
  type IncompleteSummary,
  type IncompleteTab,
  incompleteList,
  incompleteOrderQuery,
  orderErrorMessage,
  pickText,
} from '../lib/orders';
import { usePagedList } from '../lib/paged';
import { cn } from '../lib/utils';

const TABS = ['open', 'converted', 'recovered', 'dismissed'] as const satisfies IncompleteTab[];

/** Where a record stands, as the board marks it: not called yet in muted words, else a badge. */
const StatusLabel = ({ status }: { status: IncompleteSummary['status'] }) => {
  const { t } = useLocale();
  if (status === 'open')
    return <span className="text-muted-foreground">{t('incomplete.notCalled')}</span>;
  return (
    <StatusBadge
      tone={
        status === 'converted' || status === 'recovered'
          ? 'good'
          : status === 'contacted'
            ? 'ended'
            : 'outline'
      }
    >
      {t(`incomplete.status.${status}` as AdminKey)}
    </StatusBadge>
  );
};

export function IncompleteOrdersPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: IncompleteTab };
  const tab = search.tab ?? 'open';
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);
  const list = usePagedList(incompleteList(tab, q));
  const items = list.items;
  const counts = list.first?.counts;
  const open = (i: IncompleteSummary) =>
    navigate({ to: '/orders/incomplete/$id', params: { id: i.id } });
  /** The first item, and how many more: "Cotton Panjabi and 2 more items". */
  const what = (i: IncompleteSummary) => {
    const first = pickText(i.items[0]?.title, locale);
    const more = i.itemCount - (i.items[0]?.quantity ?? 0);
    return more > 0 ? t('incomplete.andMore', { first, count: more }) : first;
  };
  const columns: Column<IncompleteSummary>[] = [
    {
      header: t('incomplete.shopper'),
      skeleton: 'lines',
      cell: (i) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              to="/orders/incomplete/$id"
              params={{ id: i.id }}
              className={cn('truncate font-medium', !i.name && 'text-muted-foreground')}
            >
              {i.name || t('incomplete.noNameGiven')}
            </Link>
            {i.risk.risky && <ScoreBadge risk={i.risk} />}
          </span>
          <span className="truncate text-[13px] text-muted-foreground tabular-nums">
            {formatPhone(i.phone)} · {i.areaName ? pickText(i.areaName, locale) : '—'}
          </span>
        </span>
      ),
    },
    {
      header: t('incomplete.itemsCol'),
      cell: (i) => <span className="block truncate">{what(i)}</span>,
    },
    {
      header: t('incomplete.value'),
      numeric: true,
      cell: (i) => <span className="font-medium">{formatPrice(i.subtotal, locale)}</span>,
    },
    { header: t('incomplete.leftAt'), cell: (i) => t(`incomplete.leftAt.${i.leftAt}`) },
    {
      header: t('incomplete.started'),
      cell: (i) => (
        <span className="whitespace-nowrap text-muted-foreground tabular-nums">
          {dateTime(locale, i.createdAt)}
        </span>
      ),
    },
    {
      header: t('order.status'),
      skeleton: 'badge',
      cell: (i) => <StatusLabel status={i.status} />,
    },
  ];
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader className="mb-0" title={t('incomplete.title')} />
      <StageTabs
        label={t('incomplete.title')}
        tabs={TABS.map((x) => ({
          key: x,
          label: t(`incomplete.tab.${x}`),
          count: counts?.[x] || undefined,
        }))}
        value={tab}
        onChange={(x) =>
          navigate({ to: '/orders/incomplete', search: x === 'open' ? {} : { tab: x } })
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-[280px] md:flex-none"
          label={t('incomplete.search')}
          value={text}
          onChange={setText}
        />
        {counts && counts.open > 0 && (
          <ToolbarSummary>
            {t('incomplete.summary', {
              count: counts.open,
              value: formatPrice(counts.openValue, locale),
            })}
          </ToolbarSummary>
        )}
      </div>
      <DataList
        label={t('incomplete.title')}
        items={items}
        rowKey={(i) => i.id}
        columns={columns}
        grid="minmax(0,1.3fr) minmax(0,1.6fr) 96px 120px 136px 104px 36px"
        rowHeight={56}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t(tab === 'open' ? 'incomplete.empty' : 'incomplete.emptyOther')}
        pager={list.pager}
        onOpen={open}
        menu={(i) => (
          <RowMenu label={i.name || formatPhone(i.phone)}>
            <RowMenuItem onSelect={() => open(i)}>
              <ShoppingCart aria-hidden />
              {t('list.open')}
            </RowMenuItem>
            <RowMenuItem onSelect={() => window.open(`tel:${i.phone}`, '_self')}>
              <Phone aria-hidden />
              {t('queue.call', { phone: formatPhone(i.phone) })}
            </RowMenuItem>
          </RowMenu>
        )}
        card={(i) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <Link to="/orders/incomplete/$id" params={{ id: i.id }} className="font-medium">
                  {i.name || t('incomplete.noName')}
                </Link>
                <StatusLabel status={i.status} />
              </span>
              <span className="truncate text-sm">{what(i)}</span>
              <span className="text-xs text-muted-foreground">
                {formatPhone(i.phone)} · {dateTime(locale, i.updatedAt)}
              </span>
            </div>
            <span className="shrink-0 font-medium tabular-nums">
              {formatPrice(i.subtotal, locale)}
            </span>
          </div>
        )}
      />
      <p className="text-[13px] text-muted-foreground">{t('incomplete.footnote')}</p>
    </div>
  );
}

export function IncompleteOrderPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('orders.write');
  const detail = useQuery(incompleteOrderQuery(id));
  const [note, setNote] = useState('');
  const act = useMutation({
    mutationFn: async (to: 'contacted' | 'dismiss') =>
      unwrap(
        to === 'contacted'
          ? await api.POST('/v1/admin/incomplete-orders/{id}/contacted', {
              params: { path: { id } },
              body: note.trim() ? { note: note.trim() } : {},
            })
          : await api.POST('/v1/admin/incomplete-orders/{id}/dismiss', {
              params: { path: { id } },
              body: note.trim() ? { note: note.trim() } : {},
            }),
      ),
    onSuccess: async (saved, to) => {
      queryClient.setQueryData(incompleteOrderQuery(id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: ['incomplete-orders'] });
      setNote('');
      toast(t(to === 'contacted' ? 'incomplete.contactedDone' : 'incomplete.dismissedDone'));
    },
  });
  const name = detail.data?.name || undefined;
  useRecordPage(name ?? (detail.data ? t('incomplete.noName') : undefined));
  if (detail.isPending) return <p role="status">{t('loading')}</p>;
  if (detail.isError) return <Notice tone="error">{errorMessage(detail.error, t)}</Notice>;
  const d = detail.data;
  const open = d.status === 'open' || d.status === 'contacted';
  const orderable = d.lines.filter((l) => l.orderable).length;
  const title = t('incomplete.checkoutFrom', { name: d.name || t('incomplete.noName') });
  const steps = ['contact', 'delivery', 'payment'] as const;
  const reached = steps.indexOf(d.leftAt);
  const menu = (trigger: 'outline' | 'ghost') =>
    canWrite &&
    open && (
      <RowMenu label={t('list.moreActions')} trigger={trigger} page>
        <RowMenuItem disabled={act.isPending} onSelect={() => act.mutate('contacted')}>
          <PhoneCall aria-hidden />
          {t('incomplete.markContacted')}
        </RowMenuItem>
        <RowMenuSeparator />
        <RowMenuItem danger disabled={act.isPending} onSelect={() => act.mutate('dismiss')}>
          <CircleX aria-hidden />
          {t('incomplete.dismiss')}
        </RowMenuItem>
      </RowMenu>
    );
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PhoneRecordHeader
        to="/orders/incomplete"
        backLabel={t('incomplete.back')}
        title={t('incomplete.one')}
      >
        {menu('ghost')}
      </PhoneRecordHeader>
      <div className="flex flex-wrap items-center gap-3">
        <span className="max-md:hidden">
          <BackLink to="/orders/incomplete" label={t('incomplete.back')} />
        </span>
        <h1 className="truncate text-xl leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
        <StatusLabel status={d.status} />
        <span className="flex-1" />
        <span className="flex gap-2 max-md:w-full max-md:[&>*]:flex-1">
          <Button variant="secondary" asChild>
            <a href={`tel:${d.phone}`}>
              <Phone aria-hidden className="size-4" />
              {t('order.call')}
            </a>
          </Button>
          {canWrite && open && orderable > 0 && (
            <Button asChild>
              <Link to="/orders/new" search={{ incomplete: d.id }}>
                <Plus aria-hidden className="size-4" />
                {t('incomplete.createOrder')}
              </Link>
            </Button>
          )}
        </span>
        <span className="max-md:hidden">{menu('outline')}</span>
      </div>
      <p className="-mt-2 text-muted-foreground">
        {t(`incomplete.leftAtLine.${d.leftAt}` as AdminKey)} · {dateTime(locale, d.updatedAt)}
      </p>
      {d.orderId && (
        <Notice>
          {t(d.status === 'converted' ? 'incomplete.convertedTo' : 'incomplete.recoveredBy')}{' '}
          <Link to="/orders/$id" params={{ id: d.orderId }} className="underline">
            {t('incomplete.seeOrder')}
          </Link>
        </Notice>
      )}
      {act.error && <Notice tone="error">{orderErrorMessage(act.error, t)}</Notice>}
      <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 md:gap-4">
          <section aria-labelledby="lines-h" className={cn(cardPadded, 'gap-3 md:gap-3')}>
            <h2 id="lines-h" className={cardTitle}>
              {t('order.items')}
            </h2>
            <ul className="flex flex-col">
              {d.lines.map((l) => {
                const options = l.optionLabels
                  .map((o) => pickText(o, locale))
                  .filter(Boolean)
                  .join(' / ');
                return (
                  <li
                    key={l.variantId}
                    className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border py-2 last:border-b-0 md:grid-cols-[40px_minmax(0,1fr)_48px_110px_96px]"
                  >
                    <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Package aria-hidden className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{pickText(l.title, locale)}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[
                          options,
                          l.available !== null && t('order.available', { count: l.available }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {!l.orderable && (
                        <span className="text-xs text-danger">{t('incomplete.notOrderable')}</span>
                      )}
                    </span>
                    <span className="text-right text-muted-foreground tabular-nums max-md:hidden">
                      {l.quantity} ×
                    </span>
                    <span className="text-right text-muted-foreground tabular-nums max-md:hidden">
                      {l.priceNow !== null
                        ? t('incomplete.now', { price: formatPrice(l.priceNow, locale) })
                        : formatPrice(l.price, locale)}
                    </span>
                    <span className="text-right font-medium tabular-nums">
                      {formatPrice((l.priceNow ?? l.price) * l.quantity, locale)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="flex justify-between border-t border-border pt-3 font-semibold">
              <span>{t('incomplete.itemsTotal')}</span>
              <span className="tabular-nums">{formatPrice(d.subtotal, locale)}</span>
            </p>
            {d.cartCode && (
              <p className="text-[13px] text-muted-foreground">
                {t('incomplete.code', { code: d.cartCode })}
              </p>
            )}
          </section>
          {open && canWrite && (
            <section aria-labelledby="note-h" className={cardPadded}>
              <h2 id="note-h" className={cardTitle}>
                {t('incomplete.callNote')}
              </h2>
              {d.note && <p className="whitespace-pre-wrap">{d.note}</p>}
              <div className="flex flex-col gap-2">
                <Textarea
                  aria-labelledby="note-h"
                  maxLength={500}
                  placeholder={t('incomplete.notePlaceholder')}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  variant="secondary"
                  className="self-end"
                  disabled={act.isPending}
                  onClick={() => act.mutate('contacted')}
                >
                  {t(note.trim() ? 'incomplete.saveNote' : 'incomplete.markContacted')}
                </Button>
              </div>
            </section>
          )}
        </div>
        <div className="flex flex-col gap-3 md:gap-4">
          <section aria-labelledby="who-h" className={cardPadded}>
            <h2 id="who-h" className={cardTitle}>
              {t('incomplete.shopper')}
            </h2>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{d.name || t('incomplete.noName')}</span>
              <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground tabular-nums">
                {formatPhone(d.phone)}
                <ScoreBadge risk={d.risk} />
              </span>
              {d.email && <span className="text-[13px] text-muted-foreground">{d.email}</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" asChild>
                <a href={`tel:${d.phone}`}>
                  <Phone aria-hidden className="size-4" />
                  {t('order.call')}
                </a>
              </Button>
              <Button variant="secondary" asChild>
                <a
                  href={`https://wa.me/${d.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle aria-hidden className="size-4" />
                  {t('order.whatsapp')}
                </a>
              </Button>
            </div>
            {d.address.line && (
              <div className="flex flex-col gap-1 border-t border-border pt-3">
                <span className={fieldLabel}>{t('incomplete.addressTyped')}</span>
                <span>
                  {[d.address.line, pickText(d.areaName, locale)].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
            {d.contactedAt && (
              <p className="text-xs text-muted-foreground">
                {t('incomplete.contactedAt', { time: dateTime(locale, d.contactedAt) })}
              </p>
            )}
          </section>
          <section aria-labelledby="steps-h" className={cardPadded}>
            <h2 id="steps-h" className={cardTitle}>
              {t('incomplete.checkout')}
            </h2>
            <ol className="flex flex-col gap-2.5">
              {steps.map((step, i) => (
                <li key={step} className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      'size-2.5 rounded-full',
                      i <= reached ? 'bg-muted-foreground' : 'border border-border',
                    )}
                  />
                  <span className="flex-1">{t(`incomplete.step.${step}` as AdminKey)}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {i < reached
                      ? t('incomplete.stepDone')
                      : i === reached
                        ? t('incomplete.stepLeft')
                        : ''}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
