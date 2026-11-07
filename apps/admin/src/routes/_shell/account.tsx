// Your account (phase-1-plan §5.5, §7.3): name and language, two-factor login
// with backup codes, the devices you're signed in on, and this store's
// alerts (phase-5a-plan §3.9).
import type { Locale } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Lock, Mail, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Alerts } from '../../components/alerts';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { Field } from '../../components/field';
import { fieldLabel } from '../../components/field-styles';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { QrCode } from '../../components/qr-code';
import { SaveBar } from '../../components/save-bar';
import { useToast } from '../../components/toast';
import { SecondaryBadge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { cardPadded, cardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { ChoiceChips } from '../../components/ui/segmented';
import { useLocale } from '../../i18n';
import { api, type Me, meQuery, unwrap } from '../../lib/api';
import { AuthError, auth, totpSecret } from '../../lib/auth';
import { formatDateTime } from '../../lib/dates';
import { describeDevice } from '../../lib/device';
import { errorMessage } from '../../lib/errors';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/_shell/account')({ component: Page });

function Page() {
  const { t } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  return (
    <div className="flex w-full max-w-[760px] flex-col gap-3 md:gap-4">
      <PageHeader className="mb-0" title={t('account.title')} description={t('account.intro')} />
      <Profile me={me} />
      <TwoFactor me={me} />
      <Sessions />
      {me.activeStore && <Alerts />}
    </div>
  );
}

function Section({
  id,
  title,
  gap = 'gap-4 md:gap-4',
  children,
}: {
  id?: string;
  title: string;
  gap?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id ?? title}-h`}
      className={cn(cardPadded, 'scroll-mt-20', gap)}
    >
      <h2 id={`${id ?? title}-h`} className={cardTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Profile({ me }: { me: Me }) {
  const { t, setLocale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.user.name);
  const [locale, setChoice] = useState<Locale>(me.user.locale);
  const dirty = name !== me.user.name || locale !== me.user.locale;
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await api.PATCH('/v1/admin/me', { body: { name: name.trim(), locale } })),
    onSuccess: async () => {
      setLocale(locale);
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      toast(t('account.saved'));
    },
  });
  return (
    <Section title={t('account.profile')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label={t('account.name')}
          name="name"
          autoComplete="name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            save.reset();
          }}
        />
        <div className="flex flex-col">
          <label htmlFor="account-email" className={fieldLabel}>
            {t('account.email')}
          </label>
          <span className="relative block">
            <Mail
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input id="account-email" readOnly value={me.user.email} className="bg-muted pl-9" />
          </span>
        </div>
        <div className="flex flex-col">
          <span className={fieldLabel}>{t('account.language')}</span>
          <ChoiceChips
            label={t('account.language')}
            value={locale}
            options={[
              { value: 'bn', label: 'বাংলা' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(value) => {
              setChoice(value);
              save.reset();
            }}
          />
        </div>
        {save.isError && <Notice tone="error">{errorMessage(save.error, t)}</Notice>}
        <SaveBar
          show={dirty}
          message={t('form.unsaved')}
          discardLabel={t('action.discard')}
          onDiscard={() => {
            setName(me.user.name);
            setChoice(me.user.locale);
          }}
          saveLabel={t('action.save')}
          busy={save.isPending}
          saveDisabled={name.trim() === ''}
          onSave={() => save.mutate()}
        />
      </form>
    </Section>
  );
}

type TwoFactorState =
  | { step: 'idle' }
  | { step: 'enrol'; totpURI: string; backupCodes: string[] }
  | { step: 'codes'; backupCodes: string[]; enabled?: boolean }
  | { step: 'confirm-disable' }
  | { step: 'confirm-new-codes' };

function TwoFactor({ me }: { me: Me }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TwoFactorState>({ step: 'idle' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const enabled = me.user.twoFactorEnabled;
  const platform = Boolean(me.user.platformRole);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (err) {
      setError(
        err instanceof AuthError && err.code === 'INVALID_CODE'
          ? t('twoFactor.invalid')
          : errorMessage(err, t),
      );
    } finally {
      setBusy(false);
    }
  }
  // Turning two-factor login on or off signs out the other sessions.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: meQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    ]);

  const start = () =>
    run(async () => {
      const { totpURI, backupCodes } = await auth.enableTwoFactor();
      setCode('');
      setState({ step: 'enrol', totpURI, backupCodes });
    });
  const confirm = (e: FormEvent, backupCodes: string[]) => {
    e.preventDefault();
    return run(async () => {
      await auth.verifyTotp(code);
      await refresh();
      setState({ step: 'codes', backupCodes, enabled: true });
    });
  };

  return (
    <Section id="two-factor" title={t('account.twoFactor')} gap="gap-3.5 md:gap-3.5">
      {state.step === 'enrol' ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => confirm(e, state.backupCodes)}>
          <p>{t('account.twoFactor.scan')}</p>
          <QrCode value={state.totpURI} label={t('account.twoFactor.qr')} />
          <p className="text-sm text-muted-foreground">
            {t('account.twoFactor.manual')}{' '}
            <code className="select-all font-mono text-foreground">
              {totpSecret(state.totpURI)}
            </code>
          </p>
          <Field
            label={t('twoFactor.code')}
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="max-w-48 text-center text-xl tracking-[0.4em]"
          />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>
              {t('account.twoFactor.enable')}
            </Button>
            <Button variant="ghost" onClick={() => setState({ step: 'idle' })}>
              {t('action.cancel')}
            </Button>
          </div>
        </form>
      ) : state.step === 'codes' ? (
        <BackupCodes
          codes={state.backupCodes}
          enabled={state.enabled === true}
          onDone={() => setState({ step: 'idle' })}
        />
      ) : (
        <>
          {enabled ? (
            <div className="flex gap-2.5">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success-foreground" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{t('account.twoFactor.onTitle')}</span>
                <span className="text-[13px] text-muted-foreground">
                  {t('account.twoFactor.onHint')}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">{t('account.twoFactor.off')}</p>
          )}
          {platform && (
            <p className="text-[13px] text-muted-foreground">{t('account.twoFactor.required')}</p>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          {!enabled ? (
            <Button className="self-start" disabled={busy} onClick={start}>
              <Lock aria-hidden />
              {t('account.twoFactor.setUp')}
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setState({ step: 'confirm-new-codes' })}>
                {t('account.backupCodes.new')}
              </Button>
              {/* Platform staff can't go without it (§5.3). */}
              {!platform && (
                <Button
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  onClick={() => setState({ step: 'confirm-disable' })}
                >
                  {t('account.twoFactor.disable')}
                </Button>
              )}
            </div>
          )}
          <ConfirmDialog
            open={state.step === 'confirm-disable' || state.step === 'confirm-new-codes'}
            onOpenChange={(o) => !o && setState({ step: 'idle' })}
            title={t(
              state.step === 'confirm-disable'
                ? 'account.twoFactor.disableConfirm'
                : 'account.backupCodes.newConfirm',
            )}
            confirmLabel={t(
              state.step === 'confirm-disable'
                ? 'account.twoFactor.disable'
                : 'account.backupCodes.new',
            )}
            destructive={state.step === 'confirm-disable'}
            busy={busy}
            error={error}
            onConfirm={() =>
              run(async () => {
                if (state.step === 'confirm-disable') {
                  await auth.disableTwoFactor();
                  await refresh();
                  setState({ step: 'idle' });
                } else {
                  const { backupCodes } = await auth.newBackupCodes();
                  setState({ step: 'codes', backupCodes });
                }
              })
            }
          />
        </>
      )}
    </Section>
  );
}

function BackupCodes({
  codes,
  enabled,
  onDone,
}: {
  codes: string[];
  enabled: boolean;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {enabled && <Notice>{t('account.twoFactor.enabled')}</Notice>}
      <h3 className="font-semibold">{t('account.backupCodes')}</h3>
      <p>{t('account.backupCodes.intro')}</p>
      <ul className="grid grid-cols-2 gap-2 font-mono sm:grid-cols-3" lang="en">
        {codes.map((c) => (
          <li key={c} className="rounded-md bg-muted px-3 py-2 text-center">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            navigator.clipboard.writeText(codes.join('\n')).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {t('account.backupCodes.copy')}
        </Button>
        <Button onClick={onDone}>{t('account.backupCodes.done')}</Button>
        {copied && (
          <span role="status" className="text-sm text-muted-foreground">
            {t('account.backupCodes.copied')}
          </span>
        )}
      </div>
    </div>
  );
}

function Sessions() {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const [list, current] = await Promise.all([auth.listSessions(), auth.session()]);
      return { list, currentId: current?.session.id };
    },
  });
  const revoke = useMutation({
    mutationFn: (token?: string) =>
      token ? auth.revokeSession(token) : auth.revokeOtherSessions(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  return (
    <Section title={t('account.sessions')} gap="gap-2 md:gap-2">
      {sessions.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : sessions.isError ? (
        <Notice tone="error">{errorMessage(sessions.error, t)}</Notice>
      ) : (
        <>
          <ul className="-mx-4 md:-mx-5">
            {sessions.data.list.map((s) => {
              const current = s.id === sessions.data.currentId;
              const phone = /Mobile|Android|iPhone/i.test(s.userAgent ?? '');
              const Icon = phone ? Smartphone : Monitor;
              return (
                <li
                  key={s.id}
                  className="flex min-h-14 items-center gap-3 border-t border-border py-1.5 pr-3 pl-4 md:pl-5"
                >
                  <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">
                        {describeDevice(s.userAgent) ?? t('account.sessions.unknown')}
                      </span>
                      {current && <SecondaryBadge>{t('account.sessions.current')}</SecondaryBadge>}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      {t('account.sessions.since', {
                        date: formatDateTime(locale, new Date(s.createdAt)),
                      })}
                    </span>
                  </span>
                  {!current && (
                    <Button
                      variant="ghost"
                      className="h-8 md:h-8"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(s.token)}
                    >
                      {t('action.signOut')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {revoke.isError && <Notice tone="error">{errorMessage(revoke.error, t)}</Notice>}
          {sessions.data.list.length > 1 && (
            <Button
              variant="secondary"
              className="self-start"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(undefined)}
            >
              {t('account.sessions.revokeOthers')}
            </Button>
          )}
        </>
      )}
    </Section>
  );
}
