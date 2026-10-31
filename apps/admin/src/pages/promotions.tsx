// The campaign list (phase-4-plan §3.13, §7; ADR 0033): state tabs, search
// and a Type filter; each promotion with where it stands, its uses, the
// orders that used it, the discount given and those orders' sales; pause,
// resume and end from a row's ⋯ menu.
import { formatNumber } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { CircleStop, Copy, Pause, Play, Plus, SquarePen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { type Column, DataList } from '../components/data-list';
import {
  FilterButtons,
  RowMenu,
  RowMenuItem,
  RowMenuSeparator,
  SearchInput,
  StageTabs,
} from '../components/list-tools';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/promotions';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateOnly, pickText } from '../lib/orders';
import {
  fromPromotion,
  type Promotion,
  type PromotionFilters,
  type PromotionState,
  promotionsQuery,
  toInput,
} from '../lib/promotions';

export type PromotionSearch = PromotionFilters;

const STATES = ['live', 'scheduled', 'draft', 'paused', 'ended'] as const;

/** Where a promotion stands, as a status badge (design rule 9). */
export function StateChip({ state }: { state: PromotionState }) {
  const { t } = useLocale();
  const tone =
    state === 'live'
      ? 'bg-success-soft text-success'
      : state === 'scheduled'
        ? 'bg-info text-info-foreground'
        : state === 'paused'
          ? 'bg-warning text-warning-foreground'
          : state === 'ended'
            ? 'border border-border text-muted-foreground'
            : 'bg-muted text-muted-foreground';
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-md px-2 text-xs font-medium ${tone}`}
    >
      {t(`promoState.${state}`)}
    </span>
  );
}

export function PromotionsPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as PromotionSearch;
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('promotions.write');
  const [q, setQ] = useState(search.q ?? '');
  const [ending, setEnding] = useState<Promotion>();
  const setFilter = (patch: Partial<PromotionSearch>) =>
    navigate({
      from: '/promotions/',
      to: '/promotions',
      search: (prev: PromotionSearch) =>
        Object.fromEntries(
          Object.entries({ ...prev, ...patch }).filter(([, v]) => v),
        ) as PromotionSearch,
      replace: true,
    });
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? '') !== q.trim()) setFilter({ q: q.trim() || undefined });
    }, 350);
    return () => clearTimeout(id);
  });
  const promotions = useQuery(promotionsQuery(search));
  const money = (n: number) => formatPrice(n, locale);
  const title = (p: Promotion) => pickText(p.title, locale) || '—';
  const open = (p: Promotion) => navigate({ to: '/promotions/$id', params: { id: p.id } });

  /** Pause, resume or end: the promotion as it is, with another status. */
  const setStatus = useMutation({
    mutationFn: async ({ p, status }: { p: Promotion; status: 'active' | 'paused' | 'ended' }) => {
      const built = toInput({ ...fromPromotion(p), status });
      if (!built.ok) throw new Error('invalid');
      return unwrap(
        await api.PATCH('/v1/admin/promotions/{id}', {
          params: { path: { id: p.id } },
          body: built.input,
        }),
      );
    },
    onSuccess: async (saved, { status }) => {
      await queryClient.invalidateQueries({ queryKey: ['promotions'] });
      queryClient.setQueryData(['promotion', saved.id], saved);
      setEnding(undefined);
      toast(
        t(
          status === 'paused'
            ? 'promo.pausedToast'
            : status === 'ended'
              ? 'promo.endedToast'
              : 'promo.resumedToast',
        ),
      );
    },
    onError: (e) => toast(saveErrorMessage(e, t)),
  });

  const filtered = Boolean(search.q || search.kind);
  const reset = () => {
    setQ('');
    setFilter({ q: undefined, kind: undefined });
  };
  const dates = (p: Promotion) =>
    p.startsAt && p.endsAt
      ? `${dateOnly(locale, p.startsAt)} – ${dateOnly(locale, p.endsAt)}`
      : p.startsAt
        ? t('promo.sum.from', { date: dateOnly(locale, p.startsAt) })
        : p.endsAt
          ? t('promo.sum.until', { date: dateOnly(locale, p.endsAt) })
          : t('promo.noEnd');
  const how = (p: Promotion) =>
    p.kind === 'code' ? (
      p.code ? (
        <span className="rounded-md bg-muted px-1.5 font-mono text-xs font-medium">{p.code}</span>
      ) : (
        <span className="rounded-md bg-muted px-1.5 text-xs font-medium">
          {t('promo.codeTotal', { count: p.codeCount })}
        </span>
      )
    ) : (
      <span className="rounded-md border border-border px-1.5 text-xs font-medium">
        {t('promo.automatic')}
      </span>
    );
  const uses = (p: Promotion) =>
    p.usageLimit ? (
      <span className="inline-flex flex-col items-end gap-1">
        <span>
          {formatNumber(locale, p.usageCount)} / {formatNumber(locale, p.usageLimit)}
        </span>
        <span aria-hidden className="block h-1 w-20 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, (p.usageCount / p.usageLimit) * 100)}%` }}
          />
        </span>
      </span>
    ) : (
      formatNumber(locale, p.usageCount)
    );

  const columns: Column<Promotion>[] = [
    {
      header: t('promo.title'),
      cell: (p) => (
        <span className="flex flex-col items-start gap-1">
          <Link
            to="/promotions/$id"
            params={{ id: p.id }}
            className="font-medium underline-offset-2 hover:underline"
          >
            {title(p)}
          </Link>
          {how(p)}
        </span>
      ),
    },
    { header: t('promo.state'), cell: (p) => <StateChip state={p.state} /> },
    { header: t('promo.uses'), numeric: true, cell: uses },
    {
      header: t('promo.orders'),
      numeric: true,
      wide: true,
      cell: (p) => formatNumber(locale, p.orders),
    },
    {
      header: t('promo.discountGiven'),
      numeric: true,
      cell: (p) => (p.orders ? money(p.discountTotal) : '—'),
    },
    {
      header: t('promo.sales'),
      numeric: true,
      wide: true,
      cell: (p) => (p.orders ? money(p.sales) : '—'),
    },
    {
      header: t('promo.dates'),
      cell: (p) => <span className="whitespace-nowrap text-muted-foreground">{dates(p)}</span>,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t('nav.promotions')}
        description={t('promo.intro')}
        actions={
          canWrite && (
            <Button asChild>
              <Link to="/promotions/new">
                <Plus aria-hidden />
                {t('promo.new')}
              </Link>
            </Button>
          )
        }
      />
      <StageTabs
        label={t('promo.state')}
        tabs={[
          { key: 'all', label: t('list.all') },
          ...STATES.map((s) => ({ key: s, label: t(`promoState.${s}`) })),
        ]}
        value={search.state ?? 'all'}
        onChange={(key) => setFilter({ state: key === 'all' ? undefined : key })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-64 md:flex-none"
          label={t('promo.search')}
          value={q}
          onChange={setQ}
        />
        <FilterButtons
          filters={[
            {
              key: 'kind',
              label: t('promo.kind'),
              value: search.kind,
              options: [
                { value: 'automatic', label: t('promo.kind.automatic') },
                { value: 'code', label: t('promo.kind.code') },
              ],
              onChange: (v) => setFilter({ kind: v as PromotionSearch['kind'] }),
            },
          ]}
          onReset={filtered ? reset : undefined}
        />
      </div>
      <DataList
        label={t('nav.promotions')}
        items={promotions.data}
        rowKey={(p) => p.id}
        columns={columns}
        isPending={promotions.isPending}
        error={promotions.isError ? errorMessage(promotions.error, t) : undefined}
        onRetry={() => promotions.refetch()}
        empty={filtered || search.state ? t('promo.noMatches') : t('promo.empty')}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        onOpen={open}
        menu={(p) => (
          <RowMenu label={title(p)}>
            <RowMenuItem onSelect={() => open(p)}>
              <SquarePen aria-hidden />
              {t('list.open')}
            </RowMenuItem>
            {p.code && (
              <RowMenuItem
                onSelect={() =>
                  void navigator.clipboard
                    ?.writeText(p.code ?? '')
                    .then(() => toast(t('promo.codeCopied')))
                }
              >
                <Copy aria-hidden />
                {t('promo.copyCode')}
              </RowMenuItem>
            )}
            {canWrite && (p.state === 'live' || p.state === 'scheduled') && (
              <RowMenuItem onSelect={() => setStatus.mutate({ p, status: 'paused' })}>
                <Pause aria-hidden />
                {t('promo.pause')}
              </RowMenuItem>
            )}
            {canWrite && p.state === 'paused' && (
              <RowMenuItem onSelect={() => setStatus.mutate({ p, status: 'active' })}>
                <Play aria-hidden />
                {t('promo.resume')}
              </RowMenuItem>
            )}
            {canWrite &&
              (p.state === 'live' || p.state === 'paused' || p.state === 'scheduled') && (
                <>
                  <RowMenuSeparator />
                  <RowMenuItem danger onSelect={() => setEnding(p)}>
                    <CircleStop aria-hidden />
                    {t('promo.endNow')}
                  </RowMenuItem>
                </>
              )}
          </RowMenu>
        )}
        card={(p) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <Link to="/promotions/$id" params={{ id: p.id }} className="font-medium">
                {title(p)}
              </Link>
              <span className="flex flex-wrap items-center gap-1.5">
                {how(p)}
                <span className="text-xs text-muted-foreground">{dates(p)}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {t('promo.uses')}: {formatNumber(locale, p.usageCount)}
                {p.orders ? ` · ${money(p.discountTotal)}` : ''}
              </span>
            </div>
            <StateChip state={p.state} />
          </div>
        )}
      />
      {ending && (
        <ConfirmDialog
          open
          onOpenChange={(v) => !v && setEnding(undefined)}
          title={t('promo.endTitle', { title: title(ending) })}
          confirmLabel={t('promo.endNow')}
          busy={setStatus.isPending}
          onConfirm={() => setStatus.mutate({ p: ending, status: 'ended' })}
        >
          <p>{t('promo.endBody')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
