// Settings → Returns (phase-5a-plan §3.10, Q9, Q10): whether shoppers can ask
// from the tracking page and for how long after delivery, categories that
// can't come back, who pays the return delivery for each reason, the refund
// methods offered, and whether the delivery fee comes back.
import {
  defaultReturnSettings,
  OFFERED_REFUND_METHODS,
  RETURN_REASONS,
  type ReturnSettings,
} from '@managemind/shared/orders';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { categoriesQuery, categoryOptions, storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';

const toggle = <T,>(list: readonly T[], value: T, order: readonly T[]) =>
  list.includes(value)
    ? list.filter((v) => v !== value)
    : order.filter((v) => v === value || list.includes(v));

export function ReturnSettingsPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const store = useQuery(storeSettingsQuery);
  const categories = useQuery(categoriesQuery);
  const [policy, setPolicy] = useState<ReturnSettings | null>(null);
  const [days, setDays] = useState('7');
  useEffect(() => {
    if (!store.data || policy) return;
    const p = { ...defaultReturnSettings(), ...(store.data.returns as Partial<ReturnSettings>) };
    setPolicy(p);
    setDays(String(p.windowDays));
  }, [store.data, policy]);
  const windowDays = Number(days);
  const badDays = !Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90;
  const save = useMutation({
    mutationFn: async (returns: ReturnSettings) =>
      unwrap(await api.PATCH('/v1/admin/store', { body: { returns } })),
    onSuccess: (saved) => {
      queryClient.setQueryData(storeSettingsQuery.queryKey, saved);
      toast(t('account.saved'));
    },
  });
  if (store.isPending || !policy) return <p role="status">{t('loading')}</p>;
  if (store.isError) return <Notice tone="error">{errorMessage(store.error, t)}</Notice>;
  const options = categoryOptions(categories.data ?? [], locale);
  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!badDays && policy.refundMethods.length) save.mutate({ ...policy, windowDays });
      }}
    >
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('returnSettings.title')}
        description={t('returnSettings.intro')}
      />
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <fieldset
        disabled={!canEdit || save.isPending}
        className="flex flex-col gap-6 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <div className="flex flex-col gap-3">
          <label className="flex min-h-10 items-center gap-3 md:min-h-9">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={policy.shopperRequests}
              onChange={(e) => setPolicy({ ...policy, shopperRequests: e.target.checked })}
            />
            {t('returnSettings.shopperRequests')}
          </label>
          <Field
            label={t('returnSettings.window')}
            hint={t('returnSettings.windowHint')}
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            error={badDays ? t('form.invalid') : undefined}
          />
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">{t('returnSettings.shopperPays')}</legend>
          <p className="mb-1 text-sm text-muted-foreground">
            {t('returnSettings.shopperPaysHint')}
          </p>
          {RETURN_REASONS.map((r) => (
            <label key={r} className="flex min-h-10 items-center gap-3 md:min-h-9">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={policy.shopperPaysFor.includes(r)}
                onChange={() =>
                  setPolicy({
                    ...policy,
                    shopperPaysFor: toggle(policy.shopperPaysFor, r, RETURN_REASONS),
                  })
                }
              />
              {t(`return.reason.${r}` as AdminKey)}
            </label>
          ))}
        </fieldset>
        <label className="flex min-h-10 items-start gap-3 md:min-h-9">
          <input
            type="checkbox"
            className="mt-3 size-5"
            checked={policy.refundDeliveryFee}
            onChange={(e) => setPolicy({ ...policy, refundDeliveryFee: e.target.checked })}
          />
          <span className="flex min-h-11 flex-col justify-center">
            {t('returnSettings.deliveryFee')}
            <span className="text-sm text-muted-foreground">
              {t('returnSettings.deliveryFeeHint')}
            </span>
          </span>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">{t('returnSettings.methods')}</legend>
          {OFFERED_REFUND_METHODS.map((m) => (
            <label key={m} className="flex min-h-10 items-center gap-3 md:min-h-9">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={policy.refundMethods.includes(m)}
                onChange={() =>
                  setPolicy({
                    ...policy,
                    refundMethods: toggle(policy.refundMethods, m, OFFERED_REFUND_METHODS),
                  })
                }
              />
              {t(`refund.method.${m}` as AdminKey)}
            </label>
          ))}
          {!policy.refundMethods.length && (
            <Notice tone="error">{t('returnSettings.oneMethod')}</Notice>
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">{t('returnSettings.excluded')}</legend>
          <p className="mb-1 text-sm text-muted-foreground">{t('returnSettings.excludedHint')}</p>
          {options.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
          {options.map((c) => (
            <label key={c.id} className="flex min-h-10 items-center gap-3 md:min-h-9">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={policy.excludedCategoryIds.includes(c.id)}
                onChange={() =>
                  setPolicy({
                    ...policy,
                    excludedCategoryIds: policy.excludedCategoryIds.includes(c.id)
                      ? policy.excludedCategoryIds.filter((x) => x !== c.id)
                      : [...policy.excludedCategoryIds, c.id],
                  })
                }
              />
              {c.label}
            </label>
          ))}
        </fieldset>
      </fieldset>
      {save.error && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {canEdit && (
        <div>
          <Button type="submit" disabled={save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      )}
    </form>
  );
}
