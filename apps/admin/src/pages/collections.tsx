// Collections (phase-2-plan §3.3, §7): a list, and an editor for a manual
// order (buttons to move, so a keyboard works) or rules (all conditions must
// match, Q7) with a live preview of what they match.
import { CATALOG_LIMITS } from '@managemind/shared/catalog';
import type { RichTextDoc } from '@managemind/shared/rich-text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DescriptionField } from '../components/catalog/description-field';
import { LANGUAGE_NAMES, type Lang, otherLang } from '../components/catalog/language-tabs';
import { CatalogNav } from '../components/catalog-nav';
import { ConfirmDialog } from '../components/confirm-dialog';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import {
  attributesQuery,
  type Collection,
  categoriesQuery,
  categoryOptions,
  collectionsQuery,
  formatPrice,
  pick,
  priceInput,
  readPrice,
  storeSettingsQuery,
} from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';

const selectClass =
  'min-h-11 rounded-md border border-border bg-background px-3 text-base md:text-sm';

export function CollectionsPage() {
  const { t, locale } = useLocale();
  const canWrite = usePermission('catalog.write');
  const collections = useQuery(collectionsQuery);
  const columns: Column<Collection>[] = [
    {
      header: t('collections.name'),
      cell: (c) => (
        <Link
          to="/catalog/collections/$id"
          params={{ id: c.id }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {pick(c.translations, locale)?.name ?? '—'}
        </Link>
      ),
    },
    {
      header: t('collections.kind'),
      cell: (c) => t(c.kind === 'manual' ? 'collections.manual' : 'collections.rule'),
    },
    { header: t('collections.products'), cell: (c) => c.productCount },
    {
      header: t('collections.visibility'),
      cell: (c) => t(c.published ? 'collections.published' : 'collections.hidden'),
    },
  ];
  return (
    <div className="max-w-5xl">
      <PageHeader
        title={t('catalog.collections')}
        description={t('collections.intro')}
        actions={
          canWrite && (
            <Button asChild>
              <Link to="/catalog/collections/$id" params={{ id: 'new' }}>
                <Plus aria-hidden className="size-4" />
                {t('collections.new')}
              </Link>
            </Button>
          )
        }
      />
      <CatalogNav />
      <DataList
        label={t('catalog.collections')}
        items={collections.data}
        rowKey={(c) => c.id}
        columns={columns}
        isPending={collections.isPending}
        error={collections.isError ? errorMessage(collections.error, t) : undefined}
        onRetry={() => collections.refetch()}
        empty={t('collections.empty')}
      />
    </div>
  );
}

// ---- Rules ---------------------------------------------------------------------------

type Condition =
  | { type: 'category'; categoryId: string }
  | { type: 'price'; min: number | null; max: number | null }
  | { type: 'title_contains'; text: string }
  | { type: 'created_within_days'; days: number }
  | { type: 'tag'; tag: string }
  | { type: 'brand'; valueId: string }
  | { type: 'attribute_value'; attributeId: string; valueId: string }
  | { type: 'attribute_range'; attributeId: string; min: number | null; max: number | null }
  | { type: 'attribute_boolean'; attributeId: string; value: boolean };

const CONDITION_TYPES = [
  'category',
  'price',
  'title_contains',
  'created_within_days',
  'tag',
  'brand',
  'attribute_value',
  'attribute_range',
  'attribute_boolean',
] as const;

const blank = (type: Condition['type']): Condition => {
  switch (type) {
    case 'category':
      return { type, categoryId: '' };
    case 'price':
      return { type, min: null, max: null };
    case 'title_contains':
      return { type, text: '' };
    case 'created_within_days':
      return { type, days: 30 };
    case 'tag':
      return { type, tag: '' };
    case 'brand':
      return { type, valueId: '' };
    case 'attribute_value':
      return { type, attributeId: '', valueId: '' };
    case 'attribute_range':
      return { type, attributeId: '', min: null, max: null };
    case 'attribute_boolean':
      return { type, attributeId: '', value: true };
  }
};

const complete = (c: Condition) => {
  switch (c.type) {
    case 'category':
      return Boolean(c.categoryId);
    case 'price':
    case 'attribute_range':
      return (
        (c.min !== null || c.max !== null) && ('attributeId' in c ? Boolean(c.attributeId) : true)
      );
    case 'title_contains':
      return Boolean(c.text.trim());
    case 'created_within_days':
      return c.days >= 1;
    case 'tag':
      return Boolean(c.tag.trim());
    case 'brand':
      return Boolean(c.valueId);
    case 'attribute_value':
      return Boolean(c.attributeId && c.valueId);
    case 'attribute_boolean':
      return Boolean(c.attributeId);
  }
};

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const { t, locale } = useLocale();
  const categories = useQuery(categoriesQuery);
  const attributes = useQuery(attributesQuery);
  const brand = attributes.data?.find((a) => a.key === 'brand');
  const typed = (types: string[]) => (attributes.data ?? []).filter((a) => types.includes(a.type));
  const attribute =
    'attributeId' in condition
      ? attributes.data?.find((a) => a.id === condition.attributeId)
      : undefined;
  const number = (
    value: number | null,
    set: (n: number | null) => void,
    label: string,
    price = false,
  ) => (
    <Input
      aria-label={label}
      placeholder={label}
      inputMode="decimal"
      defaultValue={price ? priceInput(value) : (value ?? '')}
      onBlur={(e) => {
        const v = price
          ? readPrice(e.target.value)
          : e.target.value.trim() === ''
            ? null
            : Number(e.target.value);
        set(v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? null : v);
      }}
    />
  );
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <select
          aria-label={t('rules.type')}
          className={`${selectClass} flex-1`}
          value={condition.type}
          onChange={(e) => onChange(blank(e.target.value as Condition['type']))}
        >
          {CONDITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`rules.${type}`)}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="icon" aria-label={t('rules.remove')} onClick={onRemove}>
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      {condition.type === 'category' && (
        <select
          aria-label={t('catalog.category')}
          className={selectClass}
          value={condition.categoryId}
          onChange={(e) => onChange({ ...condition, categoryId: e.target.value })}
        >
          <option value="">—</option>
          {categoryOptions(categories.data ?? [], locale).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      {condition.type === 'price' && (
        <div className="grid grid-cols-2 gap-2">
          {number(condition.min, (min) => onChange({ ...condition, min }), t('rules.min'), true)}
          {number(condition.max, (max) => onChange({ ...condition, max }), t('rules.max'), true)}
        </div>
      )}
      {condition.type === 'title_contains' && (
        <Input
          aria-label={t('rules.text')}
          value={condition.text}
          onChange={(e) => onChange({ ...condition, text: e.target.value })}
        />
      )}
      {condition.type === 'created_within_days' && (
        <Input
          aria-label={t('rules.days')}
          inputMode="numeric"
          value={String(condition.days)}
          onChange={(e) => onChange({ ...condition, days: Number(e.target.value) || 0 })}
        />
      )}
      {condition.type === 'tag' && (
        <Input
          aria-label={t('product.tags')}
          value={condition.tag}
          onChange={(e) => onChange({ ...condition, tag: e.target.value })}
        />
      )}
      {condition.type === 'brand' && (
        <select
          aria-label={t('attribute.brand')}
          className={selectClass}
          value={condition.valueId}
          onChange={(e) => onChange({ ...condition, valueId: e.target.value })}
        >
          <option value="">—</option>
          {(brand?.values ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {pick(v.label, locale)}
            </option>
          ))}
        </select>
      )}
      {(condition.type === 'attribute_value' ||
        condition.type === 'attribute_range' ||
        condition.type === 'attribute_boolean') && (
        <select
          aria-label={t('catalog.attributes')}
          className={selectClass}
          value={condition.attributeId}
          onChange={(e) => onChange({ ...condition, attributeId: e.target.value } as Condition)}
        >
          <option value="">—</option>
          {typed(
            condition.type === 'attribute_value'
              ? ['choice', 'multi_choice']
              : condition.type === 'attribute_range'
                ? ['number']
                : ['boolean'],
          ).map((a) => (
            <option key={a.id} value={a.id}>
              {pick(a.name, locale) ?? a.key}
            </option>
          ))}
        </select>
      )}
      {condition.type === 'attribute_value' && attribute && (
        <select
          aria-label={t('rules.value')}
          className={selectClass}
          value={condition.valueId}
          onChange={(e) => onChange({ ...condition, valueId: e.target.value })}
        >
          <option value="">—</option>
          {attribute.values.map((v) => (
            <option key={v.id} value={v.id}>
              {pick(v.label, locale)}
            </option>
          ))}
        </select>
      )}
      {condition.type === 'attribute_range' && (
        <div className="grid grid-cols-2 gap-2">
          {number(condition.min, (min) => onChange({ ...condition, min }), t('rules.min'))}
          {number(condition.max, (max) => onChange({ ...condition, max }), t('rules.max'))}
        </div>
      )}
      {condition.type === 'attribute_boolean' && (
        <select
          aria-label={t('rules.value')}
          className={selectClass}
          value={condition.value ? 'yes' : 'no'}
          onChange={(e) => onChange({ ...condition, value: e.target.value === 'yes' })}
        >
          <option value="yes">{t('specs.yes')}</option>
          <option value="no">{t('specs.no')}</option>
        </select>
      )}
    </li>
  );
}

