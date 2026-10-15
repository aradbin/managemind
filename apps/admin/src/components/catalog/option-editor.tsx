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
}: {
  product: Product;
  defaultLang: Lang;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [options, setOptions] = useState<DraftOption[]>(() => fromProduct(product));
  const [dirty, setDirty] = useState(false);
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
    <section aria-labelledby="options-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="options-heading" className="text-lg font-semibold">
          {t('options.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('options.intro')}</p>
      </div>
      {options.map((option, i) => (
        <OptionCard
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
            variant="secondary"
            disabled={disabled}
            onClick={() => update([...options, { key: key(), name: {}, values: [] }])}
          >
            <Plus aria-hidden className="size-4" />
            {t('options.add')}
          </Button>
        )}
        <span
          className={
            variants > CATALOG_LIMITS.variantsPerProduct
              ? 'text-sm text-danger'
              : 'text-sm text-muted-foreground'
          }
        >
          {t('options.variantCount', { count: variants })}
        </span>
      </div>
      {dirty && <Notice>{t('options.regenerateHint')}</Notice>}
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {dirty && (
        <div>
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
    </section>
  );
}

function OptionCard({
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
  return (
    <fieldset
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-medium">{t('options.option', { n: index + 1 })}</legend>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            {t('options.name')} ({LANGUAGE_NAMES[defaultLang]})
          </label>
          <Input
            id={`${id}-name`}
            list={`${id}-names`}
            lang={defaultLang}
            value={option.name[defaultLang] ?? ''}
            onChange={(e) => onChange({ name: { ...option.name, [defaultLang]: e.target.value } })}
          />
          <datalist id={`${id}-names`}>
            {(names.data?.names ?? []).map((n) => (
              <option key={n.name} value={n.name} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name-other`} className="text-sm font-medium">
            {t('options.name')} ({LANGUAGE_NAMES[other]}, {t('form.optional')})
          </label>
          <Input
            id={`${id}-name-other`}
            lang={other}
            value={option.name[other] ?? ''}
            onChange={(e) => onChange({ name: { ...option.name, [other]: e.target.value } })}
          />
        </div>
      </div>
      <ul className="flex flex-col gap-2" aria-label={t('options.values')}>
        {option.values.map((value) => (
          <li key={value.key} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <Input
              aria-label={`${t('options.value')} (${LANGUAGE_NAMES[defaultLang]})`}
              lang={defaultLang}
              value={value.label[defaultLang] ?? ''}
              onChange={(e) => setValue(value.key, defaultLang, e.target.value)}
            />
            <Input
              aria-label={`${t('options.value')} (${LANGUAGE_NAMES[other]})`}
              lang={other}
              placeholder={LANGUAGE_NAMES[other]}
              value={value.label[other] ?? ''}
              onChange={(e) => setValue(value.key, other, e.target.value)}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('options.removeValue', { value: value.label[defaultLang] ?? '' })}
              onClick={() => onChange({ values: option.values.filter((v) => v.key !== value.key) })}
            >
              <X aria-hidden className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          aria-label={t('options.newValue')}
          placeholder={t('options.newValue')}
          list={`${id}-values`}
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
        <datalist id={`${id}-values`}>
          {(names.data?.values ?? []).map((v) => (
            <option key={v.label} value={v.label} />
          ))}
        </datalist>
        <Button variant="secondary" onClick={addValue}>
          {t('options.addValue')}
        </Button>
      </div>
      <div>
        <Button variant="ghost" onClick={onRemove}>
          <Trash2 aria-hidden className="size-4" />
          {t('options.remove')}
        </Button>
      </div>
    </fieldset>
  );
}
