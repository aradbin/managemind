// Options and their values (phase-2-plan §3.1): up to 3 options, 100 variants.
// Saving replaces the options and regenerates the variants on the server:
// existing values keep their IDs, so their variants (SKU, price, stock) stay.
// The store's existing option names and values are suggested, which keeps
// labels consistent for filters across products (§3.4).
import { CATALOG_LIMITS, combinationCount } from '@managemind/shared/catalog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { type Product, productKeys } from '../../lib/catalog';
import { saveErrorMessage } from '../../lib/errors';
import { Notice } from '../notice';
import { useToast } from '../toast';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { LANGUAGE_NAMES, type Lang, otherLang } from './language-tabs';

type Labels = { bn?: string; en?: string };
interface DraftValue {
  key: string;
  id?: string | undefined;
  label: Labels;
}
interface DraftOption {
  key: string;
  id?: string | undefined;
  name: Labels;
  values: DraftValue[];
}

let seq = 0;
const key = () => `k${++seq}`;

const fromProduct = (product: Product): DraftOption[] =>
  product.options.map((o) => ({
    key: key(),
    id: o.id,
    name: { ...o.name } as Labels,
    values: o.values.map((v) => ({ key: key(), id: v.id, label: { ...v.label } as Labels })),
  }));

/** Drops empty translations: an empty other-language label isn't sent. */
const clean = (labels: Labels) =>
  Object.fromEntries(Object.entries(labels).filter(([, v]) => v?.trim())) as Labels;

