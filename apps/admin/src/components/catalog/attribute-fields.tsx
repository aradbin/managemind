// Specifications (phase-2-plan §3.4): the attributes of the product's
// categories (and their parents) first, then any others the product has, and
// "add" for the rest. Nothing is required. Choice values are the attribute's
// own, so filters work across products.
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useId } from 'react';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { type Attribute, attributesQuery, pick } from '../../lib/catalog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { LANGUAGE_NAMES, type Lang, otherLang } from './language-tabs';

/** The editor's state for one attribute: what the API's ProductAttributeInput carries. */
export type AttributeDraft =
  | { type: 'choice' | 'multi_choice'; attributeId: string; valueIds: string[] }
  | { type: 'number'; attributeId: string; number: string }
  | { type: 'boolean'; attributeId: string; value: boolean | null }
  | { type: 'text'; attributeId: string; text: { bn?: string; en?: string } };

export function emptyDraft(attribute: Attribute): AttributeDraft {
  switch (attribute.type) {
    case 'choice':
    case 'multi_choice':
      return { type: attribute.type, attributeId: attribute.id, valueIds: [] };
    case 'number':
      return { type: 'number', attributeId: attribute.id, number: '' };
    case 'boolean':
      return { type: 'boolean', attributeId: attribute.id, value: null };
    case 'text':
      return { type: 'text', attributeId: attribute.id, text: {} };
  }
}

/** The product's values as drafts. */
export function draftsFrom(
  values: readonly {
    attributeId: string;
    type: string;
    valueIds: string[];
    number: number | null;
    boolean: boolean | null;
    text: { bn?: string | undefined; en?: string | undefined };
  }[],
): Record<string, AttributeDraft> {
  const out: Record<string, AttributeDraft> = {};
  for (const v of values) {
    if (v.type === 'choice' || v.type === 'multi_choice')
      out[v.attributeId] = { type: v.type, attributeId: v.attributeId, valueIds: v.valueIds };
    else if (v.type === 'number')
      out[v.attributeId] = {
        type: 'number',
        attributeId: v.attributeId,
        number: v.number === null ? '' : String(v.number),
      };
    else if (v.type === 'boolean')
      out[v.attributeId] = { type: 'boolean', attributeId: v.attributeId, value: v.boolean };
    else
      out[v.attributeId] = {
        type: 'text',
        attributeId: v.attributeId,
        text: { ...(v.text.bn ? { bn: v.text.bn } : {}), ...(v.text.en ? { en: v.text.en } : {}) },
      };
  }
  return out;
}

/** Drafts as the API's input; an empty draft removes the attribute from the product. Null: an invalid number. */
export function toInput(drafts: Record<string, AttributeDraft>) {
  const out = [];
  for (const d of Object.values(drafts)) {
    if (d.type === 'number') {
      const text = d.number
        .replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c)))
        .replace(/,/g, '')
        .trim();
      const n = text === '' ? null : Number(text);
      if (n !== null && !Number.isFinite(n)) return null;
      out.push({ type: 'number' as const, attributeId: d.attributeId, number: n });
    } else if (d.type === 'text') {
      out.push({
        type: 'text' as const,
        attributeId: d.attributeId,
        text: { bn: d.text.bn?.trim() || null, en: d.text.en?.trim() || null },
      });
    } else out.push(d);
  }
  return out;
}

