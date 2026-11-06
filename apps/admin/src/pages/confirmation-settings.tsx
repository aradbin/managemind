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
  defaultRecoverySettings,
  type FraudSettings,
  type RecoverySettings,
  renderCallScript,
  SCRIPT_VARIABLES,
  unknownScriptVariables,
} from '@managemind/shared/orders';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Field } from '../components/field';
import { fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { RadioCard } from '../components/ui/choice';
import { Textarea } from '../components/ui/input';
import { ChoiceChips } from '../components/ui/segmented';
import { SwitchRow } from '../components/ui/switch';
import { useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { fieldErrors } from '../lib/messaging';
import { cn } from '../lib/utils';

/** A whole number typed in either numeral system, or null. */
const int = (s: string) => {
  const latin = s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim();
  const n = Number(latin);
  return latin !== '' && Number.isInteger(n) ? n : null;
};
const between = (n: number | null, min: number, max: number) => n !== null && n >= min && n <= max;

const card = cn(cardPadded, 'm-0 gap-4 md:gap-4');

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
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const store = useQuery(storeSettingsQuery);
  const [confirmation, setConfirmation] = useState<ConfirmationSettings>(
    defaultConfirmationSettings,
  );
  const [script, setScript] = useState({ bn: '', en: '' });
  const [recovery, setRecovery] = useState<RecoverySettings>(defaultRecoverySettings);
  const [text, setText] = useState({
    flagAfterFailed: '1',
    minScore: '',
    minDecided: '2',
    duplicateMinutes: '30',
    maxAttempts: '3',
    retryAfterMinutes: '60',
    showAfterMinutes: '30',
    keepDays: '30',
  });
  const [loaded, setLoaded] = useState(false);
  // What was loaded or last saved: the save bar shows once something differs.
  const [snapshot, setSnapshot] = useState('');
  const [scriptLang, setScriptLang] = useState<'bn' | 'en'>('bn');
  const [preview, setPreview] = useState(false);
  const current = JSON.stringify({ confirmation, script, recovery, text });
  const dirty = loaded && current !== snapshot;
  useEffect(() => {
    if (!store.data || loaded) return;
    const f = { ...defaultFraudSettings(), ...(store.data.fraud as Partial<FraudSettings>) };
    const c = {
      ...defaultConfirmationSettings(),
      ...(store.data.confirmation as Partial<ConfirmationSettings>),
    };
    const r = {
      ...defaultRecoverySettings(),
      ...(store.data.recovery as Partial<RecoverySettings>),
    };
    setConfirmation(c);
    setRecovery(r);
    setScript({ bn: c.script.bn ?? '', en: c.script.en ?? '' });
    const tx = {
      flagAfterFailed: String(f.flagAfterFailed),
      minScore: f.minScore === null ? '' : String(f.minScore),
      minDecided: String(f.minDecided),
      duplicateMinutes: String(f.duplicateMinutes),
      maxAttempts: String(c.maxAttempts),
      retryAfterMinutes: String(c.retryAfterMinutes),
      showAfterMinutes: String(r.showAfterMinutes),
      keepDays: String(r.keepDays),
    };
    setText(tx);
    setSnapshot(
      JSON.stringify({
        confirmation: c,
        script: { bn: c.script.bn ?? '', en: c.script.en ?? '' },
        recovery: r,
        text: tx,
      }),
    );
    setLoaded(true);
  }, [store.data, loaded]);

  const values = {
    flagAfterFailed: int(text.flagAfterFailed),
    minScore: text.minScore.trim() === '' ? null : int(text.minScore),
    minDecided: int(text.minDecided),
    duplicateMinutes: int(text.duplicateMinutes),
    maxAttempts: int(text.maxAttempts),
    retryAfterMinutes: int(text.retryAfterMinutes),
    showAfterMinutes: int(text.showAfterMinutes),
    keepDays: int(text.keepDays),
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
    showAfterMinutes: !between(values.showAfterMinutes, 0, 1440),
    keepDays: !between(values.keepDays, 1, 30),
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
            recovery: {
              incomplete: recovery.incomplete,
              showAfterMinutes: values.showAfterMinutes as number,
              keepDays: values.keepDays as number,
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
      setSnapshot(current);
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
    <SwitchRow
      label={label}
      hint={hint}
      checked={confirmation[key]}
      onCheckedChange={(on) => setConfirmation({ ...confirmation, [key]: on })}
    />
  );
  const storeName = store.data.name;
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('confirmSettings.title')}
        description={t('confirmSettings.intro')}
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
          aria-labelledby="conf-queue"
          className={card}
        >
          <h2 id="conf-queue" className={cardTitle}>
            {t('confirmSettings.queue')}
          </h2>
          {check('queue', t('confirmSettings.queueOn'), t('confirmSettings.queueHint'))}
          {confirmation.queue && (
            <>
              {check('includePaid', t('confirmSettings.includePaid'))}
              <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
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
              <div role="presentation" className="-mx-4 h-px bg-border md:-mx-5" />
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
              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className={fieldLabel}>{t('confirmSettings.autoConfirm')}</legend>
                {AUTO_CONFIRM_RULES.map((r) => (
                  <RadioCard
                    key={r}
                    name="auto-confirm"
                    checked={confirmation.autoConfirm === r}
                    onChange={() => setConfirmation({ ...confirmation, autoConfirm: r })}
                    label={t(`confirmSettings.autoConfirm.${r}`)}
                  />
                ))}
              </fieldset>
            </>
          )}
        </fieldset>

        {confirmation.queue && (
          <fieldset
            disabled={!canEdit || save.isPending}
            aria-labelledby="conf-script"
            className={card}
          >
            <h2 id="conf-script" className={cardTitle}>
              {t('confirmSettings.script')}
            </h2>
            <p className="-mt-3 text-[13px] text-muted-foreground">
              {t('confirmSettings.scriptHint')}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ChoiceChips<'bn' | 'en'>
                label={t('confirmSettings.scriptLanguage')}
                value={scriptLang}
                options={[
                  { value: 'bn', label: 'বাংলা' },
                  { value: 'en', label: 'English' },
                ]}
                onChange={setScriptLang}
              />
              <Button
                variant="ghost"
                aria-pressed={preview}
                className="-mr-2 h-7 px-2 md:h-7"
                onClick={() => setPreview(!preview)}
              >
                <Eye aria-hidden />
                {t('confirmSettings.preview')}
              </Button>
            </div>
            {preview ? (
              <p
                lang={scriptLang}
                className="rounded-lg bg-muted p-3 whitespace-pre-wrap"
                aria-live="polite"
              >
                {renderCallScript(
                  { bn: script.bn.trim() || undefined, en: script.en.trim() || undefined },
                  scriptLang,
                  { ...SAMPLE[scriptLang], store_name: storeName },
                )}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="script-text" className="sr-only">
                  {t(scriptLang === 'bn' ? 'confirmSettings.scriptBn' : 'confirmSettings.scriptEn')}
                </label>
                <Textarea
                  id="script-text"
                  rows={5}
                  maxLength={2000}
                  lang={scriptLang}
                  value={script[scriptLang]}
                  placeholder={DEFAULT_CALL_SCRIPT[scriptLang]}
                  onChange={(e) => setScript({ ...script, [scriptLang]: e.target.value })}
                  aria-invalid={unknown[scriptLang].length > 0 || undefined}
                />
                {unknown[scriptLang].length > 0 && (
                  <p className="text-[13px] text-danger">
                    {t('confirmSettings.unknownPlaceholder', {
                      names: unknown[scriptLang].map((n) => `{${n}}`).join(', '),
                    })}
                  </p>
                )}
                <p className="flex flex-wrap gap-1.5">
                  {SCRIPT_VARIABLES.map((v) => (
                    <code key={v} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {`{${v}}`}
                    </code>
                  ))}
                </p>
              </div>
            )}
          </fieldset>
        )}

        <fieldset
          disabled={!canEdit || save.isPending}
          aria-labelledby="conf-incomplete"
          className={card}
        >
          <h2 id="conf-incomplete" className={cardTitle}>
            {t('incomplete.title')}
          </h2>
          <SwitchRow
            label={t('confirmSettings.incomplete')}
            hint={t('confirmSettings.incompleteHint')}
            checked={recovery.incomplete}
            onCheckedChange={(on) => setRecovery({ ...recovery, incomplete: on })}
          />
          {recovery.incomplete && (
            <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
              <Field
                label={t('confirmSettings.showAfter')}
                inputMode="numeric"
                value={text.showAfterMinutes}
                onChange={(e) => setText({ ...text, showAfterMinutes: e.target.value })}
                error={err(errors.showAfterMinutes)}
              />
              <Field
                label={t('confirmSettings.keepDays')}
                hint={t('confirmSettings.keepDaysHint')}
                inputMode="numeric"
                value={text.keepDays}
                onChange={(e) => setText({ ...text, keepDays: e.target.value })}
                error={err(errors.keepDays)}
              />
            </div>
          )}
        </fieldset>

        <fieldset
          disabled={!canEdit || save.isPending}
          aria-labelledby="conf-risky"
          className={card}
        >
          <h2 id="conf-risky" className={cardTitle}>
            {t('confirmSettings.risky')}
          </h2>
          <p className="-mt-3 text-[13px] text-muted-foreground">
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
          <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
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

        <fieldset
          disabled={!canEdit || save.isPending}
          aria-labelledby="conf-dupes"
          className={card}
        >
          <h2 id="conf-dupes" className={cardTitle}>
            {t('confirmSettings.duplicates')}
          </h2>
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
    </div>
  );
}
