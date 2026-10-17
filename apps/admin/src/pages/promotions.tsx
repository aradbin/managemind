// The campaign list (phase-4-plan §3.13, §7): each promotion with where it
// stands, its uses, the orders that used it, the discount given and those
// orders' sales.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import '../i18n/promotions';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { dateOnly, pickText } from '../lib/orders';
import {
  type Promotion,
  type PromotionFilters,
  type PromotionState,
  promotionsQuery,
} from '../lib/promotions';

export type PromotionSearch = PromotionFilters;

const STATES = ['live', 'scheduled', 'draft', 'paused', 'ended'] as const;
const selectClass =
  'min-h-11 rounded-md border border-border bg-background px-3 text-base md:text-sm';

export function StateChip({ state }: { state: PromotionState }) {
  const { t } = useLocale();
  const tone =
    state === 'live'
      ? 'bg-success/15 text-success'
      : state === 'scheduled'
        ? 'bg-primary/10 text-primary'
        : state === 'paused'
          ? 'bg-warning text-warning-foreground'
          : 'bg-muted text-muted-foreground';
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {t(`promoState.${state}`)}
    </span>
  );
}

export function PromotionsPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as PromotionSearch;
  const navigate = useNavigate();
  const canWrite = usePermission('promotions.write');
  const [q, setQ] = useState(search.q ?? '');
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
  const columns: Column<Promotion>[] = [
    {
      header: t('promo.title'),
      cell: (p) => (
        <span className="flex flex-col">
          <Link
            to="/promotions/$id"
            params={{ id: p.id }}
            className="font-medium underline-offset-2 hover:underline"
          >
            {pickText(p.title, locale) || '—'}
          </Link>
          <span className="text-xs text-muted-foreground">
            {p.kind === 'code'
              ? p.code
                ? t('promo.codeIs', { code: p.code })
                : t('promo.codesCount', { count: p.codeCount })
              : t('promo.kind.automatic')}
          </span>
        </span>
      ),
    },
    { header: t('promo.state'), cell: (p) => <StateChip state={p.state} /> },
    {
      header: t('promo.uses'),
      cell: (p) => (p.usageLimit ? `${p.usageCount} / ${p.usageLimit}` : p.usageCount),
    },
    { header: t('promo.orders'), cell: (p) => p.orders },
    { header: t('promo.discountGiven'), cell: (p) => money(p.discountTotal) },
    { header: t('promo.sales'), cell: (p) => money(p.sales) },
    {
      header: t('promo.dates'),
      cell: (p) =>
        p.startsAt && p.endsAt
          ? `${dateOnly(locale, p.startsAt)} – ${dateOnly(locale, p.endsAt)}`
          : p.startsAt
            ? t('promo.sum.from', { date: dateOnly(locale, p.startsAt) })
            : p.endsAt
              ? t('promo.sum.until', { date: dateOnly(locale, p.endsAt) })
              : '—',
    },
  ];
  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('nav.promotions')}
        description={t('promo.intro')}
        actions={
          canWrite && (
            <Button asChild>
              <Link to="/promotions/new">
                <Plus aria-hidden className="size-4" />
                {t('promo.new')}
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <Input
          type="search"
          aria-label={t('promo.search')}
          placeholder={t('promo.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label={t('promo.state')}
          className={selectClass}
          value={search.state ?? ''}
          onChange={(e) => setFilter({ state: (e.target.value || undefined) as PromotionState })}
        >
          <option value="">{t('promo.allStates')}</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {t(`promoState.${s}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('promo.kind')}
          className={selectClass}
          value={search.kind ?? ''}
          onChange={(e) =>
            setFilter({ kind: (e.target.value || undefined) as PromotionSearch['kind'] })
          }
        >
          <option value="">{t('promo.allKinds')}</option>
          <option value="automatic">{t('promo.kind.automatic')}</option>
          <option value="code">{t('promo.kind.code')}</option>
        </select>
      </div>
      <DataList
        label={t('nav.promotions')}
        items={promotions.data}
        rowKey={(p) => p.id}
        columns={columns}
        isPending={promotions.isPending}
        error={promotions.isError ? errorMessage(promotions.error, t) : undefined}
        onRetry={() => promotions.refetch()}
        empty={Object.keys(search).length ? t('promo.noMatches') : t('promo.empty')}
      />
    </div>
  );
}
