// Store settings for Phase 2 (phase-2-plan §3.9, §7): VAT, and the default
// stock location's name and address.

import { money, splitVat } from '@managemind/shared/money';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import { formatPrice, storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';

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
  useEffect(() => {
    if (!store.data || loaded) return;
    const tax = store.data.tax;
    setEnabled(tax.vatEnabled);
    setRate(toPercent(tax.rateBasisPoints));
    setInclusive(tax.pricesIncludeVat);
    setCategories(
      tax.categories.map((c) => ({
        key: c.key,
        name: c.name,
        rate: toPercent(c.rateBasisPoints),
        exempt: c.exempt,
      })),
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
      toast(t('account.saved'));
    },
  });

  if (store.isPending) return <p role="status">{t('loading')}</p>;
  if (store.isError) return <Notice tone="error">{errorMessage(store.error, t)}</Notice>;
  const standard = fromPercent(rate);
  const example = standard === null ? null : splitVat(money(100_000), standard, inclusive);
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('vat.title')}
        description={t('vat.intro')}
      />
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <fieldset disabled={!canEdit || save.isPending} className="flex flex-col gap-4">
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="font-medium">{t('vat.enabled')}</span>
        </label>
        {enabled && (
          <>
            <Field
              label={t('vat.rate')}
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              hint={t('vat.rateHint')}
            />
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">{t('vat.prices')}</legend>
              {[true, false].map((inc) => (
                <label key={String(inc)} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name="inclusive"
                    className="size-5"
                    checked={inclusive === inc}
                    onChange={() => setInclusive(inc)}
                  />
                  {t(inc ? 'vat.inclusive' : 'vat.exclusive')}
                </label>
              ))}
            </fieldset>
            {example && (
              <p className="text-sm text-muted-foreground">
                {t('vat.example', {
                  price: formatPrice(100_000, locale),
                  net: formatPrice(example.net.amount, locale),
                  vat: formatPrice(example.vat.amount, locale),
                  gross: formatPrice(example.gross.amount, locale),
                })}
              </p>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">{t('vat.categories')}</legend>
              <p className="text-sm text-muted-foreground">{t('vat.categoriesIntro')}</p>
              {categories.map((c, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_6rem_auto] items-center gap-2 max-md:grid-cols-2"
                >
                  <Input
                    aria-label={`${t('vat.categoryKey')} ${i + 1}`}
                    placeholder={t('vat.categoryKey')}
                    value={c.key}
                    onChange={(e) =>
                      setCategories(
                        categories.map((x, j) =>
                          j === i ? { ...x, key: e.target.value.toLowerCase() } : x,
                        ),
                      )
                    }
                  />
                  <Input
                    aria-label={`${t('vat.categoryName')} ${i + 1}`}
                    placeholder={t('vat.categoryName')}
                    value={c.name}
                    onChange={(e) =>
                      setCategories(
                        categories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      )
                    }
                  />
                  <Input
                    aria-label={`${t('vat.rate')} ${i + 1}`}
                    inputMode="decimal"
                    value={c.rate}
                    onChange={(e) =>
                      setCategories(
                        categories.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)),
                      )
                    }
                  />
                  <span className="flex items-center gap-2">
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={c.exempt}
                        onChange={(e) =>
                          setCategories(
                            categories.map((x, j) =>
                              j === i ? { ...x, exempt: e.target.checked } : x,
                            ),
                          )
                        }
                      />
                      {t('vat.exempt')}
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('vat.removeCategory', { n: i + 1 })}
                      onClick={() => setCategories(categories.filter((_, j) => j !== i))}
                    >
                      <X aria-hidden className="size-4" />
                    </Button>
                  </span>
                </div>
              ))}
              <div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setCategories([...categories, { key: '', name: '', rate: '5', exempt: false }])
                  }
                >
                  <Plus aria-hidden className="size-4" />
                  {t('vat.addCategory')}
                </Button>
              </div>
            </fieldset>
          </>
        )}
      </fieldset>
      {save.isError && (
        <Notice tone="error">
          {save.error.message === 'invalid' ? t('form.invalid') : saveErrorMessage(save.error, t)}
        </Notice>
      )}
      {canEdit && (
        <div>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t('action.save')}
          </Button>
        </div>
      )}
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
  useEffect(() => {
    if (!location) return;
    setName(location.name);
    setLine1(location.address?.line1 ?? '');
    setLine2(location.address?.line2 ?? '');
    setCity(location.address?.city ?? '');
  }, [location]);
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
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('location.title')}
        description={t('location.intro')}
      />
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <fieldset disabled={!canEdit || save.isPending} className="flex flex-col gap-4">
        <Field
          label={t('location.name')}
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label={`${t('store.addressLine1')} (${t('form.optional')})`}
          autoComplete="address-line1"
          value={line1}
          onChange={(e) => setLine1(e.target.value)}
        />
        <Field
          label={`${t('store.addressLine2')} (${t('form.optional')})`}
          autoComplete="address-line2"
          value={line2}
          onChange={(e) => setLine2(e.target.value)}
        />
        <Field
          label={`${t('store.city')} (${t('form.optional')})`}
          autoComplete="address-level2"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
      </fieldset>
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {canEdit && (
        <div>
          <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>
            {t('action.save')}
          </Button>
        </div>
      )}
    </div>
  );
}
