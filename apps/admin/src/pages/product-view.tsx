// A product at a glance (ADR 0034, the canvas's ProductView): its photos,
// prices, description and details; the variants with their stock and what
// each sold in 30 days; the latest orders; the last 30 days; how it shows in
// the store. Edit opens the editor. Read-only: changes happen in the editor,
// the stock pages and the order pages.
import { formatNumber } from '@managemind/shared/i18n';
import { type RichTextDoc, richTextToPlainText } from '@managemind/shared/rich-text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  Copy,
  ExternalLink,
  ImageIcon,
  Pencil,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
} from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { RowMenu, RowMenuItem, RowMenuSeparator } from '../components/list-tools';
import { Notice } from '../components/notice';
import { BackLink } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { useToast } from '../components/toast';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardFrame, cardPadded, cardTitle } from '../components/ui/card';
import { menuLabel } from '../components/ui/menu';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import { ApiError, api, unwrap } from '../lib/api';
import {
  attributesQuery,
  categoriesQuery,
  categoryOptions,
  collectionsQuery,
  formatPrice,
  type Product,
  pick,
  productKeys,
  productQuery,
  storeSettingsQuery,
} from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { fileName } from '../lib/images';
import { dateOnly, dateTime } from '../lib/orders';
import { cn } from '../lib/utils';
import { StatusBadge } from './products';

const activityQuery = (id: string) => ({
  queryKey: ['product', id, 'activity'] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/products/{id}/activity', { params: { path: { id } } })),
});

export function ProductViewPage({ id }: { id: string }) {
  const { t, locale } = useLocale();
  const product = useQuery(productQuery(id));
  useRecordPage(
    product.data
      ? (pick(product.data.translations, locale)?.title ?? t('product.untitled'))
      : undefined,
    { tabBar: true },
  );
  if (product.isPending) return <p role="status">{t('loading')}</p>;
  if (product.isError) {
    return (
      <Notice tone="error">
        {product.error instanceof ApiError && product.error.status === 404
          ? t('product.notFound')
          : errorMessage(product.error, t)}
      </Notice>
    );
  }
  return <View product={product.data} />;
}

/** "৳1,850 – ৳2,150", or one price when all are the same. */
function range(values: number[], locale: 'bn' | 'en'): string | null {
  if (!values.length) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi
    ? formatPrice(lo, locale)
    : `${formatPrice(lo, locale)} – ${formatPrice(hi, locale)}`;
}

/** The SKUs' shared start ("NF-PJ-IV"), or the only SKU. */
function baseSku(skus: string[]): string | null {
  if (!skus.length) return null;
  if (skus.length === 1) return skus[0] as string;
  let prefix = skus[0] as string;
  for (const s of skus) while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
  prefix = prefix.replace(/[-_ ./]+$/, '');
  return prefix.length >= 3 ? prefix : null;
}

