// Settings → Checkout (phase-4-plan §3.5, §3.8, §3.15, §7): the email field,
// the quantity limit, the order number prefix, cash on delivery, rate limits,
// the phone blocklist and shopper accounts.

import {
  type CheckoutSettings,
  COD_ADVANCE_RULES,
  COD_OTP_RULES,
  type CodSettings,
  defaultCheckoutSettings,
  defaultCodSettings,
  EMAIL_FIELD_MODES,
  ORDER_PREFIX,
} from '@managemind/shared/orders';
import { normalizePhone } from '@managemind/shared/phone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/orders';
import { ApiError, api, unwrap } from '../lib/api';
import { priceInput, readPrice, storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { fieldErrors } from '../lib/messaging';
import { blockedQuery, dateOnly } from '../lib/orders';

const int = (s: string) => {
  const n = Number(s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim());
  return Number.isInteger(n) ? n : null;
};

export function CheckoutSettingsPage() {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const store = useQuery(storeSettingsQuery);
  const [checkout, setCheckout] = useState<CheckoutSettings>(defaultCheckoutSettings);
  const [cod, setCod] = useState<CodSettings>(defaultCodSettings);
  const [text, setText] = useState({
    maxQty: '10',
    phoneHour: '3',
    phoneDay: '10',
    ipHour: '10',
    codMax: '',
  });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!store.data || loaded) return;
    const c = {
      ...defaultCheckoutSettings(),
      ...(store.data.checkout as Partial<CheckoutSettings>),
    };
    const d = { ...defaultCodSettings(), ...(store.data.cod as Partial<CodSettings>) };
    setCheckout(c);
    setCod(d);
    setText({
      maxQty: String(c.maxQuantityPerLine),
      phoneHour: String(c.rateLimits.perPhoneHour),
      phoneDay: String(c.rateLimits.perPhoneDay),
      ipHour: String(c.rateLimits.perIpHour),
      codMax: priceInput(d.maxOrderValue),
    });
    setLoaded(true);
  }, [store.data, loaded]);

  const values = {
    maxQty: int(text.maxQty),
    phoneHour: int(text.phoneHour),
    phoneDay: int(text.phoneDay),
    ipHour: int(text.ipHour),
    codMax: readPrice(text.codMax),
  };
  const errors = {
    maxQty: values.maxQty === null || values.maxQty < 1 || values.maxQty > 999,
    prefix: !ORDER_PREFIX.test(checkout.orderNumberPrefix),
    phoneHour: values.phoneHour === null || values.phoneHour < 1 || values.phoneHour > 100,
    phoneDay: values.phoneDay === null || values.phoneDay < 1 || values.phoneDay > 500,
    ipHour: values.ipHour === null || values.ipHour < 1 || values.ipHour > 500,
    codMax: values.codMax === undefined,
  };
  const save = useMutation({
    mutationFn: async () => {
      if (Object.values(errors).some(Boolean)) throw new Error('invalid');
      return unwrap(
        await api.PATCH('/v1/admin/store', {
          body: {
            checkout: {
              ...checkout,
              maxQuantityPerLine: values.maxQty as number,
              rateLimits: {
                perPhoneHour: values.phoneHour as number,
                perPhoneDay: values.phoneDay as number,
                perIpHour: values.ipHour as number,
              },
            },
            cod: { ...cod, maxOrderValue: values.codMax ?? null },
          },
        }),
      );
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(storeSettingsQuery.queryKey, saved);
      toast(t('account.saved'));
    },
  });

  if (store.isPending) return <p role="status">{t('loading')}</p>;
  if (store.isError) return <Notice tone="error">{errorMessage(store.error, t)}</Notice>;
  const refused = fieldErrors(save.error);
  const err = (bad: boolean) => (bad ? t('form.invalid') : undefined);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('checkoutSettings.title')}
        description={t('checkoutSettings.intro')}
      />
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={!canEdit || save.isPending} className="flex flex-col gap-4">
          <legend className="mb-2 text-lg font-semibold">{t('checkoutSettings.checkout')}</legend>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('checkoutSettings.email')}</legend>
            {EMAIL_FIELD_MODES.map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="email-mode"
                  className="size-5"
                  checked={checkout.email === m}
                  onChange={() => setCheckout({ ...checkout, email: m })}
                />
                {t(`checkoutSettings.email.${m}`)}
              </label>
            ))}
          </fieldset>
          <Field
            label={t('checkoutSettings.maxQty')}
            hint={t('checkoutSettings.maxQtyHint')}
            inputMode="numeric"
            value={text.maxQty}
            onChange={(e) => setText({ ...text, maxQty: e.target.value })}
            error={err(errors.maxQty)}
          />
          <Field
            label={t('checkoutSettings.prefix')}
            hint={t('checkoutSettings.prefixHint', {
              example: `${checkout.orderNumberPrefix}1001`,
            })}
            value={checkout.orderNumberPrefix}
            maxLength={8}
            onChange={(e) => setCheckout({ ...checkout, orderNumberPrefix: e.target.value })}
            error={err(errors.prefix)}
          />
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              className="mt-3 size-5"
              checked={checkout.termsCheckbox}
              onChange={(e) => setCheckout({ ...checkout, termsCheckbox: e.target.checked })}
            />
            <span className="flex min-h-11 flex-col justify-center">
              {t('checkoutSettings.terms')}
              <span className="text-sm text-muted-foreground">
                {t('checkoutSettings.termsHint')}
              </span>
            </span>
          </label>
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              className="mt-3 size-5"
              checked={checkout.accounts}
              onChange={(e) => setCheckout({ ...checkout, accounts: e.target.checked })}
            />
            <span className="flex min-h-11 flex-col justify-center">
              {t('checkoutSettings.accounts')}
              <span className="text-sm text-muted-foreground">
                {t('checkoutSettings.accountsHint')}
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset disabled={!canEdit || save.isPending} className="flex flex-col gap-4">
          <legend className="mb-2 text-lg font-semibold">{t('checkoutSettings.cod')}</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={cod.enabled}
              onChange={(e) => setCod({ ...cod, enabled: e.target.checked })}
            />
            {t('checkoutSettings.codEnabled')}
          </label>
          {!cod.enabled && <Notice>{t('checkoutSettings.codOffNotice')}</Notice>}
          <Field
            label={t('checkoutSettings.codMax')}
            hint={t('checkoutSettings.codMaxHint')}
            inputMode="decimal"
            value={text.codMax}
            onChange={(e) => setText({ ...text, codMax: e.target.value })}
            error={err(errors.codMax)}
          />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('checkoutSettings.advance')}</legend>
            {COD_ADVANCE_RULES.map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="advance"
                  className="size-5"
                  checked={cod.advance === r}
                  onChange={() => setCod({ ...cod, advance: r })}
                />
                {t(`checkoutSettings.advance.${r}`)}
              </label>
            ))}
            <p className="text-sm text-muted-foreground">{t('checkoutSettings.advanceHint')}</p>
            {refused['cod.advance'] && (
              <Notice tone="error">
                {t('checkoutSettings.needsGateway')}{' '}
                <Link to="/settings/payments" className="underline">
                  {t('payments.title')}
                </Link>
              </Notice>
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('checkoutSettings.otp')}</legend>
            {COD_OTP_RULES.map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="otp"
                  className="size-5"
                  checked={cod.otp === r}
                  onChange={() => setCod({ ...cod, otp: r })}
                />
                {t(`checkoutSettings.otp.${r}`)}
              </label>
            ))}
            <p className="text-sm text-muted-foreground">{t('checkoutSettings.otpHint')}</p>
            {refused['cod.otp'] && <Notice tone="error">{t('checkoutSettings.needsSms')}</Notice>}
          </fieldset>
        </fieldset>

        <fieldset disabled={!canEdit || save.isPending} className="flex flex-col gap-4">
          <legend className="mb-2 text-lg font-semibold">{t('checkoutSettings.limits')}</legend>
          <p className="text-sm text-muted-foreground">{t('checkoutSettings.limitsHint')}</p>
          <div className="grid gap-3 md:grid-cols-3">
            <Field
              label={t('checkoutSettings.perPhoneHour')}
              inputMode="numeric"
              value={text.phoneHour}
              onChange={(e) => setText({ ...text, phoneHour: e.target.value })}
              error={err(errors.phoneHour)}
            />
            <Field
              label={t('checkoutSettings.perPhoneDay')}
              inputMode="numeric"
              value={text.phoneDay}
              onChange={(e) => setText({ ...text, phoneDay: e.target.value })}
              error={err(errors.phoneDay)}
            />
            <Field
              label={t('checkoutSettings.perIpHour')}
              inputMode="numeric"
              value={text.ipHour}
              onChange={(e) => setText({ ...text, ipHour: e.target.value })}
              error={err(errors.ipHour)}
            />
          </div>
        </fieldset>
        {save.error && !refused['cod.advance'] && !refused['cod.otp'] && (
          <Notice tone="error">
            {save.error instanceof ApiError && save.error.problem?.code === 'feature_unavailable'
              ? t('checkoutSettings.accountsUnavailable')
              : saveErrorMessage(save.error, t)}
          </Notice>
        )}
        {canEdit && (
          <div>
            <Button type="submit" disabled={save.isPending}>
              {t('action.save')}
            </Button>
          </div>
        )}
      </form>
      <Blocklist />
    </div>
  );
}

