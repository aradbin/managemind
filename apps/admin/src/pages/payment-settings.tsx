// Settings → Payments (phase-5a-plan §3.1, §3.3, §7): the store's own
// SSLCommerz account. The ID and password are checked with SSLCommerz
// before they are saved, and never shown again: only the last 4 of the ID.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/messages';
import { api, unwrap } from '../lib/api';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { credentialsQuery, fieldErrors } from '../lib/messaging';
import { dateTime } from '../lib/orders';

type Mode = 'sandbox' | 'live';

export function PaymentSettingsPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.credentials');
  const list = useQuery({ ...credentialsQuery, enabled: canEdit });
  const saved = list.data?.find((c) => c.kind === 'sslcommerz') ?? null;
  const [editing, setEditing] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('sandbox');
  const [missing, setMissing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: credentialsQuery.queryKey });

  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT('/v1/admin/credentials/{kind}', {
          params: { path: { kind: 'sslcommerz' } },
          body: {
            provider: 'sslcommerz',
            mode,
            secrets: { storeId: storeId.trim(), storePassword: password.trim() },
          },
        }),
      ),
    onSuccess: async () => {
      setEditing(false);
      setStoreId('');
      setPassword('');
      toast(t('payments.saved'));
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/credentials/{kind}', {
          params: { path: { kind: 'sslcommerz' } },
        }),
      ),
    onSuccess: async () => {
      setRemoving(false);
      await refresh();
    },
  });

  if (!canEdit) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <PageHeader
          parent={{ to: '/settings', label: t('settings.title') }}
          title={t('payments.title')}
          description={t('payments.intro')}
        />
        <Notice>{t('payments.ownersOnly')}</Notice>
      </div>
    );
  }
  if (list.isPending) return <p role="status">{t('loading')}</p>;
  if (list.isError) return <Notice tone="error">{errorMessage(list.error, t)}</Notice>;

  const refused = fieldErrors(save.error).secrets;
  const showForm = editing || !saved;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('payments.title')}
        description={t('payments.intro')}
      />
      <section
        aria-labelledby="ssl-h"
        className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <h2 id="ssl-h" className="font-semibold">
          SSLCommerz
        </h2>
        {saved ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4 md:p-5">
            <p className="font-medium">
              {saved.mode === 'live' ? t('payments.connectedLive') : t('payments.connectedSandbox')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('payments.storeIdEnds', { hint: saved.hint })}
              {saved.checkedAt &&
                ` · ${t('payments.checked', { when: dateTime(locale, saved.checkedAt) })}`}
            </p>
            {saved.checkError && (
              <Notice tone="error">{t('payments.failing', { reason: saved.checkError })}</Notice>
            )}
            {saved.mode === 'sandbox' && <Notice>{t('payments.sandboxNotice')}</Notice>}
            {!editing && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {t('payments.change')}
                </Button>
                <Button variant="secondary" onClick={() => setRemoving(true)}>
                  {t('payments.remove')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">{t('payments.none')}</p>
        )}

        {showForm && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!storeId.trim() || !password.trim()) {
                setMissing(true);
                return;
              }
              setMissing(false);
              save.mutate();
            }}
          >
            <fieldset disabled={save.isPending} className="flex flex-col gap-4">
              <Field
                label={t('payments.storeId')}
                autoComplete="off"
                value={storeId}
                maxLength={100}
                onChange={(e) => setStoreId(e.target.value)}
                error={missing && !storeId.trim() ? t('form.required') : undefined}
              />
              <Field
                label={t('payments.password')}
                hint={t('payments.passwordHint')}
                type="password"
                autoComplete="new-password"
                value={password}
                maxLength={200}
                onChange={(e) => setPassword(e.target.value)}
                error={missing && !password.trim() ? t('form.required') : undefined}
              />
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">{t('payments.mode')}</legend>
                {(['sandbox', 'live'] as const).map((m) => (
                  <label key={m} className="flex min-h-10 items-center gap-3 md:min-h-9">
                    <input
                      type="radio"
                      name="ssl-mode"
                      className="size-4 accent-primary"
                      checked={mode === m}
                      onChange={() => setMode(m)}
                    />
                    {t(`payments.mode.${m}`)}
                  </label>
                ))}
              </fieldset>
            </fieldset>
            {refused && (
              <Notice tone="error">{t('payments.refused', { reason: refused.message })}</Notice>
            )}
            {save.error && !refused && (
              <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? t('payments.checking') : t('payments.save')}
              </Button>
              {saved && (
                <Button
                  variant="secondary"
                  disabled={save.isPending}
                  onClick={() => {
                    setEditing(false);
                    save.reset();
                  }}
                >
                  {t('action.cancel')}
                </Button>
              )}
            </div>
          </form>
        )}
        <p className="text-sm text-muted-foreground">
          {t('payments.advanceLink')}{' '}
          <Link to="/settings/checkout" className="underline">
            {t('checkoutSettings.title')}
          </Link>
        </p>
      </section>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('payments.removeTitle')}
        confirmLabel={t('payments.remove')}
        busy={remove.isPending}
        error={remove.error ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('payments.removeBody')}</p>
      </ConfirmDialog>
    </div>
  );
}
