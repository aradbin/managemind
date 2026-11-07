// The two-factor challenge after a correct email code (phase-1-plan §3.4):
// an authenticator code or a backup code, and "trust this device".
import { createFileRoute, Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { AuthHeading, AuthLayout, otpClass } from '../components/auth-layout';
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
      <AuthHeading title={t('twoFactor.title')}>
        {expired ? undefined : t(backup ? 'twoFactor.backupIntro' : 'twoFactor.intro')}
      </AuthHeading>
      {expired ? (
        <>
          <Notice tone="error">{t('twoFactor.expired')}</Notice>
          <Button asChild className="h-10 w-full md:h-10">
            <Link to="/sign-in" search={to ? { redirect: to } : {}}>
              {t('signIn.title')}
            </Link>
          </Button>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-5">
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
              placeholder="XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-11 text-center font-mono tracking-[.1em] md:h-11"
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
              placeholder="••••••"
              className={otpClass}
            />
          )}
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
            {t('twoFactor.trust')}
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <Button
            type="submit"
            className="h-10 w-full md:h-10"
            disabled={busy || code.trim() === ''}
          >
            {t('twoFactor.submit')}
          </Button>
          <Button
            variant="ghost"
            className="self-center"
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
