// Settings → Order confirmation (phase-6-plan §3.1, §3.8): when a phone is
// risky, and the duplicate window. Risky phones get the advance or the code
// that Settings → Checkout chooses.
import { defaultFraudSettings, type FraudSettings } from '@managemind/shared/orders';
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

/** A whole number typed in either numeral system, or null. */
const int = (s: string) => {
  const latin = s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim();
  const n = Number(latin);
  return latin !== '' && Number.isInteger(n) ? n : null;
};
const between = (n: number | null, min: number, max: number) => n !== null && n >= min && n <= max;

const card = 'flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5';

export function ConfirmationSettingsPage() {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const store = useQuery(storeSettingsQuery);
  const [text, setText] = useState({
    flagAfterFailed: '1',
    minScore: '',
    minDecided: '2',
    duplicateMinutes: '30',
  });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!store.data || loaded) return;
    const f = { ...defaultFraudSettings(), ...(store.data.fraud as Partial<FraudSettings>) };
    setText({
      flagAfterFailed: String(f.flagAfterFailed),
      minScore: f.minScore === null ? '' : String(f.minScore),
      minDecided: String(f.minDecided),
      duplicateMinutes: String(f.duplicateMinutes),
    });
    setLoaded(true);
  }, [store.data, loaded]);

  const values = {
    flagAfterFailed: int(text.flagAfterFailed),
    minScore: text.minScore.trim() === '' ? null : int(text.minScore),
    minDecided: int(text.minDecided),
    duplicateMinutes: int(text.duplicateMinutes),
  };
  const errors = {
    flagAfterFailed: !between(values.flagAfterFailed, 1, 20),
    minScore: text.minScore.trim() !== '' && !between(values.minScore, 0, 100),
    minDecided: !between(values.minDecided, 1, 20),
    duplicateMinutes: !between(values.duplicateMinutes, 0, 1440),
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
        {save.error && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
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