function View({ product: p }: { product: Product }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = usePermission('catalog.write');
  const canStock = usePermission('inventory.write');
  const canOrder = usePermission('orders.write');
  const canBuy = usePermission('purchasing.write');
  const activity = useQuery(activityQuery(p.id));
  const store = useQuery(storeSettingsQuery);
  const categories = useQuery(categoriesQuery);
  const collections = useQuery(collectionsQuery);
  const attributes = useQuery(attributesQuery);
  const [photo, setPhoto] = useState(0);
  const [archiving, setArchiving] = useState(false);

  const tr = pick(p.translations, locale);
  const title = tr?.title ?? t('product.untitled');
  const otherLang = locale === 'bn' ? 'en' : 'bn';
  const otherTitle = p.translations[otherLang]?.title;
  const variants = [...p.variants].sort((a, b) => a.position - b.position);
  const skus = variants.map((v) => v.sku).filter((s): s is string => Boolean(s));
  const sku = baseSku(skus);
  const prices = range(
    variants.map((v) => v.price),
    locale,
  );
  const compare = range(
    variants.map((v) => v.compareAtPrice).filter((x): x is number => x !== null),
    locale,
  );
  const costs = variants.every((v) => typeof v.costPrice === 'number')
    ? range(
        variants.map((v) => v.costPrice as number),
        locale,
      )
    : null;
  const description = tr?.description
    ? richTextToPlainText(tr.description as RichTextDoc).trim()
    : '';
  const media = [...p.media].sort((a, b) => a.position - b.position);
  const shown = media[photo] ?? media[0];
  const tracked = variants.filter((v) => v.trackInventory && v.stock);
  const available = tracked.reduce((n, v) => n + (v.stock?.available ?? 0), 0);
  const onHand = tracked.reduce((n, v) => n + (v.stock?.onHand ?? 0), 0);
  const isLow = (v: (typeof variants)[number]) =>
    v.trackInventory &&
    v.stock !== undefined &&
    v.lowStockThreshold !== null &&
    v.stock.available <= v.lowStockThreshold;
  const optionLabel = (v: (typeof variants)[number]) =>
    v.optionValueIds
      .map((id) => {
        for (const o of p.options) {
          const value = o.values.find((x) => x.id === id);
          if (value) return pick(value.label, locale) ?? '';
        }
        return '';
      })
      .filter(Boolean)
      .join(' / ');
  const optionNames = [...p.options]
    .sort((a, b) => a.position - b.position)
    .map((o) => pick(o.name, locale) ?? '')
    .filter(Boolean);
  const low = variants.find(isLow);
  const soldOf = (variantId: string) =>
    activity.data?.variants.find((v) => v.variantId === variantId)?.sold ?? 0;
  const slug = tr?.slug ?? p.translations[otherLang]?.slug;
  // The store's address may carry ?store= (local and preview stores).
  const storeLink =
    store.data && slug
      ? (() => {
          const url = new URL(store.data.storeUrl);
          url.pathname = `${url.pathname.replace(/\/$/, '')}/products/${slug}`;
          return url.toString();
        })()
      : null;
  const categoryNames = categoryOptions(categories.data ?? [], locale).filter((c) =>
    p.categoryIds.includes(c.id),
  );
  const collectionNames = (collections.data ?? [])
    .filter((c) => p.collectionIds.includes(c.id))
    .map((c) => pick(c.translations, locale)?.name ?? '—');
  const specs = p.attributes
    .map((a) => {
      const def = attributes.data?.find((x) => x.id === a.attributeId);
      const name = def ? (pick(def.name, locale) ?? a.key) : a.key;
      const value =
        a.valueIds.length > 0
          ? a.valueIds
              .map((id) => {
                const v = def?.values.find((x) => x.id === id);
                return v ? (pick(v.label, locale) ?? '') : '';
              })
              .filter(Boolean)
              .join(', ')
          : a.number !== null
            ? `${formatNumber(locale, a.number)}${def ? ` ${pick(def.unit, locale) ?? ''}` : ''}`.trim()
            : a.boolean !== null
              ? t(a.boolean ? 'specs.yes' : 'specs.no')
              : (pick(a.text, locale) ?? '');
      return { key: a.attributeId, name, value };
    })
    .filter((s) => s.value);
  const vatName = p.vatCategory
    ? (store.data?.tax.categories.find((c) => c.key === p.vatCategory)?.name ?? p.vatCategory)
    : t('product.vatStandard');

  const status = useMutation({
    mutationFn: async (next: 'draft' | 'active') =>
      unwrap(
        await api.PATCH('/v1/admin/products/{id}', {
          params: { path: { id: p.id } },
          body: { status: next },
        }),
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['product', p.id], saved);
      for (const k of productKeys()) await queryClient.invalidateQueries({ queryKey: k });
      toast(t(saved.status === 'active' ? 'productView.nowActive' : 'productView.nowDraft'));
    },
  });
  const archive = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/admin/products/{id}/archive', { params: { path: { id: p.id } } })),
    onSuccess: async (saved) => {
      setArchiving(false);
      queryClient.setQueryData(['product', p.id], saved);
      for (const k of productKeys()) await queryClient.invalidateQueries({ queryKey: k });
      toast(t('product.archived'));
    },
  });
  const copyLink = () =>
    storeLink &&
    navigator.clipboard?.writeText(storeLink).then(() => toast(t('productView.linkCopied')));

  const menu = (trigger: 'outline' | 'ghost') => (
    <RowMenu label={t('list.moreActions')} trigger={trigger} page>
      <RowMenuItem onSelect={() => navigate({ to: '/products/$id/edit', params: { id: p.id } })}>
        <Pencil aria-hidden />
        {t('productView.edit')}
      </RowMenuItem>
      {storeLink && p.status === 'active' && (
        <RowMenuItem onSelect={() => window.open(storeLink, '_blank', 'noopener')}>
          <ExternalLink aria-hidden />
          {t('productView.viewInStore')}
        </RowMenuItem>
      )}
      {storeLink && (
        <RowMenuItem onSelect={copyLink}>
          <Copy aria-hidden />
          {t('productView.copyLink')}
        </RowMenuItem>
      )}
      {canWrite && p.status !== 'archived' && (
        <>
          <RowMenuSeparator />
          <div className={menuLabel}>{t('productView.quick')}</div>
          <RowMenuItem
            disabled={status.isPending}
            onSelect={() => status.mutate(p.status === 'active' ? 'draft' : 'active')}
          >
            <SlidersHorizontal aria-hidden />
            {t(p.status === 'active' ? 'productView.makeDraft' : 'productView.makeActive')}
          </RowMenuItem>
        </>
      )}
      {canStock && tracked.length > 0 && (
        <RowMenuItem onSelect={() => navigate({ to: '/inventory', search: { q: sku ?? title } })}>
          <SlidersHorizontal aria-hidden />
          {t('productView.adjustStock')}
        </RowMenuItem>
      )}
      {canBuy && (
        <RowMenuItem onSelect={() => navigate({ to: '/inventory/purchase-orders/new' })}>
          <Truck aria-hidden />
          {t('productView.reorder')}
        </RowMenuItem>
      )}
      {canOrder && p.status === 'active' && (
        <RowMenuItem onSelect={() => navigate({ to: '/orders/new' })}>
          <ShoppingCart aria-hidden />
          {t('productView.newOrder')}
        </RowMenuItem>
      )}
      {canWrite && p.status !== 'archived' && (
        <>
          <RowMenuSeparator />
          <RowMenuItem onSelect={() => setArchiving(true)}>
            <Archive aria-hidden />
            {t('product.archive')}
          </RowMenuItem>
        </>
      )}
    </RowMenu>
  );

  const editLink = (
    <Button asChild>
      <Link to="/products/$id/edit" params={{ id: p.id }}>
        <Pencil aria-hidden />
        {t('productView.edit')}
      </Link>
    </Button>
  );
  const subline = [
    sku && t('productView.sku', { sku }),
    variants.length > 1 &&
      t('productView.variants', { count: formatNumber(locale, variants.length) }),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3 md:gap-5">
      <PhoneRecordHeader to="/products" backLabel={t('productView.back')} title={title}>
        <Button variant="secondary" asChild>
          <Link to="/products/$id/edit" params={{ id: p.id }}>
            {t('order.editShort')}
          </Link>
        </Button>
        {menu('ghost')}
      </PhoneRecordHeader>
      <div className="flex flex-wrap items-start gap-3 max-md:hidden">
        <BackLink to="/products" label={t('productView.back')} />
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
            <StatusBadge status={p.status} />
          </div>
          <p className="text-muted-foreground">
            {otherTitle && <span lang={otherLang}>{otherTitle}</span>}
            {otherTitle && subline.length > 0 && ' · '}
            {subline.join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          {editLink}
          {menu('outline')}
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:gap-5">
        <div className="flex min-w-0 flex-col gap-3 md:flex-[2_1_560px] md:gap-5">
          <section aria-label={t('productView.overview')} className={cardPadded}>
            <div className="flex flex-wrap gap-6">
              <div className="flex w-full flex-none flex-col gap-2 md:w-[264px]">
                <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[10px] border border-border bg-muted text-muted-foreground md:size-[264px]">
                  {shown && fileName(shown, 600) ? (
                    <img
                      src={`/api/admin/media/files/${fileName(shown, 600)}`}
                      alt={pick(shown.alt, locale) ?? ''}
                      className="size-full object-cover"
                    />
                  ) : (
                    <ImageIcon aria-hidden className="size-8" />
                  )}
                  {media.length > 0 && photo === 0 && (
                    <Badge className="absolute bottom-2.5 left-2.5 bg-background text-foreground">
                      {t('productView.mainPhoto')}
                    </Badge>
                  )}
                </div>
                {media.length > 1 && (
                  <div className="flex gap-2">
                    {media.slice(0, 4).map((m, i) => (
                      <button
                        key={m.mediaId}
                        type="button"
                        aria-pressed={photo === i}
                        aria-label={t('productView.photo', { n: formatNumber(locale, i + 1) })}
                        onClick={() => setPhoto(i)}
                        className="flex size-14 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted aria-pressed:border-2 aria-pressed:border-primary"
                      >
                        {fileName(m, 120) && (
                          <img
                            src={`/api/admin/media/files/${fileName(m, 120)}`}
                            alt=""
                            className="size-full object-cover"
                          />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex min-w-[260px] flex-1 flex-col gap-4">
                <div>
                  <p className="text-2xl leading-8 font-semibold tabular-nums">{prices ?? '—'}</p>
                  {(compare || costs) && (
                    <p className="mt-0.5 text-muted-foreground">
                      {compare && (
                        <>
                          <s>{compare}</s> {t('productView.compareAt')}
                        </>
                      )}
                      {compare && costs && ' · '}
                      {costs && t('productView.cost', { cost: costs })}
                    </p>
                  )}
                </div>
                {description && <p className="leading-[22px]">{description}</p>}
                <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5">
                  {categoryNames.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">{t('productView.category')}</dt>
                      <dd className="flex flex-wrap gap-x-2">
                        {categoryNames.map((c) => (
                          <Link
                            key={c.id}
                            to="/catalog/categories"
                            className="underline underline-offset-4"
                          >
                            {c.label}
                          </Link>
                        ))}
                      </dd>
                    </>
                  )}
                  {collectionNames.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">{t('catalog.collections')}</dt>
                      <dd className="flex flex-wrap gap-1.5">
                        {collectionNames.map((name) => (
                          <Chip key={name}>{name}</Chip>
                        ))}
                      </dd>
                    </>
                  )}
                  {specs.map((s) => (
                    <div key={s.key} className="contents">
                      <dt className="text-muted-foreground">{s.name}</dt>
                      <dd>{s.value}</dd>
                    </div>
                  ))}
                  {p.tags.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">{t('product.tags')}</dt>
                      <dd className="flex flex-wrap gap-1.5">
                        {p.tags.map((tag) => (
                          <Chip key={tag}>{tag}</Chip>
                        ))}
                      </dd>
                    </>
                  )}
                  {store.data?.tax.vatEnabled && (
                    <>
                      <dt className="text-muted-foreground">{t('product.vatCategory')}</dt>
                      <dd>{vatName}</dd>
                    </>
                  )}
                </dl>
              </div>
            </div>
          </section>

          <section aria-labelledby="variants-h" className={cn(cardFrame, 'flex flex-col')}>
            <div className="flex min-h-5 items-center justify-between gap-3 px-4 pt-4 pb-3 md:px-5 md:pt-5 md:pb-4">
              <h2 id="variants-h" className={cardTitle}>
                {t('product.variants')}
              </h2>
              {canStock && tracked.length > 0 && (
                <Button variant="ghost" className="-my-1.5 -mr-2.5 h-8 px-2.5" asChild>
                  <Link to="/inventory" search={{ q: sku ?? title }}>
                    {t('productView.adjustStock')}
                  </Link>
                </Button>
              )}
            </div>
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full border-collapse">
                <thead className="bg-muted">
                  <tr className="border-b border-border">
                    <th className="h-10 px-2 pl-4 text-left font-medium whitespace-nowrap md:pl-5">
                      {optionNames.join(' / ') || t('productView.variant')}
                    </th>
                    <th className="h-10 px-2 text-left font-medium whitespace-nowrap">
                      {t('variant.sku')}
                    </th>
                    <th className="h-10 px-2 text-right font-medium whitespace-nowrap">
                      {t('product.price')}
                    </th>
                    <th className="h-10 px-2 text-right font-medium whitespace-nowrap">
                      {t('productView.available')}
                    </th>
                    <th className="h-10 px-2 text-right font-medium whitespace-nowrap">
                      {t('productView.onHand')}
                    </th>
                    <th className="h-10 px-2 pr-4 text-right font-medium whitespace-nowrap md:pr-5">
                      {t('productView.sold30')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr
                      key={v.id}
                      className="border-b border-border last:border-b-0 hover:[&>td]:bg-muted/50"
                    >
                      <td className="h-11 px-2 pl-4 font-medium whitespace-nowrap md:pl-5">
                        {optionLabel(v) || title}
                      </td>
                      <td className="h-11 px-2 whitespace-nowrap text-muted-foreground">
                        {v.sku ?? '—'}
                      </td>
                      <td className="h-11 px-2 text-right whitespace-nowrap tabular-nums">
                        {formatPrice(v.price, locale)}
                      </td>
                      <td className="h-11 px-2 text-right whitespace-nowrap tabular-nums">
                        {v.trackInventory && v.stock ? (
                          isLow(v) ? (
                            <span className="font-medium text-danger">
                              {formatNumber(locale, v.stock.available)}
                              <span className="sr-only"> ({t('inventory.lowBadge')})</span>
                            </span>
                          ) : (
                            formatNumber(locale, v.stock.available)
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="h-11 px-2 text-right whitespace-nowrap tabular-nums">
                        {v.trackInventory && v.stock ? formatNumber(locale, v.stock.onHand) : '—'}
                      </td>
                      <td className="h-11 px-2 pr-4 text-right whitespace-nowrap tabular-nums md:pr-5">
                        {formatNumber(locale, soldOf(v.id))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {activity.data && activity.data.recentOrders.length > 0 && (
            <section aria-labelledby="recent-h" className={cn(cardFrame, 'flex flex-col')}>
              <div className="flex min-h-5 items-center justify-between gap-3 px-4 pt-4 pb-3 md:px-5 md:pt-5 md:pb-4">
                <h2 id="recent-h" className={cardTitle}>
                  {t('productView.recentOrders')}
                </h2>
              </div>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full border-collapse">
                  <thead className="bg-muted">
                    <tr className="border-b border-border">
                      <th className="h-10 px-2 pl-4 text-left font-medium whitespace-nowrap md:pl-5">
                        {t('productView.order')}
                      </th>
                      <th className="h-10 px-2 text-left font-medium whitespace-nowrap">
                        {t('productView.date')}
                      </th>
                      <th className="h-10 px-2 text-left font-medium whitespace-nowrap">
                        {t('order.customer')}
                      </th>
                      <th className="h-10 px-2 text-left font-medium whitespace-nowrap">
                        {t('productView.qty', {
                          option: optionNames.join(' / ') || t('productView.variant'),
                        })}
                      </th>
                      <th className="h-10 px-2 text-left font-medium whitespace-nowrap">
                        {t('productView.status')}
                      </th>
                      <th className="h-10 px-2 pr-4 text-right font-medium whitespace-nowrap md:pr-5">
                        {t('order.total')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.data.recentOrders.map((o) => (
                      <tr
                        key={o.id}
                        className="border-b border-border last:border-b-0 hover:[&>td]:bg-muted/50"
                      >
                        <td className="h-11 px-2 pl-4 whitespace-nowrap md:pl-5">
                          <Link
                            to="/orders/$id"
                            params={{ id: o.id }}
                            className="font-medium underline underline-offset-4"
                          >
                            {o.displayNumber}
                          </Link>
                        </td>
                        <td className="h-11 px-2 whitespace-nowrap text-muted-foreground">
                          {dateTime(locale, o.placedAt)}
                        </td>
                        <td className="h-11 px-2 whitespace-nowrap">{o.customerName}</td>
                        <td className="h-11 px-2 whitespace-nowrap">
                          {o.lines
                            .map((l) => {
                              const label = l.optionLabels
                                .map((x) => pick(x, locale) ?? '')
                                .filter(Boolean)
                                .join(' / ');
                              return `${label ? `${label} × ` : '× '}${formatNumber(locale, l.quantity)}`;
                            })
                            .join(', ')}
                        </td>
                        <td className="h-11 px-2 whitespace-nowrap">
                          <Badge>{t(`orderStatus.${o.status}` as AdminKey)}</Badge>
                        </td>
                        <td className="h-11 px-2 pr-4 text-right whitespace-nowrap tabular-nums md:pr-5">
                          {formatPrice(o.total, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3 max-md:order-first md:flex-[1_1_300px] md:gap-5 max-md:hidden md:flex">
          <Last30
            activity={activity.data}
            tracked={tracked.length > 0}
            available={available}
            onHand={onHand}
            lowText={
              low
                ? t('productView.lowLine', {
                    variant: optionLabel(low) || title,
                    count: formatNumber(locale, low.stock?.available ?? 0),
                  })
                : null
            }
          />
          <InStore
            link={storeLink}
            onCopy={copyLink}
            active={p.status === 'active'}
            title={tr?.seoTitle || title}
            description={tr?.seoDescription || description}
            line={
              p.status === 'active'
                ? categoryNames[0]
                  ? t('productView.shownIn', {
                      category: categoryNames[0].label,
                      count: formatNumber(locale, collectionNames.length),
                    })
                  : t('productView.shown')
                : p.status === 'draft'
                  ? t('productView.hiddenDraft')
                  : t('productView.hiddenArchived')
            }
          />
          <section aria-labelledby="activity-h" className={cardPadded}>
            <h2 id="activity-h" className={cardTitle}>
              {t('productView.activity')}
            </h2>
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5">
              <dt className="text-muted-foreground">{t('productView.updated')}</dt>
              <dd>{dateOnly(locale, p.updatedAt)}</dd>
              <dt className="text-muted-foreground">{t('productView.created')}</dt>
              <dd>{dateOnly(locale, p.createdAt)}</dd>
              <dt className="text-muted-foreground">{t('product.languages')}</dt>
              <dd>
                {(['bn', 'en'] as const)
                  .filter((l) => p.translations[l])
                  .map((l) => (l === 'bn' ? 'বাংলা' : 'English'))
                  .join(', ')}
              </dd>
            </dl>
          </section>
        </div>
        {/* Phones: the last 30 days and the store, under the product, as drawn. */}
        <div className="flex flex-col gap-3 md:hidden">
          <Last30
            activity={activity.data}
            tracked={tracked.length > 0}
            available={available}
            onHand={onHand}
            lowText={null}
          />
          <InStore
            link={storeLink}
            onCopy={copyLink}
            active={p.status === 'active'}
            title={tr?.seoTitle || title}
            description={tr?.seoDescription || description}
            line={null}
          />
        </div>
      </div>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t('product.archiveTitle')}
        confirmLabel={t('product.archive')}
        busy={archive.isPending}
        error={archive.isError ? saveErrorMessage(archive.error, t) : undefined}
        onConfirm={() => archive.mutate()}
      >
        <p>{t('product.archiveBody')}</p>
      </ConfirmDialog>
    </div>
  );
}

function Chip({ children }: { children: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md bg-secondary px-2 text-xs font-medium text-secondary-foreground">
      {children}
    </span>
  );
}

type Activity = Awaited<ReturnType<ReturnType<typeof activityQuery>['queryFn']>>;

function Last30({
  activity,
  tracked,
  available,
  onHand,
  lowText,
}: {
  activity: Activity | undefined;
  tracked: boolean;
  available: number;
  onHand: number;
  lowText: string | null;
}) {
  const { t, locale } = useLocale();
  const stat = 'flex flex-col gap-0.5 rounded-[10px] border border-border bg-card p-3';
  return (
    <section aria-labelledby="last30-h" className={cardPadded}>
      <h2 id="last30-h" className={cardTitle}>
        {t('productView.last30')}
      </h2>
      <div className="grid grid-cols-2 gap-2.5">
        <div className={stat}>
          <span className="text-[13px] text-muted-foreground">{t('productView.sold')}</span>
          <span className="text-xl leading-7 font-semibold tabular-nums">
            {activity ? formatNumber(locale, activity.sold) : '—'}
          </span>
        </div>
        <div className={stat}>
          <span className="text-[13px] text-muted-foreground">{t('productView.revenue')}</span>
          <span className="text-xl leading-7 font-semibold tabular-nums">
            {activity ? formatPrice(activity.revenue, locale) : '—'}
          </span>
        </div>
        {tracked && (
          <div className={stat}>
            <span className="text-[13px] text-muted-foreground">{t('productView.available')}</span>
            <span className="text-xl leading-7 font-semibold tabular-nums">
              {formatNumber(locale, available)}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('productView.onHandCount', { count: formatNumber(locale, onHand) })}
            </span>
          </div>
        )}
        {activity?.marginBp !== null && activity?.marginBp !== undefined && (
          <div className={stat}>
            <span className="text-[13px] text-muted-foreground">{t('productView.margin')}</span>
            <span className="text-xl leading-7 font-semibold tabular-nums">
              {formatNumber(locale, Math.round(activity.marginBp / 100))}%
            </span>
          </div>
        )}
      </div>
      {lowText && <p className="text-[13px] text-muted-foreground">{lowText}</p>}
    </section>
  );
}

function InStore({
  link,
  onCopy,
  active,
  title,
  description,
  line,
}: {
  link: string | null;
  onCopy: () => void;
  active: boolean;
  title: string;
  description: string;
  line: string | null;
}) {
  const { t } = useLocale();
  return (
    <section aria-labelledby="store-h" className={cardPadded}>
      <h2 id="store-h" className={cardTitle}>
        {t('productView.inStore')}
      </h2>
      {link && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {link.replace(/^https?:\/\//, '')}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('productView.copyLink')}
            onClick={onCopy}
          >
            <Copy aria-hidden />
          </Button>
          {active && (
            <Button variant="ghost" size="icon" asChild>
              <a
                href={link}
                target="_blank"
                rel="noopener"
                aria-label={t('productView.viewInStore')}
              >
                <ExternalLink aria-hidden />
              </a>
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-0.5 rounded-[10px] bg-muted p-3">
        <span className="text-xs text-muted-foreground">{t('productView.searchShows')}</span>
        <span className="font-medium">{title}</span>
        {description && <span className="line-clamp-2 text-muted-foreground">{description}</span>}
      </div>
      {line && <p className="text-muted-foreground">{line}</p>}
    </section>
  );
}