export function AttributeFields({
  categoryIds,
  value,
  onChange,
  defaultLang,
  disabled,
}: {
  categoryIds: string[];
  value: Record<string, AttributeDraft>;
  onChange: (next: Record<string, AttributeDraft>) => void;
  defaultLang: Lang;
  disabled?: boolean;
}) {
  const { t, locale } = useLocale();
  const attributes = useQuery(attributesQuery);
  const template = useQuery({
    queryKey: ['template-attributes', [...categoryIds].sort().join(',')],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/template-attributes', {
          params: { query: { categoryIds: categoryIds.join(',') } },
        }),
      ),
    enabled: categoryIds.length > 0,
  });
  const all = attributes.data ?? [];
  const templateIds = template.data ?? [];
  const shown = [
    ...templateIds
      .map((id) => all.find((a) => a.id === id))
      .filter((a): a is Attribute => Boolean(a)),
    ...all.filter((a) => !templateIds.includes(a.id) && value[a.id]),
  ];
  const addable = all.filter((a) => !shown.includes(a));
  const set = (attribute: Attribute, draft: AttributeDraft) =>
    onChange({ ...value, [attribute.id]: draft });

  return (
    <section aria-labelledby="specs-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="specs-heading" className="text-lg font-semibold">
          {t('specs.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('specs.intro')}</p>
      </div>
      {shown.map((attribute) => (
        <AttributeField
          key={attribute.id}
          attribute={attribute}
          draft={value[attribute.id] ?? emptyDraft(attribute)}
          onChange={(d) => set(attribute, d)}
          onRemove={
            templateIds.includes(attribute.id)
              ? undefined
              : () => set(attribute, emptyDraft(attribute))
          }
          defaultLang={defaultLang}
          disabled={disabled}
        />
      ))}
      {addable.length > 0 && (
        <select
          aria-label={t('specs.add')}
          disabled={disabled}
          className="min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:max-w-xs md:text-sm"
          value=""
          onChange={(e) => {
            const attribute = all.find((a) => a.id === e.target.value);
            if (attribute) set(attribute, emptyDraft(attribute));
          }}
        >
          <option value="">{t('specs.add')}</option>
          {addable.map((a) => (
            <option key={a.id} value={a.id}>
              {pick(a.name, locale)}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}

function AttributeField({
  attribute,
  draft,
  onChange,
  onRemove,
  defaultLang,
  disabled,
}: {
  attribute: Attribute;
  draft: AttributeDraft;
  onChange: (d: AttributeDraft) => void;
  onRemove: (() => void) | undefined;
  defaultLang: Lang;
  disabled?: boolean | undefined;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const name = pick(attribute.name, locale) ?? attribute.key;
  const unit = pick(attribute.unit, locale);
  const label = (
    <span className="text-sm font-medium">
      {name}
      {unit && <span className="font-normal text-muted-foreground"> ({unit})</span>}
    </span>
  );
  const remove = onRemove && (
    <Button
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label={t('specs.remove', { name })}
      onClick={onRemove}
    >
      <X aria-hidden className="size-4" />
    </Button>
  );
  let input: React.ReactNode = null;
  if (draft.type === 'choice') {
    input = (
      <select
        id={id}
        disabled={disabled}
        className="w-full min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm"
        value={draft.valueIds[0] ?? ''}
        onChange={(e) => onChange({ ...draft, valueIds: e.target.value ? [e.target.value] : [] })}
      >
        <option value="">—</option>
        {attribute.values.map((v) => (
          <option key={v.id} value={v.id}>
            {pick(v.label, locale)}
          </option>
        ))}
      </select>
    );
  } else if (draft.type === 'multi_choice') {
    return (
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="mb-1 flex w-full items-center justify-between">
          {label}
          {remove}
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {attribute.values.map((v) => (
            <label key={v.id} className="flex min-h-10 items-center gap-2 text-sm md:min-h-9">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={draft.valueIds.includes(v.id)}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    valueIds: e.target.checked
                      ? [...draft.valueIds, v.id]
                      : draft.valueIds.filter((x) => x !== v.id),
                  })
                }
              />
              {pick(v.label, locale)}
            </label>
          ))}
        </div>
      </fieldset>
    );
  } else if (draft.type === 'number') {
    input = (
      <Input
        id={id}
        inputMode="decimal"
        disabled={disabled}
        value={draft.number}
        onChange={(e) => onChange({ ...draft, number: e.target.value })}
      />
    );
  } else if (draft.type === 'boolean') {
    input = (
      <select
        id={id}
        disabled={disabled}
        className="w-full min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm"
        value={draft.value === null ? '' : draft.value ? 'yes' : 'no'}
        onChange={(e) =>
          onChange({ ...draft, value: e.target.value === '' ? null : e.target.value === 'yes' })
        }
      >
        <option value="">—</option>
        <option value="yes">{t('specs.yes')}</option>
        <option value="no">{t('specs.no')}</option>
      </select>
    );
  } else {
    const textDraft = draft as Extract<AttributeDraft, { type: 'text' }>;
    const other = otherLang(defaultLang);
    return (
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="mb-1 flex w-full items-center justify-between">
          {label}
          {remove}
        </legend>
        <div className="grid gap-2 md:grid-cols-2">
          {[defaultLang, other].map((lang) => (
            <Input
              key={lang}
              lang={lang}
              aria-label={`${name} (${LANGUAGE_NAMES[lang]})`}
              placeholder={LANGUAGE_NAMES[lang]}
              value={textDraft.text[lang] ?? ''}
              onChange={(e) =>
                onChange({ ...textDraft, text: { ...textDraft.text, [lang]: e.target.value } })
              }
            />
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id}>{label}</label>
        {remove}
      </div>
      {input}
    </div>
  );
}
