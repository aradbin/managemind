// The product editor (phase-2-plan §7, PRs 10, 11, 13a): content in Bangla
// and English, description, status, categories, collections, tags,
// specifications, VAT, SEO; images; options and variants; stock. Content
// saves in one request; images, options and variants each save on their own,
// since they change other rows (options regenerate variants).
import type { RichTextDoc } from '@managemind/shared/rich-text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';
import {
  type AttributeDraft,
  AttributeFields,
  draftsFrom,
  toInput,
} from '../components/catalog/attribute-fields';
import { DescriptionField } from '../components/catalog/description-field';
import { ImageManager } from '../components/catalog/image-manager';
import {
  LANGUAGE_NAMES,
  type Lang,
  LanguageTabs,
  otherLang,
} from '../components/catalog/language-tabs';
import { OptionEditor } from '../components/catalog/option-editor';
import { TagInput } from '../components/catalog/tag-input';
import { VariantTable } from '../components/catalog/variant-table';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
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

  const present = new Set((['bn', 'en'] as const).filter((l) => content.translations[l]));
  const tr = content.translations[lang];
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

  return (
    <div className="flex flex-col gap-5 pb-28 md:pb-8">
      <div>
        <PageHeader
          className="mb-3"
          parent={{ to: '/products', label: t('catalog.products') }}
          title={title}
          actions={
            canWrite && (
              <>
                {archived ? (
                  <Button variant="secondary" onClick={() => lifecycle.mutate('restore')}>
                    {t('product.restore')}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirm('archive')}>
                    {t('product.archive')}
                  </Button>
                )}
                {product.status === 'draft' && (
                  <Button variant="quiet" onClick={() => setConfirm('delete')}>
                    {t('product.delete')}
                  </Button>
                )}
              </>
            )
          }
        />
        <div className="flex items-center gap-2">
          <StatusBadge status={product.status} />
          {archived && (
            <span className="text-sm text-muted-foreground">{t('product.archivedHint')}</span>
          )}
        </div>
        {!canWrite && (
          <div className="mt-3">
            <Notice>{t('product.readOnly')}</Notice>
          </div>
        )}
      </div>

      {canWrite && !archived && dirty && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 bg-foreground px-4 py-3 text-background md:sticky md:top-16 md:bottom-auto md:rounded-xl">
          <span className="flex-1 text-sm font-medium">{t('product.unsaved')}</span>
          <Button
            variant="secondary"
            className="text-foreground"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('product.save')}
          </Button>
        </div>
      )}
      {saveError && <Notice tone="error">{saveError}</Notice>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section
            aria-labelledby="content-heading"
            className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5"
          >
            <h2 id="content-heading" className="font-semibold">
              {t('product.content')}
            </h2>
            <LanguageTabs
              defaultLang={defaultLang}
              active={lang}
              onChange={setLang}
              present={present}
            >
              {(l) =>
                tr || l === defaultLang ? (
                  <TranslationFields
                    key={l}
                    lang={l}
                    value={tr ?? emptyTranslation}
                    onChange={(patch) => setTranslation(l, patch)}
                    disabled={disabled}
                    onRemove={l === defaultLang ? undefined : () => setTranslation(l, null)}
                  />
                ) : (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-muted-foreground">
                      {t('product.noTranslation', { language: LANGUAGE_NAMES[l] })}
                    </p>
                    {!disabled && (
                      <Button variant="secondary" onClick={() => setTranslation(l, {})}>
                        {t('product.addTranslation', { language: LANGUAGE_NAMES[l] })}
                      </Button>
                    )}
                  </div>
                )
              }
            </LanguageTabs>
          </section>

          <div className="rounded-xl border border-border bg-background p-4 md:p-5">
            <ImageManager product={product} defaultLang={defaultLang} disabled={disabled} />
          </div>
          <div className="rounded-xl border border-border bg-background p-4 md:p-5">
            <OptionEditor
              key={`options-${product.updatedAt}`}
              product={product}
              defaultLang={defaultLang}
              disabled={disabled}
            />
          </div>
          <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-background p-4 md:p-5">
            <VariantTable
              key={product.variants.map((v) => v.id).join()}
              product={product}
              disabled={disabled}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {!archived && (
            <div className="rounded-xl border border-border bg-background p-4 md:p-5">
              <fieldset className="flex flex-col gap-2" disabled={disabled}>
                <legend className="mb-2 font-semibold">{t('product.status')}</legend>
                {(['draft', 'active'] as const).map((s) => (
                  <label
                    key={s}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3',
                      content.status === s && 'border-primary bg-primary-soft',
                    )}
                  >
                    <input
                      type="radio"
                      name="status"
                      className="mt-0.5 size-5 accent-primary"
                      checked={content.status === s}
                      onChange={() => update({ status: s })}
                    />
                    <span className="flex flex-col">
                      <span className="font-medium">{t(`status.${s}`)}</span>
                      <span className="text-sm text-muted-foreground">
                        — {t(`status.${s}.hint`)}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>
          )}
          <section
            aria-labelledby="organize-heading"
            className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5"
          >
            <h2 id="organize-heading" className="font-semibold">
              {t('product.organize')}
            </h2>
            <CheckboxList
              legend={t('catalog.categories')}
              empty={t('product.noCategories')}
              items={options.map((o) => ({ id: o.id, label: o.label }))}
              checked={content.categoryIds}
              onChange={(categoryIds) => update({ categoryIds })}
              disabled={disabled}
            />
            <CheckboxList
              legend={t('catalog.collections')}
              empty={t('product.noCollections')}
              items={manualCollections.map((c) => ({
                id: c.id,
                label: pick(c.translations, locale)?.name ?? '—',
              }))}
              checked={content.collectionIds}
              onChange={(collectionIds) => update({ collectionIds })}
              disabled={disabled}
            />
            <TagInput
              value={content.tags}
              onChange={(tags) => update({ tags })}
              disabled={disabled}
            />
            {vat.vatEnabled && vat.categories.length > 0 && (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t('product.vatCategory')}
                <select
                  disabled={disabled}
                  className="min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm font-normal"
                  value={content.vatCategory}
                  onChange={(e) => update({ vatCategory: e.target.value })}
                >
                  <option value="">{t('product.vatStandard')}</option>
                  {vat.categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

          <div className="rounded-xl border border-border bg-background p-4 md:p-5">
            <AttributeFields
              categoryIds={content.categoryIds}
              value={content.attributes}
              onChange={(attributes) => update({ attributes })}
              defaultLang={defaultLang}
              disabled={disabled}
            />
          </div>
        </div>
      </div>

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

const emptyTranslation: Translation = {
  title: '',
  slug: '',
  description: null,
  seoTitle: '',
  seoDescription: '',
};

function TranslationFields({
  lang,
  value,
  onChange,
  disabled,
  onRemove,
}: {
  lang: Lang;
  value: Translation;
  onChange: (patch: Partial<Translation>) => void;
  disabled: boolean;
  onRemove: (() => void) | undefined;
}) {
  const { t } = useLocale();
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4">
      <Field
        label={t('product.titleIn', { language: LANGUAGE_NAMES[lang] })}
        value={value.title}
        maxLength={200}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <DescriptionField
        label={t('product.description')}
        lang={lang}
        value={value.description}
        onChange={(description) => onChange({ description })}
        disabled={disabled}
      />
      <details className="rounded-lg border border-border bg-background p-3">
        <summary className="min-h-11 cursor-pointer content-center font-medium">
          {t('product.seo')}
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <Field
            label={t('product.slug')}
            hint={t('product.slugHint')}
            value={value.slug}
            onChange={(e) => onChange({ slug: e.target.value })}
          />
          <Field
            label={t('product.seoTitle')}
            value={value.seoTitle}
            maxLength={120}
            onChange={(e) => onChange({ seoTitle: e.target.value })}
          />
          <Field
            label={t('product.seoDescription')}
            value={value.seoDescription}
            maxLength={320}
            onChange={(e) => onChange({ seoDescription: e.target.value })}
          />
        </div>
      </details>
      {onRemove && (
        <div>
          <Button variant="ghost" onClick={onRemove}>
            {t('product.removeTranslation', { language: LANGUAGE_NAMES[lang] })}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

/** A labelled group of checkboxes, scrolling when long. */
function CheckboxList({
  legend,
  empty,
  items,
  checked,
  onChange,
  disabled,
}: {
  legend: string;
  empty: string;
  items: { id: string; label: string }[];
  checked: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <fieldset
      className="flex flex-col gap-1"
      disabled={disabled}
      aria-describedby={items.length ? undefined : `${id}-empty`}
    >
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {items.length === 0 ? (
        <p id={`${id}-empty`} className="text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="max-h-60 overflow-y-auto rounded-lg border border-border bg-background p-2">
          {items.map((item) => (
            <label key={item.id} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={checked.includes(item.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...checked, item.id] : checked.filter((x) => x !== item.id),
                  )
                }
              />
              {item.label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

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
      await navigate({ to: '/products/$id', params: { id: product.id }, replace: true });
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
