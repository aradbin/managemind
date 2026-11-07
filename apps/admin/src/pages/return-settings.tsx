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
import { fieldHint, fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { cardPadded, cardTitle } from '../components/ui/card';
import { ToggleChips } from '../components/ui/segmented';
import { SwitchRow } from '../components/ui/switch';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/returns';
import { api, unwrap } from '../lib/api';
import { categoriesQuery, categoryOptions, storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { cn } from '../lib/utils';

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
  // What was loaded or last saved: the save bar shows once something differs.
  const [snapshot, setSnapshot] = useState('');
  const current = JSON.stringify({ policy, days });
  const dirty = policy !== null && current !== snapshot;
  useEffect(() => {
    if (!store.data || policy) return;
    const p = { ...defaultReturnSettings(), ...(store.data.returns as Partial<ReturnSettings>) };
    setPolicy(p);
    setDays(String(p.windowDays));
    setSnapshot(JSON.stringify({ policy: p, days: String(p.windowDays) }));
  }, [store.data, policy]);
  const windowDays = Number(days);
  const badDays = !Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90;
  const save = useMutation({
    mutationFn: async (returns: ReturnSettings) =>
      unwrap(await api.PATCH('/v1/admin/store', { body: { returns } })),
    onSuccess: (saved) => {
      queryClient.setQueryData(storeSettingsQuery.queryKey, saved);
      setSnapshot(current);
      toast(t('account.saved'));
    },
  });
  if (store.isPending || !policy) return <p role="status">{t('loading')}</p>;
  if (store.isError) return <Notice tone="error">{errorMessage(store.error, t)}</Notice>;
  const options = categoryOptions(categories.data ?? [], locale);
  return (
    <form
      className="flex flex-col gap-3 md:gap-4"
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
        aria-labelledby="returns-card"
        className={cn(cardPadded, 'm-0 gap-4 md:gap-4')}
      >
        <h2 id="returns-card" className={cardTitle}>
          {t('returnSettings.title')}
        </h2>
        <SwitchRow
          label={t('returnSettings.shopperRequests')}
          checked={policy.shopperRequests}
          onCheckedChange={(on) => setPolicy({ ...policy, shopperRequests: on })}
        />
        {policy.shopperRequests && (
          <Field
            label={t('returnSettings.window')}
            hint={t('returnSettings.windowHint')}
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            error={badDays ? t('form.invalid') : undefined}
          />
        )}
        <div role="presentation" className="-mx-4 h-px bg-border md:-mx-5" />
        <fieldset className="m-0 flex flex-col border-0 p-0">
          <legend className={fieldLabel}>{t('returnSettings.shopperPays')}</legend>
          <ToggleChips
            options={RETURN_REASONS.map((r) => ({
              value: r,
              label: t(`return.reason.${r}` as AdminKey),
            }))}
            value={policy.shopperPaysFor}
            onToggle={(r) =>
              setPolicy({
                ...policy,
                shopperPaysFor: toggle(policy.shopperPaysFor, r, RETURN_REASONS),
              })
            }
          />
          <p className={fieldHint}>{t('returnSettings.shopperPaysHint')}</p>
        </fieldset>
        <SwitchRow
          label={t('returnSettings.deliveryFee')}
          hint={t('returnSettings.deliveryFeeHint')}
          checked={policy.refundDeliveryFee}
          onCheckedChange={(on) => setPolicy({ ...policy, refundDeliveryFee: on })}
        />
        <div role="presentation" className="-mx-4 h-px bg-border md:-mx-5" />
        <fieldset className="m-0 flex flex-col border-0 p-0">
          <legend className={fieldLabel}>{t('returnSettings.methods')}</legend>
          <div className="flex flex-col">
            {OFFERED_REFUND_METHODS.map((m) => (
              <label key={m} className="flex min-h-10 items-center gap-2.5 md:min-h-9">
                <input
                  type="checkbox"
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
          </div>
          {!policy.refundMethods.length && (
            <p role="alert" className={cn(fieldHint, 'text-danger')}>
              {t('returnSettings.oneMethod')}
            </p>
          )}
        </fieldset>
        <div role="presentation" className="-mx-4 h-px bg-border md:-mx-5" />
        <fieldset className="m-0 flex flex-col border-0 p-0">
          <legend className={fieldLabel}>{t('returnSettings.excluded')}</legend>
          {options.length === 0 ? (
            <p className="text-muted-foreground">—</p>
          ) : (
            <ToggleChips
              options={options.map((c) => ({ value: c.id, label: c.label }))}
              value={policy.excludedCategoryIds}
              onToggle={(id) =>
                setPolicy({
                  ...policy,
                  excludedCategoryIds: policy.excludedCategoryIds.includes(id)
                    ? policy.excludedCategoryIds.filter((x) => x !== id)
                    : [...policy.excludedCategoryIds, id],
                })
              }
            />
          )}
          <p className={fieldHint}>{t('returnSettings.excludedHint')}</p>
        </fieldset>
      </fieldset>
      {save.error && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      <SaveBar
        show={canEdit && dirty}
        message={t('form.unsaved')}
        discardLabel={t('action.discard')}
        onDiscard={() => {
          save.reset();
          setPolicy(null);
        }}
        saveLabel={t('action.save')}
        busy={save.isPending}
        saveDisabled={badDays || !policy.refundMethods.length}
        onSave={() => save.mutate({ ...policy, windowDays })}
      />
    </form>
  );
}
