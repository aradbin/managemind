// Store settings for Phase 2 (phase-2-plan §3.9, §7): VAT, and the default
// stock location's name and address.

import { money, splitVat } from '@managemind/shared/money';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Field } from '../components/field';
import { fieldHint, fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { RadioCard } from '../components/ui/choice';
import { Input } from '../components/ui/input';
import { SwitchRow } from '../components/ui/switch';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import { formatPrice, storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { cn } from '../lib/utils';

const toPercent = (bp: number) => String(bp / 100);
const fromPercent = (text: string): number | null => {
  const n = Number(text.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
};

interface CategoryDraft {
  key: string;
  name: string;
  rate: string;
  exempt: boolean;
}

export function VatSettingsPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const store = useQuery(storeSettingsQuery);
  const [enabled, setEnabled] = useState(false);
  const [rate, setRate] = useState('15');
  const [inclusive, setInclusive] = useState(true);
  const [categories, setCategories] = useState<CategoryDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  // What was loaded or last saved: the save bar shows once something differs.
  const [snapshot, setSnapshot] = useState('');
  const current = JSON.stringify({ enabled, rate, inclusive, categories });
  const dirty = loaded && current !== snapshot;
  useEffect(() => {
    if (!store.data || loaded) return;
    const tax = store.data.tax;
    const cats = tax.categories.map((c) => ({
      key: c.key,
      name: c.name,
      rate: toPercent(c.rateBasisPoints),
      exempt: c.exempt,
    }));
    setEnabled(tax.vatEnabled);
    setRate(toPercent(tax.rateBasisPoints));
    setInclusive(tax.pricesIncludeVat);
    setCategories(cats);
    setSnapshot(
      JSON.stringify({
        enabled: tax.vatEnabled,
        rate: toPercent(tax.rateBasisPoints),
        inclusive: tax.pricesIncludeVat,
        categories: cats,
      }),
    );
    setLoaded(true);
  }, [store.data, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      const standard = fromPercent(rate);
      const parsed = categories.map((c) => ({ ...c, bp: fromPercent(c.rate) }));
      if (
        standard === null ||
        parsed.some((c) => c.bp === null || !/^[a-z][a-z0-9_]{0,31}$/.test(c.key) || !c.name.trim())
      ) {
        throw new Error('invalid');
      }
      return unwrap(
        await api.PATCH('/v1/admin/store', {
          body: {
            tax: {
              vatEnabled: enabled,
              rateBasisPoints: standard,
              pricesIncludeVat: inclusive,
              categories: parsed.map((c) => ({
                key: c.key,
                name: c.name.trim(),
                rateBasisPoints: c.bp as number,
                exempt: c.exempt,
              })),
            },
          },
        }),
      );
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(storeSettingsQuery.queryKey, saved);
      setSnapshot(current);
      toast(t('account.saved'));
    },
  });

  if (store.isPending) return <p role="status">{t('loading')}</p>;
  if (store.isError) return <Notice tone="error">{errorMessage(store.error, t)}</Notice>;
  const setCategory = (i: number, patch: Partial<CategoryDraft>) =>
    setCategories(categories.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const standard = fromPercent(rate);
  const example = standard === null ? null : splitVat(money(100_000), standard, inclusive);
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('vat.title')}
        description={`${t('vat.description')}.`}
      />
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <fieldset
        disabled={!canEdit || save.isPending}
        aria-labelledby="vat-card"
        className={cn(cardPadded, 'm-0 gap-4 md:gap-4')}
      >
        <div className="flex flex-col gap-1">
          <h2 id="vat-card" className={cardTitle}>
            {t('vat.title')}
          </h2>
          <p className="text-[13px] text-muted-foreground">{t('vat.intro')}</p>
        </div>
        <SwitchRow label={t('vat.enabled')} checked={enabled} onCheckedChange={setEnabled} />
        {enabled && (
          <>
            <div className="flex flex-col">
              <label htmlFor="vat-rate" className={fieldLabel}>
                {t('vat.rate')}
              </label>
              <span className="relative block">
                <Input
                  id="vat-rate"
                  inputMode="decimal"
                  aria-describedby="vat-rate-hint"
                  className="pr-7"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                >
                  %
                </span>
              </span>
              <p id="vat-rate-hint" className={fieldHint}>
                {t('vat.rateHint')}
              </p>
            </div>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className={fieldLabel}>{t('vat.prices')}</legend>
              {[true, false].map((inc) => (
                <RadioCard
                  key={String(inc)}
                  name="inclusive"
                  checked={inclusive === inc}
                  onChange={() => setInclusive(inc)}
                  label={t(inc ? 'vat.inclusive' : 'vat.exclusive')}
                  hint={t(inc ? 'vat.inclusiveHint' : 'vat.exclusiveHint')}
                />
              ))}
            </fieldset>
            {example && (
              <p className="flex items-start gap-2.5 rounded-[10px] bg-muted px-3.5 py-3 text-[13px]">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  {t('vat.example', {
                    price: formatPrice(100_000, locale),
                    net: formatPrice(example.net.amount, locale),
                    vat: formatPrice(example.vat.amount, locale),
                    gross: formatPrice(example.gross.amount, locale),
                  })}
                </span>
              </p>
            )}
          </>
        )}
      </fieldset>
      {enabled && (
        <fieldset
          disabled={!canEdit || save.isPending}
          aria-labelledby="vat-rates"
          className={cn(cardPadded, 'm-0 gap-3 md:gap-3')}
        >
          <div className="flex flex-col gap-1">
            <h2 id="vat-rates" className={cardTitle}>
              {t('vat.categories')}
            </h2>
            <p className="text-[13px] text-muted-foreground">{t('vat.categoriesIntro')}</p>
          </div>
          {categories.length > 0 && (
            <ul className="flex flex-col gap-2">
              {categories.map((c, i) => (
                <li
                  key={i}
                  className="grid grid-cols-2 items-center gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_96px_auto_36px]"
                >
                  <Input
                    aria-label={`${t('vat.categoryKey')} ${i + 1}`}
                    placeholder={t('vat.categoryKey')}
                    value={c.key}
                    onChange={(e) => setCategory(i, { key: e.target.value.toLowerCase() })}
                  />
                  <Input
                    aria-label={`${t('vat.categoryName')} ${i + 1}`}
                    placeholder={t('vat.categoryName')}
                    value={c.name}
                    onChange={(e) => setCategory(i, { name: e.target.value })}
                  />
                  <span className="relative block">
                    <Input
                      aria-label={`${t('vat.rate')} ${i + 1}`}
                      inputMode="decimal"
                      className="pr-7"
                      value={c.rate}
                      onChange={(e) => setCategory(i, { rate: e.target.value })}
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                    >
                      %
                    </span>
                  </span>
                  <label className="flex min-h-10 items-center gap-2 md:min-h-9">
                    <input
                      type="checkbox"
                      checked={c.exempt}
                      onChange={(e) => setCategory(i, { exempt: e.target.checked })}
                    />
                    {t('vat.exempt')}
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="justify-self-end"
                    aria-label={t('vat.removeCategory', { n: i + 1 })}
                    onClick={() => setCategories(categories.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() =>
              setCategories([...categories, { key: '', name: '', rate: '5', exempt: false }])
            }
            className="flex h-11 w-full items-center gap-2 rounded-[10px] border border-dashed border-input px-3 text-left text-muted-foreground hover:bg-accent hover:text-foreground md:h-10"
          >
            <Plus aria-hidden className="size-4" />
            {t('vat.addCategory')}
          </button>
        </fieldset>
      )}
      {save.isError && (
        <Notice tone="error">
          {save.error.message === 'invalid' ? t('form.invalid') : saveErrorMessage(save.error, t)}
        </Notice>
      )}
      <SaveBar
        show={canEdit && dirty}
        message={t('form.unsaved')}
        discardLabel={t('action.discard')}
        onDiscard={() => {
          save.reset();
          setLoaded(false);
        }}
        saveLabel={t('action.save')}
        busy={save.isPending}
        onSave={() => save.mutate()}
      />
    </div>
  );
}

export function LocationSettingsPage() {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: async () => unwrap(await api.GET('/v1/admin/locations')),
  });
  const location = locations.data?.find((l) => l.isDefault);
  const [name, setName] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const reset = () => {
    if (!location) return;
    setName(location.name);
    setLine1(location.address?.line1 ?? '');
    setLine2(location.address?.line2 ?? '');
    setCity(location.address?.city ?? '');
  };
  useEffect(reset, [location]);
  const dirty =
    !!location &&
    (name !== location.name ||
      line1 !== (location.address?.line1 ?? '') ||
      line2 !== (location.address?.line2 ?? '') ||
      city !== (location.address?.city ?? ''));
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH('/v1/admin/locations/{id}', {
          params: { path: { id: location?.id as string } },
          body: {
            name,
            address: line1.trim()
              ? { line1, ...(line2.trim() ? { line2 } : {}), ...(city.trim() ? { city } : {}) }
              : null,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['locations'] });
      toast(t('account.saved'));
    },
  });
  if (locations.isPending) return <p role="status">{t('loading')}</p>;
  if (locations.isError || !location)
    return <Notice tone="error">{errorMessage(locations.error, t)}</Notice>;
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('location.title')}
        description={`${t('location.description')}.`}
      />
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <fieldset
        disabled={!canEdit || save.isPending}
        aria-labelledby="location-card"
        className={cn(cardPadded, 'm-0 gap-4 md:gap-4')}
      >
        <div className="flex flex-col gap-1">
          <h2 id="location-card" className={cardTitle}>
            {t('location.title')}
          </h2>
          <p className="text-[13px] text-muted-foreground">{t('location.intro')}</p>
        </div>
        <Field
          label={t('location.name')}
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label={t('store.addressLine1')}
          optional
          autoComplete="address-line1"
          value={line1}
          onChange={(e) => setLine1(e.target.value)}
        />
        <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
          <Field
            label={t('store.addressLine2')}
            optional
            autoComplete="address-line2"
            value={line2}
            onChange={(e) => setLine2(e.target.value)}
          />
          <Field
            label={t('store.city')}
            autoComplete="address-level2"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
      </fieldset>
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      <SaveBar
        show={canEdit && dirty}
        message={t('form.unsaved')}
        discardLabel={t('action.discard')}
        onDiscard={reset}
        saveLabel={t('action.save')}
        busy={save.isPending}
        saveDisabled={!name.trim()}
        onSave={() => save.mutate()}
      />
    </div>
  );
}