// ---- Editor --------------------------------------------------------------------------

export function CollectionEditorPage({ id }: { id: string }) {
  const { t } = useLocale();
  const isNew = id === 'new';
  const collection = useQuery({ ...collectionsQuery, enabled: !isNew });
  const store = useQuery(storeSettingsQuery);
  if (store.isPending || (!isNew && collection.isPending))
    return <p role="status">{t('loading')}</p>;
  const found = collection.data?.find((c) => c.id === id);
  if (!isNew && !found) return <Notice tone="error">{t('collections.notFound')}</Notice>;
  return (
    <CollectionEditor
      key={id}
      collection={found ?? null}
      defaultLang={store.data?.defaultLocale ?? 'bn'}
    />
  );
}

function CollectionEditor({
  collection,
  defaultLang,
}: {
  collection: Collection | null;
  defaultLang: Lang;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = usePermission('catalog.write');
  const [kind, setKind] = useState<'manual' | 'rule'>(collection?.kind ?? 'manual');
  const [names, setNames] = useState<Record<Lang, string>>({
    bn: collection?.translations.bn?.name ?? '',
    en: collection?.translations.en?.name ?? '',
  });
  // Only a description that was changed is sent; one left alone stays.
  const [descriptions, setDescriptions] = useState<Partial<Record<Lang, RichTextDoc>>>({});
  const [published, setPublished] = useState(collection?.published ?? false);
  const [sort, setSort] = useState(collection?.sort ?? 'manual');
  const [conditions, setConditions] = useState<Condition[]>(
    ((collection?.rules as { conditions?: Condition[] } | null)?.conditions ?? []) as Condition[],
  );
  const [deleting, setDeleting] = useState(false);
  const other = otherLang(defaultLang);
  const ready = conditions.length > 0 && conditions.every(complete);

  const save = useMutation({
    mutationFn: async () => {
      const translations = Object.fromEntries(
        (['bn', 'en'] as const).map((l) => [
          l,
          names[l].trim()
            ? { name: names[l], ...(descriptions[l] ? { description: descriptions[l] } : {}) }
            : collection?.translations[l]
              ? null
              : undefined,
        ]),
      );
      const effectiveSort = kind === 'rule' && sort === 'manual' ? 'newest' : sort;
      if (!collection) {
        return unwrap(
          await api.POST('/v1/admin/collections', {
            body: (kind === 'manual'
              ? { kind, translations, sort: effectiveSort, published }
              : {
                  kind,
                  translations,
                  sort: effectiveSort,
                  published,
                  rules: { conditions },
                }) as never,
          }),
        );
      }
      return unwrap(
        await api.PATCH('/v1/admin/collections/{id}', {
          params: { path: { id: collection.id } },
          body: {
            translations: translations as never,
            sort: effectiveSort as never,
            published,
            ...(collection.kind === 'rule' ? { rules: { match: 'all', conditions } as never } : {}),
          },
        }),
      );
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: collectionsQuery.queryKey });
      toast(t('collections.saved'));
      if (!collection)
        await navigate({ to: '/catalog/collections/$id', params: { id: saved.id }, replace: true });
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/collections/{id}', {
          params: { path: { id: collection?.id as string } },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: collectionsQuery.queryKey });
      toast(t('collections.deleted'));
      await navigate({ to: '/catalog/collections' });
    },
  });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          to="/catalog/collections"
          className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('catalog.collections')}
        </Link>
        <PageHeader
          title={
            collection ? (pick(collection.translations, locale)?.name ?? '—') : t('collections.new')
          }
          actions={
            collection &&
            canWrite && (
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden className="size-4" />
                {t('action.delete')}
              </Button>
            )
          }
        />
      </div>
      <fieldset disabled={!canWrite} className="flex flex-col gap-4">
        {[defaultLang, other].map((l) => (
          <div key={l} className="flex flex-col gap-3">
            <Field
              lang={l}
              label={`${t('collections.name')} (${LANGUAGE_NAMES[l]}${l === defaultLang ? '' : `, ${t('form.optional')}`})`}
              value={names[l]}
              maxLength={100}
              onChange={(e) => setNames({ ...names, [l]: e.target.value })}
            />
            <DescriptionField
              label={`${t('product.description')} (${LANGUAGE_NAMES[l]})`}
              lang={l}
              value={
                (collection?.translations[l]?.description as RichTextDoc | null | undefined) ?? null
              }
              onChange={(doc) => setDescriptions((d) => ({ ...d, [l]: doc }))}
              disabled={!canWrite}
            />
          </div>
        ))}
        {!collection && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('collections.kind')}</legend>
            {(['manual', 'rule'] as const).map((k) => (
              <label key={k} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="kind"
                  className="size-5"
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                <span>
                  {t(`collections.${k}`)}{' '}
                  <span className="text-sm text-muted-foreground">
                    — {t(`collections.${k}.hint`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('collections.sort')}
          <select className={selectClass} value={sort} onChange={(e) => setSort(e.target.value)}>
            {(kind === 'manual'
              ? ['manual', 'newest', 'price_asc', 'price_desc', 'title_asc']
              : ['newest', 'price_asc', 'price_desc', 'title_asc']
            ).map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}` as 'sort.manual')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          {t('collections.publish')}
        </label>
        {kind === 'rule' && (
          <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
            <h2 id="rules-heading" className="font-semibold">
              {t('rules.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('rules.intro')}</p>
            <ul className="flex flex-col gap-2">
              {conditions.map((c, i) => (
                <ConditionRow
                  key={i}
                  condition={c}
                  onChange={(next) => setConditions(conditions.map((x, j) => (j === i ? next : x)))}
                  onRemove={() => setConditions(conditions.filter((_, j) => j !== i))}
                />
              ))}
            </ul>
            {conditions.length < CATALOG_LIMITS.rulesPerCollection && (
              <div>
                <Button
                  variant="secondary"
                  onClick={() => setConditions([...conditions, blank('category')])}
                >
                  <Plus aria-hidden className="size-4" />
                  {t('rules.add')}
                </Button>
              </div>
            )}
          </section>
        )}
      </fieldset>
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {canWrite && (
        <div>
          <Button
            disabled={save.isPending || !names[defaultLang].trim() || (kind === 'rule' && !ready)}
            onClick={() => save.mutate()}
          >
            {t('action.save')}
          </Button>
        </div>
      )}
      {collection && kind === 'rule' && (
        <RulePreview collectionId={collection.id} conditions={ready ? conditions : null} />
      )}
      {collection && collection.kind === 'manual' && (
        <ManualOrder collection={collection} disabled={!canWrite} />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('collections.deleteTitle')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('collections.deleteBody')}</p>
      </ConfirmDialog>
    </div>
  );
}

/** What the rules (saved or not) match right now. */
function RulePreview({
  collectionId,
  conditions,
}: {
  collectionId: string;
  conditions: Condition[] | null;
}) {
  const { t, locale } = useLocale();
  const [debounced, setDebounced] = useState(conditions);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(conditions), 400);
    return () => clearTimeout(timer);
  }, [conditions]);
  const preview = useQuery({
    queryKey: ['collection-preview', collectionId, debounced],
    queryFn: async () =>
      unwrap(
        await api.POST('/v1/admin/collections/{id}/preview', {
          params: { path: { id: collectionId } },
          body: { match: 'all', conditions: debounced as never },
        }),
      ),
    enabled: debounced !== null,
  });
  return (
    <section aria-labelledby="preview-heading" aria-live="polite" className="flex flex-col gap-2">
      <h2 id="preview-heading" className="font-semibold">
        {t('rules.preview')}
      </h2>
      {preview.isPending ? (
        <p className="text-muted-foreground">{debounced ? t('loading') : t('rules.incomplete')}</p>
      ) : preview.isError ? (
        <Notice tone="error">{errorMessage(preview.error, t)}</Notice>
      ) : (
        <>
          <p>{t('rules.matches', { count: preview.data.total })}</p>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {preview.data.items.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 p-2 text-sm">
                <Link
                  to="/products/$id"
                  params={{ id: p.id }}
                  className="underline-offset-2 hover:underline"
                >
                  {pick(p.titles, locale)}
                </Link>
                <span className="text-muted-foreground">
                  {p.minPrice === null ? '—' : formatPrice(p.minPrice, locale)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** A manual collection's products in order: add by search, move, remove. */
function ManualOrder({ collection, disabled }: { collection: Collection; disabled: boolean }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: ['collection-products', collection.id],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/collections/{id}/products', {
          params: { path: { id: collection.id }, query: { limit: 100 } },
        }),
      ),
  });
  const [items, setItems] = useState<{ id: string; title: string }[] | null>(null);
  const [q, setQ] = useState('');
  const found = useQuery({
    queryKey: ['products', { q }],
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/products', { params: { query: { q, limit: 10 } } })),
    enabled: q.trim().length > 1,
  });
  useEffect(() => {
    if (current.data && items === null) {
      setItems(current.data.items.map((p) => ({ id: p.id, title: pick(p.titles, locale) ?? '—' })));
    }
  }, [current.data, items, locale]);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT('/v1/admin/collections/{id}/products', {
          params: { path: { id: collection.id } },
          body: (items ?? []).map((i) => i.id),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: collectionsQuery.queryKey });
      await queryClient.invalidateQueries({ queryKey: ['collection-products', collection.id] });
      toast(t('collections.orderSaved'));
    },
  });
  if (!items) return <p role="status">{t('loading')}</p>;
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + by, 0, item);
    setItems(next);
  };
  return (
    <section aria-labelledby="order-heading" className="flex flex-col gap-3">
      <h2 id="order-heading" className="font-semibold">
        {t('collections.order')}
      </h2>
      {!disabled && (
        <div className="flex flex-col gap-2">
          <Input
            type="search"
            aria-label={t('collections.addProduct')}
            placeholder={t('collections.addProduct')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {found.data && (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {found.data.items
                .filter((p) => !items.some((i) => i.id === p.id))
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setItems([...items, { id: p.id, title: pick(p.titles, locale) ?? '—' }]);
                        setQ('');
                      }}
                    >
                      {pick(p.titles, locale)}
                      <Plus aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t('collections.noProducts')}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
          {items.map((item, i) => (
            <li key={item.id} className="flex items-center justify-between gap-2 p-2">
              <span className="text-sm">
                {i + 1}. {item.title}
              </span>
              {!disabled && (
                <span className="flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={i === 0}
                    aria-label={t('collections.up', { title: item.title })}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={i === items.length - 1}
                    aria-label={t('collections.down', { title: item.title })}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('collections.removeProduct', { title: item.title })}
                    onClick={() => setItems(items.filter((x) => x.id !== item.id))}
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {!disabled && (
        <div>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t('collections.saveOrder')}
          </Button>
        </div>
      )}
    </section>
  );
}