export function OptionEditor({
  product,
  defaultLang,
  disabled,
  startWithOne,
}: {
  product: Product;
  defaultLang: Lang;
  disabled?: boolean;
  /** Opened from "Add sizes, colours or other options": one empty option to fill. */
  startWithOne?: boolean;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [options, setOptions] = useState<DraftOption[]>(() =>
    startWithOne && !product.options.length
      ? [{ key: key(), name: {}, values: [] }]
      : fromProduct(product),
  );
  const [dirty, setDirty] = useState(Boolean(startWithOne && !product.options.length));
  const other = otherLang(defaultLang);
  const variants = combinationCount(options.map((o) => o.values));

  const update = (next: DraftOption[]) => {
    setOptions(next);
    setDirty(true);
  };
  const setOption = (k: string, patch: Partial<DraftOption>) =>
    update(options.map((o) => (o.key === k ? { ...o, ...patch } : o)));

  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT('/v1/admin/products/{id}/options', {
          params: { path: { id: product.id } },
          body: options.map((o) => ({
            ...(o.id ? { id: o.id } : {}),
            name: clean(o.name),
            values: o.values.map((v) => ({ ...(v.id ? { id: v.id } : {}), label: clean(v.label) })),
          })),
        }),
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['product', product.id], saved);
      for (const k of productKeys()) await queryClient.invalidateQueries({ queryKey: k });
      setOptions(fromProduct(saved));
      setDirty(false);
      toast(t('options.saved', { count: saved.variants.length }));
    },
  });

  const missing = options.some(
    (o) =>
      !o.name[defaultLang]?.trim() ||
      !o.values.length ||
      o.values.some((v) => !v.label[defaultLang]?.trim()),
  );

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {options.map((option, i) => (
        <OptionRow
          key={option.key}
          index={i}
          option={option}
          defaultLang={defaultLang}
          other={other}
          disabled={disabled || save.isPending}
          onChange={(patch) => setOption(option.key, patch)}
          onRemove={() => update(options.filter((o) => o.key !== option.key))}
        />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {options.length < CATALOG_LIMITS.optionsPerProduct && (
          <Button
            variant="ghost"
            className="-ml-2.5 px-2.5 text-muted-foreground"
            disabled={disabled}
            onClick={() => update([...options, { key: key(), name: {}, values: [] }])}
          >
            <Plus aria-hidden className="size-4" />
            {t(options.length ? 'options.addAnother' : 'options.add')}
          </Button>
        )}
        {dirty && (
          <span
            className={
              variants > CATALOG_LIMITS.variantsPerProduct
                ? 'text-[13px] text-danger'
                : 'text-[13px] text-muted-foreground'
            }
          >
            {t('options.variantCount', { count: variants })}
          </span>
        )}
      </div>
      {dirty && <Notice>{t('options.regenerateHint')}</Notice>}
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {dirty && (
        <div className="flex justify-end">
          <Button
            disabled={
              disabled || save.isPending || missing || variants > CATALOG_LIMITS.variantsPerProduct
            }
            onClick={() => save.mutate()}
          >
            {t('options.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

function OptionRow({
  index,
  option,
  defaultLang,
  other,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  option: DraftOption;
  defaultLang: Lang;
  other: Lang;
  disabled: boolean;
  onChange: (patch: Partial<DraftOption>) => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [newValue, setNewValue] = useState('');
  const names = useQuery({
    queryKey: ['option-suggestions', defaultLang, option.name[defaultLang] ?? ''],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/option-suggestions', {
          params: {
            query: {
              locale: defaultLang,
              prefix: option.name[defaultLang] ?? '',
              ...(option.name[defaultLang] ? { name: option.name[defaultLang] } : {}),
              limit: 10,
            },
          },
        }),
      ),
    staleTime: 60_000,
  });
  const addValue = () => {
    const label = newValue.trim();
    setNewValue('');
    if (
      !label ||
      option.values.some((v) => v.label[defaultLang]?.toLowerCase() === label.toLowerCase())
    )
      return;
    onChange({ values: [...option.values, { key: key(), label: { [defaultLang]: label } }] });
  };
  const setValue = (k: string, lang: Lang, text: string) =>
    onChange({
      values: option.values.map((v) =>
        v.key === k ? { ...v, label: { ...v.label, [lang]: text } } : v,
      ),
    });
  const [translating, setTranslating] = useState(false);
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={disabled}>
      <legend className="sr-only">{t('options.option', { n: index + 1 })}</legend>
      {/* As drawn: the option's name, then its values as chips in one box. */}
      <div className="flex items-center gap-3">
        <Input
          id={`${id}-name`}
          list={`${id}-names`}
          lang={defaultLang}
          aria-label={`${t('options.name')} (${LANGUAGE_NAMES[defaultLang]})`}
          placeholder={t('options.name')}
          className="w-[120px] shrink-0 font-medium md:w-[120px]"
          value={option.name[defaultLang] ?? ''}
          onChange={(e) => onChange({ name: { ...option.name, [defaultLang]: e.target.value } })}
        />
        <datalist id={`${id}-names`}>
          {(names.data?.names ?? []).map((n) => (
            <option key={n.name} value={n.name} />
          ))}
        </datalist>
        <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-lg border border-input p-[5px_6px] shadow-xs focus-within:ring-[3px] focus-within:ring-ring/50 md:min-h-9 md:p-[4px_6px]">
          <ul className="contents" aria-label={t('options.values')}>
            {option.values.map((value) => (
              <li
                key={value.key}
                lang={defaultLang}
                className="inline-flex h-7 items-center gap-0.5 rounded-md bg-secondary pr-0.5 pl-2.5 text-[13px] font-medium text-secondary-foreground md:h-6 md:pl-2 md:text-xs"
              >
                {value.label[defaultLang]}
                <button
                  type="button"
                  aria-label={t('options.removeValue', { value: value.label[defaultLang] ?? '' })}
                  onClick={() =>
                    onChange({ values: option.values.filter((v) => v.key !== value.key) })
                  }
                  className="inline-flex size-6 items-center justify-center rounded hover:bg-foreground/10 md:size-5"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <input
            aria-label={t('options.newValue')}
            placeholder={t('options.addShort')}
            list={`${id}-values`}
            lang={defaultLang}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addValue();
              }
            }}
            onBlur={() => newValue.trim() && addValue()}
            className="h-7 min-w-20 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground focus-visible:shadow-none md:h-6 md:text-sm"
          />
          <datalist id={`${id}-values`}>
            {(names.data?.values ?? []).map((v) => (
              <option key={v.label} value={v.label} />
            ))}
          </datalist>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 md:size-8"
          aria-label={t('options.removeOne', { n: index + 1 })}
          onClick={onRemove}
        >
          <Trash2 aria-hidden className="size-4" />
        </Button>
      </div>
      <button
        type="button"
        aria-expanded={translating}
        onClick={() => setTranslating(!translating)}
        className="ml-[132px] self-start text-[13px] text-muted-foreground hover:text-foreground max-md:ml-0"
      >
        {t('options.otherNames', { language: LANGUAGE_NAMES[other] })}
      </button>
      {translating && (
        <div className="grid gap-2 md:ml-[132px] md:grid-cols-2">
          <Input
            id={`${id}-name-other`}
            lang={other}
            aria-label={`${t('options.name')} (${LANGUAGE_NAMES[other]}, ${t('form.optional')})`}
            placeholder={`${t('options.name')} · ${LANGUAGE_NAMES[other]}`}
            value={option.name[other] ?? ''}
            onChange={(e) => onChange({ name: { ...option.name, [other]: e.target.value } })}
          />
          {option.values.map((value) => (
            <Input
              key={value.key}
              lang={other}
              aria-label={`${t('options.value')} (${LANGUAGE_NAMES[other]}): ${value.label[defaultLang] ?? ''}`}
              placeholder={`${value.label[defaultLang] ?? ''} · ${LANGUAGE_NAMES[other]}`}
              value={value.label[other] ?? ''}
              onChange={(e) => setValue(value.key, other, e.target.value)}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}
