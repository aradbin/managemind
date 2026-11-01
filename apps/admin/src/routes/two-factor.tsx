// The two-factor challenge after a correct email code (phase-1-plan §3.4):
// an authenticator code or a backup code, and "trust this device".
import { createFileRoute, Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { AuthLayout } from '../components/auth-layout';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import { AuthError, auth, safeRedirect } from '../lib/auth';
import { errorMessage } from '../lib/errors';
import { useFinishSignIn } from '../lib/sign-in';

export const Route = createFileRoute('/two-factor')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const to = safeRedirect(search.redirect);
    return to ? { redirect: to } : {};
  },
  component: TwoFactor,
});

function TwoFactor() {
  const { t } = useLocale();
  const { redirect: to } = Route.useSearch();
  const finish = useFinishSignIn();
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [expired, setExpired] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (backup) await auth.verifyBackupCode(code.trim(), trust);
      else await auth.verifyTotp(code, trust);
      await finish(to);
    } catch (err) {
      setBusy(false);
      if (err instanceof AuthError && err.code === 'INVALID_TWO_FACTOR_COOKIE') setExpired(true);
      else if (err instanceof AuthError && (err.status === 401 || err.status === 400)) {
        setError(t('twoFactor.invalid'));
      } else setError(errorMessage(err, t));
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold tracking-tight">{t('twoFactor.title')}</h1>
      {expired ? (
        <>
          <Notice tone="error">{t('twoFactor.expired')}</Notice>
          <Button asChild>
            <Link to="/sign-in" search={to ? { redirect: to } : {}}>
              {t('signIn.title')}
            </Link>
          </Button>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-muted-foreground">
            {t(backup ? 'twoFactor.backupIntro' : 'twoFactor.intro')}
          </p>
          {backup ? (
            <Field
              key="backup"
              label={t('twoFactor.backupCode')}
              name="backup-code"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={40}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          ) : (
            <Field
              key="totp"
              label={t('twoFactor.code')}
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center text-2xl tracking-[0.5em]"
            />
          )}
          <label className="flex min-h-10 items-center gap-3 md:min-h-9">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={trust}
              onChange={(e) => setTrust(e.target.checked)}
            />
            {t('twoFactor.trust')}
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy || code.trim() === ''}>
            {t('twoFactor.submit')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setBackup(!backup);
              setCode('');
              setError(undefined);
            }}
          >
            {t(backup ? 'twoFactor.useApp' : 'twoFactor.useBackup')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