function Blocklist() {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const list = useQuery(blockedQuery);
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: blockedQuery.queryKey });
  const block = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/blocked-phones', {
          body: { phone: normalizePhone(phone) as string, reason: reason.trim() },
        }),
      ),
    onSuccess: async () => {
      setPhone('');
      setReason('');
      await refresh();
    },
  });
  const unblock = useMutation({
    mutationFn: async (p: string) =>
      unwrap(
        await api.DELETE('/v1/admin/blocked-phones/{phone}', { params: { path: { phone: p } } }),
      ),
    onSuccess: refresh,
  });
  return (
    <section aria-labelledby="blocklist-h" className="flex flex-col gap-3">
      <h2 id="blocklist-h" className="text-lg font-semibold">
        {t('blocklist.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('blocklist.intro')}</p>
      {canEdit && (
        <form
          className="grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!normalizePhone(phone) || !reason.trim()) {
              setInvalid(true);
              return;
            }
            setInvalid(false);
            block.mutate();
          }}
        >
          <Field
            label={t('customer.phone')}
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={invalid && !normalizePhone(phone) ? t('form.invalidPhone') : undefined}
          />
          <Field
            label={t('blocklist.reason')}
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            error={invalid && !reason.trim() ? t('form.required') : undefined}
          />
          <Button type="submit" disabled={block.isPending}>
            {t('blocklist.block')}
          </Button>
        </form>
      )}
      {(block.error ?? unblock.error) && (
        <Notice tone="error">{saveErrorMessage(block.error ?? unblock.error, t)}</Notice>
      )}
      {list.data && list.data.length === 0 && (
        <p className="text-muted-foreground">{t('blocklist.empty')}</p>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {list.data.map((b) => (
            <li key={b.phone} className="flex flex-wrap items-center gap-3 p-3">
              <span className="flex flex-1 flex-col">
                <span className="font-medium">{b.phone}</span>
                <span className="text-sm text-muted-foreground">
                  {b.reason} · {dateOnly(locale, b.createdAt)}
                </span>
              </span>
              {canEdit && (
                <Button
                  variant="secondary"
                  disabled={unblock.isPending}
                  onClick={() => unblock.mutate(b.phone)}
                >
                  {t('blocklist.unblock')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
