// Orders → Incomplete (phase-6-plan §3.2, §3.8): checkouts shoppers left
// after typing a phone, shown once they stopped typing for the store's
// delay. Staff call, note it, dismiss it, or create the order in one click:
// the manual order screen starts from the record, which becomes converted.
import { formatPhone } from '@managemind/shared/phone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Phone, ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import {
  RowMenu,
  RowMenuItem,
  SearchInput,
  StageTabs,
  ToolbarSummary,
} from '../components/list-tools';
import { Notice } from '../components/notice';
import { BackLink, PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { RiskPanel, ScoreBadge } from '../components/risk';
import { useToast } from '../components/toast';
import { StatusBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import {
  dateTime,
  type IncompleteSummary,
  type IncompleteTab,
  incompleteList,
  incompleteOrderQuery,
  lineLabel,
  orderErrorMessage,
  pickText,
} from '../lib/orders';
import { usePagedList } from '../lib/paged';
import { cn } from '../lib/utils';

const TABS = ['open', 'converted', 'recovered', 'dismissed'] as const satisfies IncompleteTab[];
const card = 'flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5';

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
  if (detail.isPending) return <p role="status">{t('loading')}</p>;
  if (detail.isError) return <Notice tone="error">{errorMessage(detail.error, t)}</Notice>;
  const d = detail.data;
  const open = d.status === 'open' || d.status === 'contacted';
  const orderable = d.lines.filter((l) => l.orderable).length;
  return (
    <div className="flex flex-col gap-5 pb-20 md:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <BackLink to="/orders/incomplete" label={t('incomplete.title')} />
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">
                {d.name || t('incomplete.noName')}
              </h1>
              <StatusLabel status={d.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t('incomplete.savedAt', {
                created: dateTime(locale, d.createdAt),
                updated: dateTime(locale, d.updatedAt),
              })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <a href={`tel:${d.phone}`}>
              <Phone aria-hidden className="size-4" />
              {t('queue.call', { phone: formatPhone(d.phone) })}
            </a>
          </Button>
          {canWrite && open && orderable > 0 && (
            <Button asChild>
              <Link to="/orders/new" search={{ incomplete: d.id }}>
                <ShoppingCart aria-hidden className="size-4" />
                {t('incomplete.createOrder')}
              </Link>
            </Button>
          )}
        </div>
      </div>
      {d.orderId && (
        <Notice>
          {t(d.status === 'converted' ? 'incomplete.convertedTo' : 'incomplete.recoveredBy')}{' '}
          <Link to="/orders/$id" params={{ id: d.orderId }} className="underline">
            {t('incomplete.seeOrder')}
          </Link>
        </Notice>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="lines-h" className={card}>
            <h2 id="lines-h" className="font-semibold">
              {t('order.items')}
            </h2>
            <ul className="flex flex-col divide-y divide-border">
              {d.lines.map((l) => (
                <li key={l.variantId} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>{lineLabel(l, locale)}</span>
                    {!l.orderable && (
                      <span className="text-xs text-danger">{t('incomplete.notOrderable')}</span>
                    )}
                    {l.priceNow !== null && l.priceNow !== l.price && (
                      <span className="text-xs text-muted-foreground">
                        {t('incomplete.priceNow', { price: formatPrice(l.priceNow, locale) })}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums">
                    {formatPrice(l.price, locale)} × {l.quantity}
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between border-t border-border pt-3 font-semibold">
              <span>{t('incomplete.subtotal')}</span>
              <span className="tabular-nums">{formatPrice(d.subtotal, locale)}</span>
            </p>
            {d.cartCode && (
              <p className="text-sm text-muted-foreground">
                {t('incomplete.code', { code: d.cartCode })}
              </p>
            )}
          </section>
          {open && canWrite && (
            <section aria-labelledby="note-h" className={card}>
              <h2 id="note-h" className="font-semibold">
                {t('incomplete.called')}
              </h2>
              {d.note && <p className="whitespace-pre-wrap text-sm">{d.note}</p>}
              <Field
                label={t('queue.noteOptional')}
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={act.isPending}
                  onClick={() => act.mutate('contacted')}
                >
                  {t('incomplete.markContacted')}
                </Button>
                <Button
                  variant="quiet"
                  disabled={act.isPending}
                  onClick={() => act.mutate('dismiss')}
                >
                  {t('incomplete.dismiss')}
                </Button>
              </div>
              {act.error && <Notice tone="error">{orderErrorMessage(act.error, t)}</Notice>}
            </section>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <section aria-labelledby="who-h" className={card}>
            <h2 id="who-h" className="font-semibold">
              {t('order.customer')}
            </h2>
            <p className="flex flex-col text-sm">
              <span className="font-medium">{d.name || t('incomplete.noName')}</span>
              <span>{formatPhone(d.phone)}</span>
              {d.email && <span>{d.email}</span>}
              {d.address.line && <span className="mt-1">{d.address.line}</span>}
            </p>
            {d.contactedAt && (
              <p className="text-xs text-muted-foreground">
                {t('incomplete.contactedAt', { time: dateTime(locale, d.contactedAt) })}
              </p>
            )}
          </section>
          <RiskPanel risk={d.risk} />
        </div>
      </div>
    </div>
  );
}
