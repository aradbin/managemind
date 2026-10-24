// Sign in with an email code (phase-1-plan §5.5, §7.3): the email first, then
// the 6-digit code. A user with two-factor login goes on to /two-factor.
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthLayout } from '../components/auth-layout';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import { meQuery } from '../lib/api';
import { AuthError, auth, safeRedirect } from '../lib/auth';
import { errorMessage } from '../lib/errors';
import { useFinishSignIn } from '../lib/sign-in';
import { useTurnstile } from '../lib/turnstile';

/** Seconds before "send a new code" works again; the server limits sends too. */
const RESEND_SECONDS = 60;

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const to = safeRedirect(search.redirect);
    return to ? { redirect: to } : {};
  },
  // Already signed in: straight in.
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.fetchQuery(meQuery).catch(() => null);
    if (me) throw redirect({ href: search.redirect ?? '/' });
  },
  component: SignIn,
});

function SignIn() {
  const { t, locale } = useLocale();
  const check = useTurnstile(locale);
  const { redirect: to } = Route.useSearch();
  const router = useRouter();
  const finish = useFinishSignIn();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await auth.sendCode(email.trim(), await check.token());
      setStep('code');
      setCode('');
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(
        err instanceof AuthError && err.code === 'validation_failed'
          ? t('signIn.check')
          : errorMessage(err, t),
      );
    } finally {
      // Tokens are single-use: a fresh one for the next send.
      check.reset();
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await auth.signIn(email.trim(), code);
      if (result.twoFactorRedirect) {
        await router.navigate({ to: '/two-factor', search: to ? { redirect: to } : {} });
      } else {
        await finish(to);
      }
    } catch (err) {
      setBusy(false);
      if (err instanceof AuthError && err.code === 'TOO_MANY_ATTEMPTS') {
        setError(t('signIn.tooManyTries'));
      } else if (err instanceof AuthError && err.status === 400) {
        setError(t('signIn.invalidCode'));
      } else {
        setError(errorMessage(err, t));
      }
    }
  }

  return (
    <AuthLayout step={step === 'email' ? 1 : 2} steps={2}>
      <h1 className="text-2xl font-semibold tracking-tight">{t('signIn.title')}</h1>
      {step === 'email' ? (
        <form onSubmit={send} className="flex flex-col gap-4">
          <p className="text-muted-foreground">{t('signIn.intro')}</p>
          <Field
            label={t('signIn.email')}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy}>
            {t('signIn.send')}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <Notice>{t('signIn.codeSent', { email: email.trim() })}</Notice>
          <Field
            label={t('signIn.code')}
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
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy || code.length !== 6}>
            {t('signIn.submit')}
          </Button>
          <div className="flex flex-col gap-2">
            {wait > 0 ? (
              <p className="text-sm text-muted-foreground" aria-live="off">
                {t('signIn.resendIn', { seconds: wait })}
              </p>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => send()}>
                {t('signIn.resend')}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setStep('email');
                setError(undefined);
              }}
            >
              {t('signIn.changeEmail')}
            </Button>
          </div>
        </form>
      )}
      {/* Outside the forms: a resend from the code step needs a token too. */}
      <div ref={check.box} />
    </AuthLayout>
  );
}
