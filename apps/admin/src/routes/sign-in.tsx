// Placeholder: sign in with an email code, the two-factor challenge and
// accepting invitations arrive in PR 14.
import { createFileRoute } from '@tanstack/react-router';
import { LanguageSwitch } from '../components/language-switch';
import { useLocale } from '../i18n';

export const Route = createFileRoute('/sign-in')({ component: SignIn });

function SignIn() {
  const { t } = useLocale();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      <h1 className="text-2xl font-semibold">{t('signIn.title')}</h1>
      <p className="text-muted-foreground">{t('signIn.placeholder')}</p>
    </main>
  );
}
