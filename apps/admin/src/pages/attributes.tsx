// Attributes (phase-2-plan §3.4, ADR 0017; ADR 0033): product facts shown as
// specifications and used as filters, searched and filtered by type. One side
// panel edits the names and units in both languages, the type and key (fixed
// after creation), where it shows in the store, and the choice values.
import { CATALOG_LIMITS, FILTERABLE_TYPES } from '@managemind/shared/catalog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  Hash,
  ListChecks,
  Plus,
  SquarePen,
  ToggleLeft,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import {
  LANGUAGE_NAMES,
  type Lang,
  LanguageTabs,
  otherLang,
} from '../components/catalog/language-tabs';
import { ConfirmDialog } from '../components/confirm-dialog';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import {
  FilterButtons,
  RowMenu,
  RowMenuItem,
  RowMenuSeparator,
  SearchInput,
} from '../components/list-tools';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { control, Input } from '../components/ui/input';
import { Sheet, SheetBody, SheetDelete, SheetFooter, SheetForm } from '../components/ui/sheet';
import { Switch } from '../components/ui/switch';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import { type Attribute, attributesQuery, pick, storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { cn } from '../lib/utils';

const TYPES = ['choice', 'multi_choice', 'number', 'text', 'boolean'] as const;
type AttrType = (typeof TYPES)[number];

const TYPE_ICONS = {
  choice: CircleDot,
  multi_choice: ListChecks,
  number: Hash,
  text: Type,
  boolean: ToggleLeft,
} as const;

export function AttributesPage() {
  const { t, locale } = useLocale();
  const canWrite = usePermission('catalog.write');
  const attributes = useQuery(attributesQuery);
  const [editing, setEditing] = useState<Attribute | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Attribute>();
  const [q, setQ] = useState('');
  const [type, setType] = useState<string>();
  const name = (a: Attribute) => pick(a.name, locale) ?? a.key;
  const words = q.trim().toLowerCase();
  const items = useMemo(
    () =>
      (attributes.data ?? []).filter(
        (a) =>
          (!type || a.type === type) &&
          (!words || [a.key, a.name.bn, a.name.en].join(' ').toLowerCase().includes(words)),
      ),
    [attributes.data, type, words],
  );
  const filtered = Boolean(words || type);
  const reset = () => {
    setQ('');
    setType(undefined);
  };
  const values = (a: Attribute) => {
    if (a.type !== 'choice' && a.type !== 'multi_choice') {
      return a.type === 'boolean' ? '—' : t('attributes.typedPerProduct');
    }
    const labels = a.values.map((v) => pick(v.label, locale)).filter(Boolean);
    return labels.length > 3
      ? `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`
      : labels.join(', ') || '—';
  };
  const inStore = (a: Attribute) =>
    [a.visible && t('attributes.productPage'), a.filterable && t('attributes.filter')]
      .filter(Boolean)
      .join(', ') || t('attributes.nowhere');
  const columns: Column<Attribute>[] = [
    {
      header: t('attributes.name'),
      cell: (a) => (
        <span className="flex flex-col items-start">
          <span className="flex items-center gap-2">
            {canWrite ? (
              <button
                type="button"
                className="font-medium underline-offset-2 hover:underline"
                onClick={() => setEditing(a)}
              >
                {name(a)}
              </button>
            ) : (
              <span className="font-medium">{name(a)}</span>
            )}
            {a.isSystem && (
              <span className="rounded-md border border-border px-1.5 text-xs font-medium text-muted-foreground">
                {t('attributes.builtIn')}
              </span>
            )}
          </span>
          <code className="font-mono text-xs text-muted-foreground">{a.key}</code>
        </span>
      ),
    },
    {
      header: t('attributes.type'),
      cell: (a) => {
        const Icon = TYPE_ICONS[a.type];
        return (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Icon aria-hidden className="size-4 text-muted-foreground" />
            {t(`attributes.type.${a.type}`)}
          </span>
        );
      },
    },
    {
      header: t('attributes.values'),
      wide: true,
      cell: (a) => <span className="text-muted-foreground">{values(a)}</span>,
    },
    { header: t('attributes.inStore'), cell: inStore },
    { header: t('attributes.products'), numeric: true, cell: (a) => a.productCount },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t('catalog.attributes')}
        description={t('attributes.intro')}
        actions={
          canWrite && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('attributes.new')}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-64 md:flex-none"
          label={t('attributes.search')}
          value={q}
          onChange={setQ}
        />
        <FilterButtons
          filters={[
            {
              key: 'type',
              label: t('attributes.type'),
              value: type,
              options: TYPES.map((x) => ({ value: x, label: t(`attributes.type.${x}`) })),
              onChange: setType,
            },
          ]}
          onReset={filtered ? reset : undefined}
        />
      </div>
      <DataList
        label={t('catalog.attributes')}
        items={attributes.data ? items : undefined}
        rowKey={(a) => a.id}
        columns={columns}
        isPending={attributes.isPending}
        error={attributes.isError ? errorMessage(attributes.error, t) : undefined}
        onRetry={() => attributes.refetch()}
        empty={filtered ? t('attributes.noMatches') : undefined}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        onOpen={canWrite ? setEditing : undefined}
        menu={
          canWrite
            ? (a) => (
                <RowMenu label={name(a)}>
                  <RowMenuItem onSelect={() => setEditing(a)}>
                    <SquarePen aria-hidden />
                    {t('attributes.edit')}
                  </RowMenuItem>
                  {!a.isSystem && (
                    <>
                      <RowMenuSeparator />
                      <RowMenuItem danger onSelect={() => setDeleting(a)}>
                        <Trash2 aria-hidden />
                        {t('action.delete')}
                      </RowMenuItem>
                    </>
                  )}
                </RowMenu>
              )
            : undefined
        }
        card={(a) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className="font-medium">{name(a)}</span>
                {a.isSystem && (
                  <span className="rounded-md border border-border px-1.5 text-xs font-medium text-muted-foreground">
                    {t('attributes.builtIn')}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(`attributes.type.${a.type}`)} · {inStore(a)}
              </span>
              <span className="truncate text-sm text-muted-foreground">{values(a)}</span>
            </div>
            <span className="shrink-0 text-sm tabular-nums">{a.productCount}</span>
          </div>
        )}
      />
      {editing && (
        <AttributeSheet
          attribute={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDelete={editing !== 'new' && !editing.isSystem ? () => setDeleting(editing) : undefined}
        />
      )}
      {deleting && (
        <DeleteAttribute
          attribute={deleting}
          onClose={(done) => {
            setDeleting(undefined);
            if (done) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** Deleting reaches every product with the attribute, so one in use asks for its key. */
function DeleteAttribute({
  attribute,
  onClose,
}: {
  attribute: Attribute;
  onClose: (done: boolean) => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/attributes/{id}', {
          params: { path: { id: attribute.id } },
        }),
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: attributesQuery.queryKey });
      toast(t('attributes.deleted', { count: result.removedFrom }));
      onClose(true);
    },
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose(false)}
      title={t('attributes.deleteTitle')}
      confirmLabel={t('action.delete')}
      busy={remove.isPending}
      error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
      onConfirm={() => remove.mutate()}
      {...(attribute.productCount > 0 ? { confirmText: attribute.key } : {})}
    >
      <p>{t('attributes.deleteBody', { count: attribute.productCount })}</p>
    </ConfirmDialog>
  );
}

interface ValueDraft {
  key: string;
  id?: string;
  label: Partial<Record<Lang, string>>;
}
let seq = 0;

function AttributeSheet({
  attribute,
  onClose,
  onDelete,
}: {
  attribute: Attribute | null;
  onClose: () => void;
  onDelete?: (() => void) | undefined;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const store = useQuery(storeSettingsQuery);
  const defaultLang: Lang = store.data?.defaultLocale ?? 'bn';
  const [lang, setLang] = useState<Lang>(defaultLang);
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
  const keyId = useId();
  const typeId = useId();
  const visibleId = useId();
  const filterId = useId();
  const hasValues = type === 'choice' || type === 'multi_choice';
  const ready =
    names[defaultLang].trim() !== '' && (Boolean(attribute) || /^[a-z][a-z0-9_]{0,39}$/.test(key));
  const missingOther = values.filter((v) => !v.label[otherLang(defaultLang)]?.trim()).length;

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
  const addValue = () => {
    const label = newValue.trim();
    setNewValue('');
    if (!label || values.length >= CATALOG_LIMITS.valuesPerAttribute) return;
    setValues([...values, { key: `v${++seq}`, label: { [lang]: label } }]);
  };
  const moveValue = (i: number, by: -1 | 1) => {
    const next = [...values];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + by, 0, item);
    setValues(next);
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={attribute ? t('attributes.edit') : t('attributes.new')}
      description={
        attribute ? t('attributes.usedBy', { count: attribute.productCount }) : undefined
      }
    >
      <SheetForm
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <SheetBody>
          <LanguageTabs
            defaultLang={defaultLang}
            active={lang}
            onChange={setLang}
            present={new Set((['bn', 'en'] as const).filter((l) => names[l].trim()))}
          >
            {(l) => (
              <div className="flex flex-col gap-4">
                <Field
                  lang={l}
                  label={`${t('attributes.name')} (${LANGUAGE_NAMES[l]}${l === defaultLang ? '' : `, ${t('form.optional')}`})`}
                  value={names[l]}
                  maxLength={100}
                  onChange={(e) => setNames({ ...names, [l]: e.target.value })}
                />
                {type === 'number' && (
                  <Field
                    lang={l}
                    label={`${t('attributes.unit')} (${LANGUAGE_NAMES[l]}, ${t('form.optional')})`}
                    value={units[l]}
                    maxLength={20}
                    onChange={(e) => setUnits({ ...units, [l]: e.target.value })}
                  />
                )}
              </div>
            )}
          </LanguageTabs>
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={typeId} className="text-sm font-medium">
                  {t('attributes.type')}
                </label>
                <select
                  id={typeId}
                  className={cn(control, 'min-h-10 md:min-h-9')}
                  value={type}
                  disabled={Boolean(attribute)}
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
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={keyId} className="text-sm font-medium">
                  {t('attributes.key')}
                </label>
                <input
                  id={keyId}
                  className={cn(control, 'min-h-10 font-mono md:min-h-9')}
                  value={key}
                  readOnly={Boolean(attribute)}
                  pattern="[a-z][a-z0-9_]*"
                  maxLength={40}
                  onChange={(e) => setKey(e.target.value.toLowerCase())}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {attribute ? t('attributes.fixed') : t('attributes.keyHint')}
            </p>
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">{t('attributes.inStore')}</legend>
            <div className="flex items-start justify-between gap-3">
              <label htmlFor={visibleId} className="flex flex-col text-sm">
                {t('attributes.visibleHint')}
                <span className="text-muted-foreground">{t('attributes.visibleSub')}</span>
              </label>
              <Switch id={visibleId} checked={visible} onCheckedChange={setVisible} />
            </div>
            {FILTERABLE_TYPES.includes(type) && (
              <div className="flex items-start justify-between gap-3">
                <label htmlFor={filterId} className="flex flex-col text-sm">
                  {t('attributes.filterableHint')}
                  <span className="text-muted-foreground">{t('attributes.filterableSub')}</span>
                </label>
                <Switch id={filterId} checked={filterable} onCheckedChange={setFilterable} />
              </div>
            )}
          </fieldset>
          {hasValues && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium">
                {t('attributes.values')}
                <span className="font-normal text-muted-foreground">
                  {t('attributes.valueCount', { count: values.length })}
                </span>
              </legend>
              <ul className="flex flex-col gap-2">
                {values.map((v, i) => (
                  <li key={v.key} className="flex items-center gap-1">
                    <Input
                      lang={lang}
                      aria-label={`${t('attributes.value')} ${i + 1} (${LANGUAGE_NAMES[lang]})`}
                      placeholder={v.label[otherLang(lang)] ?? ''}
                      value={v.label[lang] ?? ''}
                      onChange={(e) =>
                        setValues(
                          values.map((x) =>
                            x.key === v.key
                              ? { ...x, label: { ...x.label, [lang]: e.target.value } }
                              : x,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={i === 0}
                      aria-label={t('attributes.valueUp', { n: i + 1 })}
                      onClick={() => moveValue(i, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={i === values.length - 1}
                      aria-label={t('attributes.valueDown', { n: i + 1 })}
                      onClick={() => moveValue(i, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('attributes.valueRemove', { n: i + 1 })}
                      onClick={() => setValues(values.filter((x) => x.key !== v.key))}
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input
                  aria-label={t('attributes.newValue')}
                  placeholder={t('attributes.newValue')}
                  lang={lang}
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
              {values.length > 0 && missingOther > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('attributes.missingEnglish', { count: missingOther })}
                </p>
              )}
            </fieldset>
          )}
          {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        </SheetBody>
        <SheetFooter
          start={onDelete && <SheetDelete onClick={onDelete}>{t('action.delete')}</SheetDelete>}
        >
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={save.isPending || !ready}>
            {attribute ? t('action.save') : t('attributes.create')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </Sheet>
  );
}
