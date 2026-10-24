// Settings → Order confirmation (phase-6-plan §3.1, §3.6, §3.8): the
// confirmation queue and its call script, when a phone is risky, and the
// duplicate window. Risky phones get the advance or the code that
// Settings → Checkout chooses.
import {
  AUTO_CONFIRM_RULES,
  type ConfirmationSettings,
  DEFAULT_CALL_SCRIPT,
  defaultConfirmationSettings,
  defaultFraudSettings,
  type FraudSettings,
  renderCallScript,
  SCRIPT_VARIABLES,
  unknownScriptVariables,
} from '@managemind/shared/orders';
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
import { api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { fieldErrors } from '../lib/messaging';

/** A whole number typed in either numeral system, or null. */
const int = (s: string) => {
  const latin = s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim();
  const n = Number(latin);
  return latin !== '' && Number.isInteger(n) ? n : null;
};
const between = (n: number | null, min: number, max: number) => n !== null && n >= min && n <= max;

const card = 'flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5';

/** What the preview fills the script with. */
const SAMPLE: Record<'bn' | 'en', Record<(typeof SCRIPT_VARIABLES)[number], string>> = {
  en: {
    name: 'Rina Akter',
    order_number: '#1042',
    items: 'Cotton kurti × 2',
    total: '৳2,450',
    cod_amount: '৳2,450',
    area: 'Dhanmondi',
    delivery_estimate: '1–2 days',
    store_name: 'Your store',
  },
  bn: {
    name: 'রিনা আক্তার',
    order_number: '#১০৪২',
    items: 'সুতি কুর্তি × ২',
    total: '৳২,৪৫০',
    cod_amount: '৳২,৪৫০',
    area: 'ধানমন্ডি',
    delivery_estimate: '১–২ দিন',
    store_name: 'আপনার দোকান',
  },
};

export function ConfirmationSettingsPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const store = useQuery(storeSettingsQuery);
  const [confirmation, setConfirmation] = useState<ConfirmationSettings>(
    defaultConfirmationSettings,
  );
  const [script, setScript] = useState({ bn: '', en: '' });
  const [text, setText] = useState({
    flagAfterFailed: '1',
    minScore: '',
    minDecided: '2',
    duplicateMinutes: '30',
    maxAttempts: '3',
    retryAfterMinutes: '60',
  });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!store.data || loaded) return;
    const f = { ...defaultFraudSettings(), ...(store.data.fraud as Partial<FraudSettings>) };
    const c = {
      ...defaultConfirmationSettings(),
      ...(store.data.confirmation as Partial<ConfirmationSettings>),
    };
    setConfirmation(c);
    setScript({ bn: c.script.bn ?? '', en: c.script.en ?? '' });
    setText({
      flagAfterFailed: String(f.flagAfterFailed),
      minScore: f.minScore === null ? '' : String(f.minScore),
      minDecided: String(f.minDecided),
      duplicateMinutes: String(f.duplicateMinutes),
      maxAttempts: String(c.maxAttempts),
      retryAfterMinutes: String(c.retryAfterMinutes),
    });
    setLoaded(true);
  }, [store.data, loaded]);

  const values = {
    flagAfterFailed: int(text.flagAfterFailed),
    minScore: text.minScore.trim() === '' ? null : int(text.minScore),
    minDecided: int(text.minDecided),
    duplicateMinutes: int(text.duplicateMinutes),
    maxAttempts: int(text.maxAttempts),
    retryAfterMinutes: int(text.retryAfterMinutes),
  };
  const unknown = {
    bn: unknownScriptVariables(script.bn),
    en: unknownScriptVariables(script.en),
  };
  const errors = {
    flagAfterFailed: !between(values.flagAfterFailed, 1, 20),
    minScore: text.minScore.trim() !== '' && !between(values.minScore, 0, 100),
    minDecided: !between(values.minDecided, 1, 20),
    duplicateMinutes: !between(values.duplicateMinutes, 0, 1440),
    maxAttempts: !between(values.maxAttempts, 1, 10),
    retryAfterMinutes: !between(values.retryAfterMinutes, 5, 1440),
    scriptBn: unknown.bn.length > 0,
    scriptEn: unknown.en.length > 0,
  };
  const save = useMutation({
    mutationFn: async () => {
      if (Object.values(errors).some(Boolean)) throw new Error('invalid');
      return unwrap(
        await api.PATCH('/v1/admin/store', {
          body: {
            fraud: {
              flagAfterFailed: values.flagAfterFailed as number,
              minScore: values.minScore,
              minDecided: values.minDecided as number,
              duplicateMinutes: values.duplicateMinutes as number,
            },
            confirmation: {
              ...confirmation,
              maxAttempts: values.maxAttempts as number,
              retryAfterMinutes: values.retryAfterMinutes as number,
              // An empty language uses the default, which can then improve.
              script: {
                ...(script.bn.trim() ? { bn: script.bn.trim() } : {}),
                ...(script.en.trim() ? { en: script.en.trim() } : {}),
              },
            },
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
  const err = (bad: boolean) => (bad ? t('form.invalid') : undefined);
  const refused = fieldErrors(save.error);
  const check = (
    key: 'queue' | 'includePaid' | 'cancelUnreachable' | 'smsLink' | 'callRisky',
    label: string,
    hint?: string,
  ) => (
    <label className="flex min-h-11 items-start gap-3">
      <input
        type="checkbox"
        className="mt-3 size-5"
        checked={confirmation[key]}
        onChange={(e) => setConfirmation({ ...confirmation, [key]: e.target.checked })}
      />
      <span className="flex min-h-11 flex-col justify-center">
        {label}
        {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
  const storeName = store.data.name;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('confirmSettings.title')}
        description={t('confirmSettings.intro')}
      />
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={!canEdit || save.isPending} className={card}>
          <legend className="mb-2 text-lg font-semibold">{t('confirmSettings.queue')}</legend>
          {check('queue', t('confirmSettings.queueOn'), t('confirmSettings.queueHint'))}
          {confirmation.queue && (
            <>
              {check('includePaid', t('confirmSettings.includePaid'))}
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label={t('confirmSettings.maxAttempts')}
                  inputMode="numeric"
                  value={text.maxAttempts}
                  onChange={(e) => setText({ ...text, maxAttempts: e.target.value })}
                  error={err(errors.maxAttempts)}
                />
                <Field
                  label={t('confirmSettings.retryAfter')}
                  inputMode="numeric"
                  value={text.retryAfterMinutes}
                  onChange={(e) => setText({ ...text, retryAfterMinutes: e.target.value })}
                  error={err(errors.retryAfterMinutes)}
                />
              </div>
              {check(
                'cancelUnreachable',
                t('confirmSettings.cancelUnreachable'),
                t('confirmSettings.cancelUnreachableHint'),
              )}
              {check('smsLink', t('confirmSettings.smsLink'), t('confirmSettings.smsLinkHint'))}
              {refused['confirmation.smsLink'] && (
                <Notice tone="error">{t('checkoutSettings.needsSms')}</Notice>
              )}
              {confirmation.smsLink &&
                check(
                  'callRisky',
                  t('confirmSettings.callRisky'),
                  t('confirmSettings.callRiskyHint'),
                )}
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">
                  {t('confirmSettings.autoConfirm')}
                </legend>
                {AUTO_CONFIRM_RULES.map((r) => (
                  <label key={r} className="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name="auto-confirm"
                      className="size-5"
                      checked={confirmation.autoConfirm === r}
                      onChange={() => setConfirmation({ ...confirmation, autoConfirm: r })}
                    />
                    {t(`confirmSettings.autoConfirm.${r}`)}
                  </label>
                ))}
              </fieldset>
            </>
          )}
        </fieldset>

        {confirmation.queue && (
          <fieldset disabled={!canEdit || save.isPending} className={card}>
            <legend className="mb-2 text-lg font-semibold">{t('confirmSettings.script')}</legend>
            <p className="text-sm text-muted-foreground">{t('confirmSettings.scriptHint')}</p>
            <p className="flex flex-wrap gap-1.5">
              {SCRIPT_VARIABLES.map((v) => (
                <code key={v} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {`{${v}}`}
                </code>
              ))}
            </p>
            {(['bn', 'en'] as const).map((lang) => (
              <div key={lang} className="flex flex-col gap-1.5">
                <label htmlFor={`script-${lang}`} className="text-sm font-medium">
                  {t(lang === 'bn' ? 'confirmSettings.scriptBn' : 'confirmSettings.scriptEn')}
                </label>
                <textarea
                  id={`script-${lang}`}
                  rows={5}
                  maxLength={2000}
                  lang={lang}
                  value={script[lang]}
                  placeholder={DEFAULT_CALL_SCRIPT[lang]}
                  onChange={(e) => setScript({ ...script, [lang]: e.target.value })}
                  aria-invalid={unknown[lang].length > 0 || undefined}
                  className="rounded-lg border border-input bg-background p-3 text-base md:text-sm"
                />
                {unknown[lang].length > 0 && (
                  <p className="text-sm text-danger">
                    {t('confirmSettings.unknownPlaceholder', {
                      names: unknown[lang].map((n) => `{${n}}`).join(', '),
                    })}
                  </p>
                )}
              </div>
            ))}
            <div className="flex flex-col gap-1.5 rounded-lg bg-muted p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('confirmSettings.preview')}
              </span>
              <p lang={locale} className="whitespace-pre-wrap text-sm">
                {renderCallScript(
                  { bn: script.bn.trim() || undefined, en: script.en.trim() || undefined },
                  locale,
                  { ...SAMPLE[locale], store_name: storeName },
                )}
              </p>
            </div>
          </fieldset>
        )}

        <fieldset disabled={!canEdit || save.isPending} className={card}>
          <legend className="mb-2 text-lg font-semibold">{t('confirmSettings.risky')}</legend>
          <p className="text-sm text-muted-foreground">
            {t('confirmSettings.riskyIntro')}{' '}
            <Link to="/settings/checkout" className="underline">
              {t('checkoutSettings.title')}
            </Link>
          </p>
          <Field
            label={t('confirmSettings.flagAfterFailed')}
            hint={t('confirmSettings.flagAfterFailedHint')}
            inputMode="numeric"
            value={text.flagAfterFailed}
            onChange={(e) => setText({ ...text, flagAfterFailed: e.target.value })}
            error={err(errors.flagAfterFailed)}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label={t('confirmSettings.minScore')}
              hint={t('confirmSettings.minScoreHint')}
              inputMode="numeric"
              value={text.minScore}
              onChange={(e) => setText({ ...text, minScore: e.target.value })}
              error={err(errors.minScore)}
            />
            <Field
              label={t('confirmSettings.minDecided')}
              hint={t('confirmSettings.minDecidedHint')}
              inputMode="numeric"
              value={text.minDecided}
              onChange={(e) => setText({ ...text, minDecided: e.target.value })}
              error={err(errors.minDecided)}
            />
          </div>
        </fieldset>

        <fieldset disabled={!canEdit || save.isPending} className={card}>
          <legend className="mb-2 text-lg font-semibold">{t('confirmSettings.duplicates')}</legend>
          <Field
            label={t('confirmSettings.duplicateMinutes')}
            hint={t('confirmSettings.duplicateMinutesHint')}
            inputMode="numeric"
            value={text.duplicateMinutes}
            onChange={(e) => setText({ ...text, duplicateMinutes: e.target.value })}
            error={err(errors.duplicateMinutes)}
          />
        </fieldset>
        {save.error && !refused['confirmation.smsLink'] && (
          <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>
        )}
        {canEdit && (
          <div>
            <Button type="submit" disabled={save.isPending}>
              {t('action.save')}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
