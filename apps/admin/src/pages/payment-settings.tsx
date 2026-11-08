// Settings → Payments (phase-5a-plan §3.1, §3.3, §7): the store's own
// SSLCommerz account. The ID and password are checked with SSLCommerz
// before they are saved, and never shown again: only the last 4 of the ID.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { ChoiceChips } from '../components/ui/segmented';
import { Sheet, SheetBody, SheetFooter, SheetForm } from '../components/ui/sheet';
import { useLocale } from '../i18n';
import '../i18n/messages';
import { api, unwrap } from '../lib/api';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { credentialsQuery, fieldErrors } from '../lib/messaging';
import { dateTime } from '../lib/orders';
import { cn } from '../lib/utils';

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
      <div className="flex flex-col gap-3 md:gap-4">
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
  // The form opens in a side panel from "Connect SSLCommerz" or "Change" (design rule 1).
  const close = () => {
    if (save.isPending) return;
    setEditing(false);
    setMissing(false);
    save.reset();
  };
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('payments.title')}
        description={`${t('payments.description')}.`}
      />
      <section aria-labelledby="ssl-h" className={cn(cardPadded, 'gap-4 md:gap-4')}>
        <div className="flex flex-col gap-1">
          <h2 id="ssl-h" className={cardTitle}>
            SSLCommerz
          </h2>
          <p className="text-[13px] text-muted-foreground">{t('payments.intro')}</p>
        </div>
        {saved && (
          <>
            <div className="flex gap-2.5">
              {saved.checkError ? (
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
              ) : (
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">
                  {saved.mode === 'live'
                    ? t('payments.connectedLive')
                    : t('payments.connectedSandbox')}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {t('payments.storeIdEnds', { hint: saved.hint })}
                  {saved.checkedAt &&
                    ` · ${t('payments.checked', { when: dateTime(locale, saved.checkedAt) })}`}
                </span>
              </div>
            </div>
            {saved.checkError && (
              <Notice tone="error">{t('payments.failing', { reason: saved.checkError })}</Notice>
            )}
            {saved.mode === 'sandbox' && <Notice>{t('payments.sandboxNotice')}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('payments.change')}
              </Button>
              <Button
                variant="ghost"
                className="text-danger hover:text-danger"
                onClick={() => setRemoving(true)}
              >
                {t('payments.remove')}
              </Button>
            </div>
          </>
        )}
        {!saved && (
          <>
            <p className="text-muted-foreground">{t('payments.none')}</p>
            <Button className="self-start" onClick={() => setEditing(true)}>
              {t('payments.connect')}
            </Button>
          </>
        )}
      </section>
      <p className="text-[13px] text-muted-foreground">
        {t('payments.advanceLink')}{' '}
        <Link to="/settings/checkout" className="text-foreground underline underline-offset-[3px]">
          {t('checkoutSettings.title')}
        </Link>
        .
      </p>
      <Sheet
        open={editing}
        onOpenChange={(open) => !open && close()}
        title={saved ? t('payments.changeTitle') : t('payments.connect')}
        description={t('payments.keysNote')}
      >
        <SheetForm
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
          <SheetBody>
            <fieldset disabled={save.isPending} className="m-0 flex flex-col gap-5 border-0 p-0">
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
              <div className="flex flex-col">
                <span className={fieldLabel}>{t('payments.mode')}</span>
                <ChoiceChips<Mode>
                  label={t('payments.mode')}
                  value={mode}
                  options={(['sandbox', 'live'] as const).map((m) => ({
                    value: m,
                    label: t(`payments.mode.${m}`),
                  }))}
                  onChange={setMode}
                />
              </div>
            </fieldset>
            {refused && (
              <Notice tone="error">{t('payments.refused', { reason: refused.message })}</Notice>
            )}
            {save.error && !refused && (
              <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>
            )}
          </SheetBody>
          <SheetFooter>
            <Button variant="secondary" size="lg" disabled={save.isPending} onClick={close}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={save.isPending}>
              {save.isPending ? t('payments.checking') : t('payments.save')}
            </Button>
          </SheetFooter>
        </SheetForm>
      </Sheet>
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
