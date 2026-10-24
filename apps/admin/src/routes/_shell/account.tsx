// Your account (phase-1-plan §5.5, §7.3): name and language, two-factor login
// with backup codes, the devices you're signed in on, and this store's
// alerts (phase-5a-plan §3.9).
import { formatDateTime, type Locale } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Alerts } from '../../components/alerts';
import { Field } from '../../components/field';
import { Notice } from '../../components/notice';
import { QrCode } from '../../components/qr-code';
import { Button } from '../../components/ui/button';
import { useLocale } from '../../i18n';
import { api, type Me, meQuery, unwrap } from '../../lib/api';
import { AuthError, auth, totpSecret } from '../../lib/auth';
import { describeDevice } from '../../lib/device';
import { errorMessage } from '../../lib/errors';

export const Route = createFileRoute('/_shell/account')({ component: Page });

function Page() {
  const { t } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">{t('account.title')}</h1>
      <Profile me={me} />
      <TwoFactor me={me} />
      <Sessions />
      {me.activeStore && <Alerts />}
      <SignOut />
    </div>
  );
}

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id ?? title}-h`}
      className="flex scroll-mt-20 flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5"
    >
      <h2 id={`${id ?? title}-h`} className="font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Profile({ me }: { me: Me }) {
  const { t, setLocale } = useLocale();
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.user.name);
  const [locale, setChoice] = useState<Locale>(me.user.locale);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await api.PATCH('/v1/admin/me', { body: { name: name.trim(), locale } })),
    onSuccess: async () => {
      setLocale(locale);
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
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
        <Field label={t('account.email')} value={me.user.email} readOnly disabled />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t('account.language')}</legend>
          {(['bn', 'en'] as const).map((value) => (
            <label key={value} lang={value} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="locale"
                className="size-5"
                checked={locale === value}
                onChange={() => {
                  setChoice(value);
                  save.reset();
                }}
              />
              {value === 'bn' ? 'বাংলা' : 'English'}
            </label>
          ))}
        </fieldset>
        {save.isSuccess && <Notice>{t('account.saved')}</Notice>}
        {save.isError && <Notice tone="error">{errorMessage(save.error, t)}</Notice>}
        <div>
          <Button type="submit" disabled={save.isPending || name.trim() === ''}>
            {t('action.save')}
          </Button>
        </div>
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
    <Section id="two-factor" title={t('account.twoFactor')}>
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
          <p>{t(enabled ? 'account.twoFactor.on' : 'account.twoFactor.off')}</p>
          {platform && (
            <p className="text-sm text-muted-foreground">{t('account.twoFactor.required')}</p>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          {!enabled ? (
            <div>
              <Button disabled={busy} onClick={start}>
                {t('account.twoFactor.setUp')}
              </Button>
            </div>
          ) : state.step === 'confirm-disable' || state.step === 'confirm-new-codes' ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
              <p>
                {t(
                  state.step === 'confirm-disable'
                    ? 'account.twoFactor.disableConfirm'
                    : 'account.backupCodes.newConfirm',
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={state.step === 'confirm-disable' ? 'danger' : 'primary'}
                  disabled={busy}
                  onClick={() =>
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
                >
                  {t('action.confirm')}
                </Button>
                <Button variant="ghost" onClick={() => setState({ step: 'idle' })}>
                  {t('action.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setState({ step: 'confirm-new-codes' })}>
                {t('account.backupCodes.new')}
              </Button>
              {/* Platform staff can't go without it (§5.3). */}
              {!platform && (
                <Button variant="secondary" onClick={() => setState({ step: 'confirm-disable' })}>
                  {t('account.twoFactor.disable')}
                </Button>
              )}
            </div>
          )}
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
    <Section title={t('account.sessions')}>
      {sessions.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : sessions.isError ? (
        <Notice tone="error">{errorMessage(sessions.error, t)}</Notice>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {sessions.data.list.map((s) => {
              const current = s.id === sessions.data.currentId;
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {describeDevice(s.userAgent) ?? t('account.sessions.unknown')}
                      {current && (
                        <span className="ms-2 rounded bg-muted px-2 py-0.5 text-xs">
                          {t('account.sessions.current')}
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t('account.sessions.since', {
                        date: formatDateTime(locale, new Date(s.createdAt)),
                      })}
                    </span>
                  </div>
                  {!current && (
                    <Button
                      variant="secondary"
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
            <div>
              <Button
                variant="secondary"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(undefined)}
              >
                {t('account.sessions.revokeOthers')}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function SignOut() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button
        variant="quiet"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await auth.signOut().catch(() => undefined);
          queryClient.clear();
          await navigate({ to: '/sign-in', replace: true });
        }}
      >
        {t('action.signOut')}
      </Button>
    </div>
  );
}
