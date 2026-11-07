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
import { fieldHint, fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { MoneyInput, RadioCard } from '../components/ui/choice';
import { ChoiceChips } from '../components/ui/segmented';
import { SwitchRow } from '../components/ui/switch';
import { useLocale } from '../i18n';
import '../i18n/orders';
import { ApiError, api, unwrap } from '../lib/api';
import { priceInput, readPrice, storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { fieldErrors } from '../lib/messaging';
import { blockedQuery, dateOnly } from '../lib/orders';
import { cn } from '../lib/utils';

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
  // What was loaded or last saved: the save bar shows once something differs.
  const [snapshot, setSnapshot] = useState('');
  const current = JSON.stringify({ checkout, cod, text });
  const dirty = loaded && current !== snapshot;
  useEffect(() => {
    if (!store.data || loaded) return;
    const c = {
      ...defaultCheckoutSettings(),
      ...(store.data.checkout as Partial<CheckoutSettings>),
    };
    const d = { ...defaultCodSettings(), ...(store.data.cod as Partial<CodSettings>) };
    const tx = {
      maxQty: String(c.maxQuantityPerLine),
      phoneHour: String(c.rateLimits.perPhoneHour),
      phoneDay: String(c.rateLimits.perPhoneDay),
      ipHour: String(c.rateLimits.perIpHour),
      codMax: priceInput(d.maxOrderValue),
    };
    setCheckout(c);
    setCod(d);
    setText(tx);
    setSnapshot(JSON.stringify({ checkout: c, cod: d, text: tx }));
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
      setSnapshot(current);
      toast(t('account.saved'));
    },
  });

  if (store.isPending) return <p role="status">{t('loading')}</p>;
  if (store.isError) return <Notice tone="error">{errorMessage(store.error, t)}</Notice>;
  const refused = fieldErrors(save.error);
  const err = (bad: boolean) => (bad ? t('form.invalid') : undefined);
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('checkoutSettings.title')}
        description={t('checkoutSettings.intro')}
      />
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <form
        className="flex flex-col gap-3 md:gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset
          disabled={!canEdit || save.isPending}
          aria-labelledby="checkout-card"
          className={cn(cardPadded, 'm-0 gap-4 md:gap-4')}
        >
          <h2 id="checkout-card" className={cardTitle}>
            {t('checkoutSettings.checkout')}
          </h2>
          <div className="flex flex-col">
            <span className={fieldLabel}>{t('checkoutSettings.email')}</span>
            <ChoiceChips
              label={t('checkoutSettings.email')}
              value={checkout.email}
              options={EMAIL_FIELD_MODES.map((m) => ({
                value: m,
                label: t(`checkoutSettings.email.${m}`),
              }))}
              onChange={(email) => setCheckout({ ...checkout, email })}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
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
          </div>
          <div role="presentation" className="-mx-4 h-px bg-border md:-mx-5" />
          <SwitchRow
            label={t('checkoutSettings.terms')}
            hint={t('checkoutSettings.termsHint')}
            checked={checkout.termsCheckbox}
            onCheckedChange={(on) => setCheckout({ ...checkout, termsCheckbox: on })}
          />
          <SwitchRow
            label={t('checkoutSettings.accounts')}
            hint={t('checkoutSettings.accountsHint')}
            checked={checkout.accounts}
            onCheckedChange={(on) => setCheckout({ ...checkout, accounts: on })}
          />
        </fieldset>

        <fieldset
          disabled={!canEdit || save.isPending}
          aria-labelledby="checkout-cod"
          className={cn(cardPadded, 'm-0 gap-4 md:gap-4')}
        >
          <h2 id="checkout-cod" className={cardTitle}>
            {t('checkoutSettings.cod')}
          </h2>
          <SwitchRow
            label={t('checkoutSettings.codEnabled')}
            checked={cod.enabled}
            onCheckedChange={(on) => setCod({ ...cod, enabled: on })}
          />
          {!cod.enabled && <Notice>{t('checkoutSettings.codOffNotice')}</Notice>}
          <div className="flex flex-col">
            <label htmlFor="cod-max" className={fieldLabel}>
              {t('checkoutSettings.codMax')}
            </label>
            <MoneyInput
              id="cod-max"
              aria-describedby="cod-max-hint"
              aria-invalid={errors.codMax}
              value={text.codMax}
              onChange={(e) => setText({ ...text, codMax: e.target.value })}
            />
            <p id="cod-max-hint" className={cn(fieldHint, errors.codMax && 'text-danger')}>
              {errors.codMax ? t('form.invalid') : t('checkoutSettings.codMaxHint')}
            </p>
          </div>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className={fieldLabel}>{t('checkoutSettings.advance')}</legend>
            {COD_ADVANCE_RULES.map((r) => (
              <RadioCard
                key={r}
                name="advance"
                checked={cod.advance === r}
                onChange={() => setCod({ ...cod, advance: r })}
                label={t(`checkoutSettings.advance.${r}`)}
              />
            ))}
            <p className={fieldHint}>{t('checkoutSettings.advanceHint')}</p>
            {refused['cod.advance'] && (
              <Notice tone="error">
                {t('checkoutSettings.needsGateway')}{' '}
                <Link to="/settings/payments" className="underline">
                  {t('payments.title')}
                </Link>
              </Notice>
            )}
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className={fieldLabel}>{t('checkoutSettings.otp')}</legend>
            {COD_OTP_RULES.map((r) => (
              <RadioCard
                key={r}
                name="otp"
                checked={cod.otp === r}
                onChange={() => setCod({ ...cod, otp: r })}
                label={t(`checkoutSettings.otp.${r}`)}
              />
            ))}
            <p className={fieldHint}>{t('checkoutSettings.otpHint')}</p>
            {refused['cod.otp'] && <Notice tone="error">{t('checkoutSettings.needsSms')}</Notice>}
          </fieldset>
        </fieldset>

        <fieldset
          disabled={!canEdit || save.isPending}
          aria-labelledby="checkout-limits"
          className={cn(cardPadded, 'm-0 gap-4 md:gap-4')}
        >
          <div className="flex flex-col gap-1">
            <h2 id="checkout-limits" className={cardTitle}>
              {t('checkoutSettings.limits')}
            </h2>
            <p className="text-[13px] text-muted-foreground">{t('checkoutSettings.limitsHint')}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3 md:gap-x-4">
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
    <section
      aria-labelledby="blocklist-h"
      className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
    >
      <h2 id="blocklist-h" className="font-semibold">
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
