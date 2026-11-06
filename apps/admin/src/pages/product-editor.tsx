// The product editor (phase-2-plan §7, PRs 10, 11, 13a): content in Bangla
// and English, description, status, categories, collections, tags,
// specifications, VAT, SEO; images; options and variants; stock. Content
// saves in one request; images, options and variants each save on their own,
// since they change other rows (options regenerate variants).
import { formatNumber } from '@managemind/shared/i18n';
import { type RichTextDoc, richTextToPlainText } from '@managemind/shared/rich-text';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type AttributeDraft,
  AttributeFields,
  draftsFrom,
  toInput,
} from '../components/catalog/attribute-fields';
import { ChipPicker } from '../components/catalog/chip-picker';
import { DescriptionField } from '../components/catalog/description-field';
import { ImageManager } from '../components/catalog/image-manager';
import {
  LANGUAGE_NAMES,
  type Lang,
  LanguageSwitch,
  otherLang,
} from '../components/catalog/language-tabs';
import { OptionEditor } from '../components/catalog/option-editor';
import { TagInput } from '../components/catalog/tag-input';
import { VariantTable } from '../components/catalog/variant-table';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { fieldHint, fieldLabel } from '../components/field-styles';
import { RowMenu, RowMenuItem, RowMenuSeparator } from '../components/list-tools';
import { Notice } from '../components/notice';
import { BackLink, PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { Combobox } from '../components/ui/combobox';
import { Input, Textarea } from '../components/ui/input';
import { menuContent, menuItem } from '../components/ui/menu';
import { useLocale } from '../i18n';
import { ApiError, api, unwrap } from '../lib/api';
import {
  categoriesQuery,
  categoryOptions,
  collectionsQuery,
  type Product,
  pick,
  productKeys,
  productQuery,
  storeSettingsQuery,
} from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { cn } from '../lib/utils';
import { StatusBadge } from './products';

interface Translation {
  title: string;
  slug: string;
  description: RichTextDoc | null;
  seoTitle: string;
  seoDescription: string;
}
interface Content {
  translations: Partial<Record<Lang, Translation>>;
  status: 'draft' | 'active' | 'archived';
  categoryIds: string[];
  collectionIds: string[];
  tags: string[];
  vatCategory: string;
  attributes: Record<string, AttributeDraft>;
}

const fromProduct = (p: Product): Content => ({
  translations: Object.fromEntries(
    (['bn', 'en'] as const)
      .filter((l) => p.translations[l])
      .map((l) => {
        const t = p.translations[l] as NonNullable<Product['translations']['en']>;
        return [
          l,
          {
            title: t.title,
            slug: t.slug,
            description: (t.description as RichTextDoc | null) ?? null,
            seoTitle: t.seoTitle ?? '',
            seoDescription: t.seoDescription ?? '',
          },
        ];
      }),
  ),
  status: p.status,
  categoryIds: p.categoryIds,
  collectionIds: p.collectionIds,
  tags: p.tags,
  vatCategory: p.vatCategory ?? '',
  attributes: draftsFrom(p.attributes),
});

export function ProductEditorPage({ id }: { id: string }) {
  const { t } = useLocale();
  const product = useQuery(productQuery(id));
  const store = useQuery(storeSettingsQuery);
  if (product.isPending || store.isPending) return <p role="status">{t('loading')}</p>;
  if (product.isError) {
    return (
      <Notice tone="error">
        {product.error instanceof ApiError && product.error.status === 404
          ? t('product.notFound')
          : errorMessage(product.error, t)}
      </Notice>
    );
  }
  if (store.isError) return <Notice tone="error">{errorMessage(store.error, t)}</Notice>;
  return (
    <Editor
      // A new key after options change remounts the parts holding variant drafts.
      key={product.data.id}
      product={product.data}
      defaultLang={store.data.defaultLocale}
      vat={store.data.tax}
    />
  );
}

function Editor({
  product,
  defaultLang,
  vat,
}: {
  product: Product;
  defaultLang: Lang;
  vat: { vatEnabled: boolean; categories: { key: string; name: string }[] };
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = usePermission('catalog.write');
  const [content, setContent] = useState<Content>(() => fromProduct(product));
  const [lang, setLang] = useState<Lang>(defaultLang);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const categories = useQuery(categoriesQuery);
  const collections = useQuery(collectionsQuery);
  const archived = product.status === 'archived';
  const disabled = !canWrite || archived;
  const title = pick(product.translations, locale)?.title ?? t('product.untitled');
  // Records ends the breadcrumb ("Catalog › Products › …"); phones drop the tab bar here.
  useRecordPage(title);

  const update = (patch: Partial<Content>) => {
    setContent((c) => ({ ...c, ...patch }));
    setDirty(true);
  };
  const setTranslation = (l: Lang, patch: Partial<Translation> | null) =>
    update({
      translations: {
        ...content.translations,
        [l]:
          patch === null
            ? undefined
            : { ...emptyTranslation, ...content.translations[l], ...patch },
      },
    });

  const after = async (saved: Product) => {
    queryClient.setQueryData(['product', product.id], saved);
    for (const k of productKeys()) await queryClient.invalidateQueries({ queryKey: k });
  };

  const save = useMutation({
    mutationFn: async () => {
      const attributes = toInput(content.attributes);
      if (!attributes) throw new Error('attribute_number');
      const translations = Object.fromEntries(
        (['bn', 'en'] as const).map((l) => {
          const tr = content.translations[l];
          if (!tr)
            return [l, l === defaultLang ? undefined : product.translations[l] ? null : undefined];
          return [
            l,
            {
              title: tr.title,
              ...(tr.slug.trim() ? { slug: tr.slug.trim() } : {}),
              ...(tr.description ? { description: tr.description } : {}),
              seoTitle: tr.seoTitle,
              seoDescription: tr.seoDescription,
            },
          ];
        }),
      );
      const manual = new Set(
        (collections.data ?? []).filter((c) => c.kind === 'manual').map((c) => c.id),
      );
      return unwrap(
        await api.PATCH('/v1/admin/products/{id}', {
          params: { path: { id: product.id } },
          body: {
            translations: translations as never,
            ...(content.status !== 'archived' ? { status: content.status } : {}),
            categoryIds: content.categoryIds,
            collectionIds: content.collectionIds.filter((c) => manual.has(c)),
            tags: content.tags,
            attributes: attributes as never,
            vatCategory: content.vatCategory || null,
          },
        }),
      );
    },
    onSuccess: async (saved) => {
      await after(saved);
      setContent(fromProduct(saved));
      setDirty(false);
      toast(t('product.saved'));
    },
  });

  const lifecycle = useMutation({
    mutationFn: async (action: 'archive' | 'delete' | 'restore') => {
      if (action === 'delete') {
        unwrap(
          await api.DELETE('/v1/admin/products/{id}', { params: { path: { id: product.id } } }),
        );
        return null;
      }
      if (action === 'archive') {
        return unwrap(
          await api.POST('/v1/admin/products/{id}/archive', {
            params: { path: { id: product.id } },
          }),
        );
      }
      return unwrap(
        await api.PATCH('/v1/admin/products/{id}', {
          params: { path: { id: product.id } },
          body: { status: 'draft' },
        }),
      );
    },
    onSuccess: async (saved, action) => {
      setConfirm(null);
      if (!saved) {
        for (const k of productKeys()) await queryClient.invalidateQueries({ queryKey: k });
        toast(t('product.deleted'));
        await navigate({ to: '/products' });
        return;
      }
      await after(saved);
      setContent(fromProduct(saved));
      toast(t(action === 'archive' ? 'product.archived' : 'product.restored'));
    },
  });

  const menu = (trigger: 'outline' | 'ghost') => (
    <RowMenu label={t('list.moreActions')} trigger={trigger} page>
      {product.status === 'active' && (
        <RowMenuItem onSelect={() => navigate({ to: '/products/$id', params: { id: product.id } })}>
          <Eye aria-hidden />
          {t('product.viewProduct')}
        </RowMenuItem>
      )}
      {archived ? (
        <RowMenuItem onSelect={() => lifecycle.mutate('restore')}>
          <ArchiveRestore aria-hidden />
          {t('product.restore')}
        </RowMenuItem>
      ) : (
        <>
          {product.status === 'active' && <RowMenuSeparator />}
          <RowMenuItem onSelect={() => setConfirm('archive')}>
            <Archive aria-hidden />
            {t('product.archive')}
          </RowMenuItem>
        </>
      )}
      {product.status === 'draft' && (
        <RowMenuItem danger onSelect={() => setConfirm('delete')}>
          <Trash2 aria-hidden />
          {t('product.deleteDraft')}
        </RowMenuItem>
      )}
    </RowMenu>
  );
  const present = new Set((['bn', 'en'] as const).filter((l) => content.translations[l]));
  const tr = content.translations[lang];
  const other = otherLang(defaultLang);
  const options = useMemo(
    () => categoryOptions(categories.data ?? [], locale),
    [categories.data, locale],
  );
  const manualCollections = (collections.data ?? []).filter((c) => c.kind === 'manual');
  const saveError =
    save.error instanceof Error && save.error.message === 'attribute_number'
      ? t('specs.invalidNumber')
      : save.isError
        ? saveErrorMessage(save.error, t)
        : undefined;
  // Collections, VAT and specifications stay folded until they hold something.
  const [moreOpen, setMoreOpen] = useState(
    () =>
      product.collectionIds.length > 0 ||
      product.attributes.length > 0 ||
      Boolean(product.vatCategory),
  );
  const [seoOpen, setSeoOpen] = useState(false);
  const store = useQuery(storeSettingsQuery);
  const storeBase = store.data
    ? (() => {
        const url = new URL(store.data.storeUrl);
        url.pathname = `${url.pathname.replace(/\/$/, '')}/products/`;
        return url;
      })()
    : null;
  const shown = tr ?? emptyTranslation;
  const slugNow = shown.slug || product.translations[lang]?.slug || '';
  const listingUrl = storeBase
    ? `${storeBase.host}${storeBase.pathname}${slugNow}${storeBase.search}`
    : slugNow;
  const plainDescription = shown.description ? richTextToPlainText(shown.description).trim() : '';

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 pb-28 md:gap-4 md:pb-8">
      <PhoneRecordHeader
        to="/products/$id"
        params={{ id: product.id }}
        backLabel={t('productView.backToProduct')}
        title={title}
      >
        {canWrite && !archived && (
          <StatusMenu status={content.status} onChange={(status) => update({ status })} compact />
        )}
        {menu('ghost')}
      </PhoneRecordHeader>
      <div className="flex items-center gap-3 pb-1 max-md:hidden">
        <BackLink
          to="/products/$id"
          params={{ id: product.id }}
          label={t('productView.backToProduct')}
        />
        <h1 className="min-w-0 flex-1 truncate text-xl leading-7 font-semibold tracking-[-0.01em]">
          {title}
        </h1>
        {archived ? (
          <StatusBadge status="archived" />
        ) : (
          canWrite && (
            <StatusMenu status={content.status} onChange={(status) => update({ status })} />
          )
        )}
        {canWrite && menu('outline')}
      </div>
      {archived && <Notice>{t('product.archivedHint')}</Notice>}
      {!canWrite && <Notice>{t('product.readOnly')}</Notice>}
      {saveError && <Notice tone="error">{saveError}</Notice>}

      <section aria-label={t('product.basics')} className={cardPadded}>
        <fieldset
          disabled={disabled}
          className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0 md:gap-5"
        >
          <div className="flex flex-col">
            <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
              <label htmlFor="product-title" className={cn(fieldLabel, 'mb-0')}>
                {t('product.titleLabel')}
              </label>
              {present.size > 1 || lang !== defaultLang ? (
                <LanguageSwitch defaultLang={defaultLang} active={lang} onChange={setLang} />
              ) : (
                !disabled && (
                  <Button
                    variant="ghost"
                    className="-mr-2 h-7 px-2 text-muted-foreground md:h-7"
                    onClick={() => {
                      setTranslation(other, {});
                      setLang(other);
                    }}
                  >
                    {t('product.addLang', { language: LANGUAGE_NAMES[other] })}
                  </Button>
                )
              )}
            </div>
            <Input
              id="product-title"
              lang={lang}
              aria-label={t('product.titleIn', { language: LANGUAGE_NAMES[lang] })}
              value={shown.title}
              maxLength={200}
              onChange={(e) => setTranslation(lang, { title: e.target.value })}
            />
            {lang !== defaultLang && !disabled && (
              <Button
                variant="ghost"
                className="mt-1 -ml-2 h-7 self-start px-2 text-muted-foreground md:h-7"
                onClick={() => {
                  setTranslation(lang, null);
                  setLang(defaultLang);
                }}
              >
                {t('product.removeTranslation', { language: LANGUAGE_NAMES[lang] })}
              </Button>
            )}
          </div>
          <DescriptionField
            key={lang}
            label={t('product.description')}
            lang={lang}
            value={shown.description}
            onChange={(description) => setTranslation(lang, { description })}
            disabled={disabled}
          />
          <ImageManager product={product} defaultLang={defaultLang} disabled={disabled} />
        </fieldset>
      </section>

      <section aria-labelledby="variants-heading" className={cn(cardPadded, 'gap-4 md:gap-4')}>
        <div className="flex min-h-5 items-center justify-between gap-3">
          <h2 id="variants-heading" className={cardTitle}>
            {t('product.variants')}
          </h2>
          <span className="text-[13px] text-muted-foreground">
            {[
              t('product.variantCount', { count: formatNumber(locale, product.variants.length) }),
              product.variants.some((v) => v.trackInventory && v.stock) &&
                t('product.availableCount', {
                  count: formatNumber(
                    locale,
                    product.variants.reduce(
                      (n, v) => n + (v.trackInventory && v.stock ? v.stock.available : 0),
                      0,
                    ),
                  ),
                }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <OptionEditor
          key={`options-${product.updatedAt}`}
          product={product}
          defaultLang={defaultLang}
          disabled={disabled}
        />
        <div className="-mx-4 -mb-4 min-w-0 overflow-x-auto border-t border-border md:-mx-5 md:-mb-5">
          <VariantTable
            key={product.variants.map((v) => v.id).join()}
            product={product}
            disabled={disabled}
          />
        </div>
      </section>

      <section aria-labelledby="organize-heading" className={cardPadded}>
        <h2 id="organize-heading" className={cardTitle}>
          {t('product.organise')}
        </h2>
        <ChipPicker
          label={t('catalog.categories')}
          searchLabel={t('product.findCategory')}
          empty={t('product.noCategories')}
          options={options.map((o) => ({ id: o.id, label: o.label }))}
          value={content.categoryIds}
          onChange={(categoryIds) => update({ categoryIds })}
          disabled={disabled}
        />
        <TagInput value={content.tags} onChange={(tags) => update({ tags })} disabled={disabled} />
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(!moreOpen)}
          className="-my-1 flex w-full items-center gap-1.5 py-1.5 text-left font-medium text-muted-foreground hover:text-foreground [&[aria-expanded=true]>svg]:rotate-90"
        >
          <ChevronRight aria-hidden className="size-4 transition-transform duration-200" />
          {t('product.moreOrganise')}
        </button>
        {moreOpen && (
          <div className="flex flex-col gap-4 border-t border-dashed border-border pt-4">
            <ChipPicker
              label={t('catalog.collections')}
              searchLabel={t('product.findCollection')}
              empty={t('product.noCollections')}
              options={manualCollections.map((c) => ({
                id: c.id,
                label: pick(c.translations, locale)?.name ?? '—',
              }))}
              value={content.collectionIds}
              onChange={(collectionIds) => update({ collectionIds })}
              disabled={disabled}
            />
            {vat.vatEnabled && vat.categories.length > 0 && (
              <div className="flex flex-col md:max-w-[calc(50%-8px)]">
                <label htmlFor="product-vat" className={fieldLabel}>
                  {t('product.vatCategory')}
                </label>
                <Combobox
                  id="product-vat"
                  searchLabel={t('product.findVat')}
                  disabled={disabled}
                  value={content.vatCategory}
                  options={[
                    { value: '', label: t('product.vatStandard') },
                    ...vat.categories.map((c) => ({ value: c.key, label: c.name })),
                  ]}
                  onChange={(vatCategory) => update({ vatCategory })}
                />
              </div>
            )}
            <AttributeFields
              categoryIds={content.categoryIds}
              value={content.attributes}
              onChange={(attributes) => update({ attributes })}
              defaultLang={defaultLang}
              disabled={disabled}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="seo-heading" className={cardPadded}>
        <div className="flex min-h-5 items-center justify-between gap-3">
          <h2 id="seo-heading" className={cardTitle}>
            {t('product.seoListing')}
          </h2>
          {!disabled && tr && (
            <Button
              variant="ghost"
              className="-my-1.5 -mr-2.5 h-8 px-2.5"
              aria-expanded={seoOpen}
              onClick={() => setSeoOpen(!seoOpen)}
            >
              {t(seoOpen ? 'product.seoDone' : 'product.seoEdit')}
            </Button>
          )}
        </div>
        {seoOpen && tr ? (
          <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            <div className="flex flex-col">
              <label htmlFor="product-slug" className={fieldLabel}>
                {t('product.slug')}
              </label>
              <div className="flex items-stretch">
                {storeBase && (
                  <span className="inline-flex items-center rounded-l-lg border border-r-0 border-input bg-muted px-2.5 text-[13px] whitespace-nowrap text-muted-foreground">
                    {storeBase.host}
                    {storeBase.pathname}
                  </span>
                )}
                <Input
                  id="product-slug"
                  className={cn(storeBase && 'rounded-l-none')}
                  value={shown.slug}
                  onChange={(e) => setTranslation(lang, { slug: e.target.value })}
                />
              </div>
              <p className={fieldHint}>{t('product.slugHint')}</p>
            </div>
            <Field
              label={t('product.seoTitleShort')}
              placeholder={shown.title}
              value={shown.seoTitle}
              maxLength={120}
              onChange={(e) => setTranslation(lang, { seoTitle: e.target.value })}
            />
            <div className="flex flex-col">
              <label htmlFor="product-seo-description" className={fieldLabel}>
                {t('product.seoDescriptionShort')}
              </label>
              <Textarea
                id="product-seo-description"
                aria-describedby="product-seo-count"
                maxLength={320}
                value={shown.seoDescription}
                onChange={(e) => setTranslation(lang, { seoDescription: e.target.value })}
              />
              <p id="product-seo-count" className={fieldHint}>
                {t('product.seoCount', {
                  count: formatNumber(locale, shown.seoDescription.length),
                  max: formatNumber(locale, 320),
                })}
              </p>
            </div>
          </fieldset>
        ) : (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] text-muted-foreground">{listingUrl}</span>
            <span className="truncate font-medium">{shown.seoTitle || shown.title || title}</span>
            {(shown.seoDescription || plainDescription) && (
              <span className="line-clamp-2 text-muted-foreground">
                {shown.seoDescription || plainDescription}
              </span>
            )}
          </div>
        )}
      </section>

      <SaveBar
        show={canWrite && !archived && dirty}
        message={t('product.unsaved')}
        discardLabel={t('product.discard')}
        onDiscard={() => {
          setContent(fromProduct(product));
          setDirty(false);
        }}
        saveLabel={t('product.save')}
        busy={save.isPending}
        onSave={() => save.mutate()}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'delete' ? t('product.deleteTitle') : t('product.archiveTitle')}
        confirmLabel={confirm === 'delete' ? t('product.delete') : t('product.archive')}
        busy={lifecycle.isPending}
        error={lifecycle.isError ? saveErrorMessage(lifecycle.error, t) : undefined}
        onConfirm={() => confirm && lifecycle.mutate(confirm)}
      >
        <p>{confirm === 'delete' ? t('product.deleteBody') : t('product.archiveBody')}</p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * Active or Draft, as the canvas draws it: an outline button with a dot that
 * opens the two choices with their hints. Saved with the rest of the page.
 */
function StatusMenu({
  status,
  onChange,
  compact = false,
}: {
  status: 'draft' | 'active' | 'archived';
  onChange: (status: 'draft' | 'active') => void;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const dot = (s: 'draft' | 'active') =>
    s === 'active' ? (
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
    ) : (
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground"
      />
    );
  const current = status === 'active' ? 'active' : 'draft';
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant={compact ? 'ghost' : 'secondary'}
          className="gap-2 pr-2 pl-2.5"
          aria-label={t('product.statusIs', { status: t(`status.${current}`) })}
        >
          {dot(current)}
          {t(`status.${current}`)}
          <ChevronDown aria-hidden className="size-4 opacity-50" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className={cn(menuContent, 'w-[260px]')}>
          <Menu.RadioGroup value={current} onValueChange={(v) => onChange(v as 'draft' | 'active')}>
            {(['active', 'draft'] as const).map((s) => (
              <Menu.RadioItem key={s} value={s} className={cn(menuItem, 'items-start py-1.5')}>
                <span className="mt-1.5 mx-1">{dot(s)}</span>
                <span className="flex flex-1 flex-col">
                  <span className="font-medium">{t(`status.${s}`)}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {t(`status.${s}.menuHint`)}
                  </span>
                </span>
                <Menu.ItemIndicator>
                  <Check aria-hidden className="mt-0.5 size-4" />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

const emptyTranslation: Translation = {
  title: '',
  slug: '',
  description: null,
  seoTitle: '',
  seoDescription: '',
};

/** A new product: the essentials, then the full editor. */
export function NewProductPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const store = useQuery(storeSettingsQuery);
  const [titles, setTitles] = useState<{ bn: string; en: string }>({ bn: '', en: '' });
  const [price, setPrice] = useState('');
  const [sku, setSku] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const defaultLang: Lang = store.data?.defaultLocale ?? 'bn';
  const other = otherLang(defaultLang);
  const create = useMutation({
    mutationFn: async () => {
      const { readPrice } = await import('../lib/catalog');
      const amount = readPrice(price);
      if (amount === undefined) throw new Error('price');
      return unwrap(
        await api.POST('/v1/admin/products', {
          headers: { 'idempotency-key': key },
          body: {
            translations: {
              [defaultLang]: { title: titles[defaultLang] },
              ...(titles[other].trim() ? { [other]: { title: titles[other] } } : {}),
            },
            ...(amount !== null || sku.trim()
              ? { variant: { price: amount ?? 0, ...(sku.trim() ? { sku: sku.trim() } : {}) } }
              : {}),
          },
        }),
      );
    },
    onSuccess: async (product) => {
      queryClient.setQueryData(['product', product.id], product);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await navigate({ to: '/products/$id/edit', params: { id: product.id }, replace: true });
    },
  });
  if (store.isPending) return <p role="status">{t('loading')}</p>;
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title={t('products.new')} description={t('products.newIntro')} />
      <form
        className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (titles[defaultLang].trim()) create.mutate();
        }}
      >
        <Field
          label={t('product.titleIn', { language: LANGUAGE_NAMES[defaultLang] })}
          lang={defaultLang}
          required
          value={titles[defaultLang]}
          onChange={(e) => setTitles({ ...titles, [defaultLang]: e.target.value })}
        />
        <Field
          label={`${t('product.titleIn', { language: LANGUAGE_NAMES[other] })} (${t('form.optional')})`}
          lang={other}
          value={titles[other]}
          onChange={(e) => setTitles({ ...titles, [other]: e.target.value })}
        />
        <Field
          label={t('product.price')}
          inputMode="decimal"
          hint={t('product.priceHint')}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Field
          label={`${t('variant.sku')} (${t('form.optional')})`}
          value={sku}
          onChange={(e) => setSku(e.target.value)}
        />
        {create.isError && (
          <Notice tone="error">
            {create.error instanceof Error && create.error.message === 'price'
              ? t('variant.invalidPrice')
              : saveErrorMessage(create.error, t)}
          </Notice>
        )}
        <div>
          <Button type="submit" disabled={create.isPending || !titles[defaultLang].trim()}>
            {t('products.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
