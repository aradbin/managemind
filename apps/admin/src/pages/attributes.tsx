// Attributes (phase-2-plan §3.4, ADR 0017): product facts shown as
// specifications and used as filters. Names and units in both languages,
// the type (fixed after creation), the two flags, and choice values.
import { CATALOG_LIMITS, FILTERABLE_TYPES } from '@managemind/shared/catalog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useState } from 'react';
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
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import { type Attribute, attributesQuery, pick, storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';

const TYPES = ['choice', 'multi_choice', 'number', 'text', 'boolean'] as const;
type AttrType = (typeof TYPES)[number];

export function AttributesPage() {
  const { t, locale } = useLocale();
  const canWrite = usePermission('catalog.write');
  const attributes = useQuery(attributesQuery);
  const [editing, setEditing] = useState<Attribute | 'new' | null>(null);
  const columns: Column<Attribute>[] = [
    {
      header: t('attributes.name'),
      cell: (a) =>
        canWrite ? (
          <button
            type="button"
            className="min-h-11 font-medium underline-offset-2 hover:underline"
            onClick={() => setEditing(a)}
          >
            {pick(a.name, locale) ?? a.key}
          </button>
        ) : (
          (pick(a.name, locale) ?? a.key)
        ),
    },
    { header: t('attributes.key'), cell: (a) => <code className="text-sm">{a.key}</code> },
    { header: t('attributes.type'), cell: (a) => t(`attributes.type.${a.type}`) },
    {
      header: t('attributes.flags'),
      cell: (a) =>
        [
          a.filterable && t('attributes.filterable'),
          a.visible ? t('attributes.visible') : t('attributes.hidden'),
        ]
          .filter(Boolean)
          .join(', '),
    },
    {
      header: t('attributes.values'),
      cell: (a) => (a.type === 'choice' || a.type === 'multi_choice' ? a.values.length : '—'),
    },
    { header: t('attributes.products'), cell: (a) => a.productCount },
  ];
  return (
    <div className="max-w-5xl">
      <PageHeader
        title={t('catalog.attributes')}
        description={t('attributes.intro')}
        actions={
          canWrite && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden className="size-4" />
              {t('attributes.new')}
            </Button>
          )
        }
      />
      <CatalogNav />
      <DataList
        label={t('catalog.attributes')}
        items={attributes.data}
        rowKey={(a) => a.id}
        columns={columns}
        isPending={attributes.isPending}
        error={attributes.isError ? errorMessage(attributes.error, t) : undefined}
        onRetry={() => attributes.refetch()}
      />
      {editing && (
        <AttributeDialog
          attribute={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface ValueDraft {
  key: string;
  id?: string;
  label: Partial<Record<Lang, string>>;
}
let seq = 0;

function AttributeDialog({
  attribute,
  onClose,
}: {
  attribute: Attribute | null;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const store = useQuery(storeSettingsQuery);
  const defaultLang: Lang = store.data?.defaultLocale ?? 'bn';
  const other = otherLang(defaultLang);
  const [key, setKey] = useState(attribute?.key ?? '');
  const [type, setType] = useState<AttrType>(attribute?.type ?? 'choice');
  const [names, setNames] = useState<Record<Lang, string>>({
    bn: attribute?.name.bn ?? '',
    en: attribute?.name.en ?? '',
  });
  const [units, setUnits] = useState<Record<Lang, string>>({
    bn: attribute?.unit.bn ?? '',
    en: attribute?.unit.en ?? '',
  });
  const [filterable, setFilterable] = useState(attribute?.filterable ?? false);
  const [visible, setVisible] = useState(attribute?.visible ?? true);
  const [values, setValues] = useState<ValueDraft[]>(
    () =>
      attribute?.values.map((v) => ({
        key: `v${++seq}`,
        id: v.id,
        label: { ...v.label } as ValueDraft['label'],
      })) ?? [],
  );
  const [newValue, setNewValue] = useState('');
  const [deleting, setDeleting] = useState(false);
  const hasValues = type === 'choice' || type === 'multi_choice';

  const translations = () =>
    Object.fromEntries(
      (['bn', 'en'] as const).map((l) => [
        l,
        names[l].trim()
          ? { name: names[l], ...(type === 'number' ? { unit: units[l].trim() || null } : {}) }
          : attribute?.name[l]
            ? null
            : undefined,
      ]),
    );

  const save = useMutation({
    mutationFn: async () => {
      let saved: Attribute;
      if (!attribute) {
        saved = unwrap(
          await api.POST('/v1/admin/attributes', {
            body: {
              key: key.trim(),
              type,
              translations: translations() as never,
              filterable,
              visible,
            },
          }),
        );
      } else {
        saved = unwrap(
          await api.PATCH('/v1/admin/attributes/{id}', {
            params: { path: { id: attribute.id } },
            body: { translations: translations() as never, filterable, visible },
          }),
        );
      }
      if (hasValues) {
        saved = unwrap(
          await api.PUT('/v1/admin/attributes/{id}/values', {
            params: { path: { id: saved.id } },
            body: values.map((v) => ({
              ...(v.id ? { id: v.id } : {}),
              label: Object.fromEntries(Object.entries(v.label).filter(([, x]) => x?.trim())),
            })) as never,
          }),
        );
      }
      return saved;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: attributesQuery.queryKey });
      toast(t('attributes.saved'));
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/attributes/{id}', {
          params: { path: { id: attribute?.id as string } },
        }),
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: attributesQuery.queryKey });
      toast(t('attributes.deleted', { count: result.removedFrom }));
      onClose();
    },
  });
  const addValue = () => {
    const label = newValue.trim();
    setNewValue('');
    if (!label || values.length >= CATALOG_LIMITS.valuesPerAttribute) return;
    setValues([...values, { key: `v${++seq}`, label: { [defaultLang]: label } }]);
  };
  const moveValue = (i: number, by: -1 | 1) => {
    const next = [...values];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + by, 0, item);
    setValues(next);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={attribute ? (pick(attribute.name, locale) ?? attribute.key) : t('attributes.new')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {[defaultLang, other].map((l) => (
          <Field
            key={l}
            lang={l}
            label={`${t('attributes.name')} (${LANGUAGE_NAMES[l]}${l === defaultLang ? '' : `, ${t('form.optional')}`})`}
            value={names[l]}
            maxLength={100}
            onChange={(e) => setNames({ ...names, [l]: e.target.value })}
          />
        ))}
        {!attribute && (
          <>
            <Field
              label={t('attributes.key')}
              hint={t('attributes.keyHint')}
              value={key}
              pattern="[a-z][a-z0-9_]*"
              maxLength={40}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
            />
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('attributes.type')}
              <select
                className="min-h-11 rounded-md border border-border bg-background px-3 text-base font-normal md:text-sm"
                value={type}
                onChange={(e) => {
                  const next = e.target.value as AttrType;
                  setType(next);
                  if (!FILTERABLE_TYPES.includes(next)) setFilterable(false);
                }}
              >
                {TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`attributes.type.${x}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {type === 'number' &&
          [defaultLang, other].map((l) => (
            <Field
              key={l}
              lang={l}
              label={`${t('attributes.unit')} (${LANGUAGE_NAMES[l]}, ${t('form.optional')})`}
              value={units[l]}
              maxLength={20}
              onChange={(e) => setUnits({ ...units, [l]: e.target.value })}
            />
          ))}
        {FILTERABLE_TYPES.includes(type) && (
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={filterable}
              onChange={(e) => setFilterable(e.target.checked)}
            />
            {t('attributes.filterableHint')}
          </label>
        )}
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
          />
          {t('attributes.visibleHint')}
        </label>
        {hasValues && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">{t('attributes.values')}</legend>
            <ul className="flex flex-col gap-2">
              {values.map((v, i) => (
                <li key={v.key} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1">
                  {[defaultLang, other].map((l) => (
                    <Input
                      key={l}
                      lang={l}
                      aria-label={`${t('attributes.value')} ${i + 1} (${LANGUAGE_NAMES[l]})`}
                      placeholder={LANGUAGE_NAMES[l]}
                      value={v.label[l] ?? ''}
                      onChange={(e) =>
                        setValues(
                          values.map((x) =>
                            x.key === v.key
                              ? { ...x, label: { ...x.label, [l]: e.target.value } }
                              : x,
                          ),
                        )
                      }
                    />
                  ))}
                  <span className="flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={i === 0}
                      aria-label={t('attributes.valueUp', { n: i + 1 })}
                      onClick={() => moveValue(i, -1)}
                    >
                      <ArrowUp aria-hidden className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={i === values.length - 1}
                      aria-label={t('attributes.valueDown', { n: i + 1 })}
                      onClick={() => moveValue(i, 1)}
                    >
                      <ArrowDown aria-hidden className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('attributes.valueRemove', { n: i + 1 })}
                      onClick={() => setValues(values.filter((x) => x.key !== v.key))}
                    >
                      <X aria-hidden className="size-4" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                aria-label={t('attributes.newValue')}
                placeholder={t('attributes.newValue')}
                lang={defaultLang}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addValue();
                  }
                }}
              />
              <Button variant="secondary" onClick={addValue}>
                {t('options.addValue')}
              </Button>
            </div>
          </fieldset>
        )}
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-between">
          {attribute && !attribute.isSystem ? (
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              {t('action.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 md:flex-row">
            <Button variant="ghost" onClick={onClose}>
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                save.isPending ||
                !names[defaultLang].trim() ||
                (!attribute && !/^[a-z][a-z0-9_]{0,39}$/.test(key))
              }
            >
              {t('action.save')}
            </Button>
          </div>
        </div>
      </form>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('attributes.deleteTitle')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
        {...(attribute && attribute.productCount > 0 ? { confirmText: attribute.key } : {})}
      >
        <p>{t('attributes.deleteBody', { count: attribute?.productCount ?? 0 })}</p>
      </ConfirmDialog>
    </Dialog>
  );
}
