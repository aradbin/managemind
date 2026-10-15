// Accept an invitation (phase-1-plan §5.6): sign in with an email code first,
// which proves the mailbox, then post the token from the link.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { LanguageSwitch } from '../components/language-switch';
import { Notice } from '../components/notice';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import { ApiError, api, meQuery, unwrap } from '../lib/api';
import { auth } from '../lib/auth';
import { errorMessage } from '../lib/errors';
import { captureInviteToken, forgetInviteToken, inviteToken } from '../lib/invite';

export const Route = createFileRoute('/invite')({
  beforeLoad: async ({ context }) => {
    captureInviteToken();
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        throw redirect({ to: '/sign-in', search: { redirect: '/invite' } });
      }
      throw e;
    }
  },
  component: Invite,
});

function Invite() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = inviteToken();
  const accept = useMutation({
    mutationFn: async (value: string) =>
      unwrap(await api.POST('/v1/admin/invitations/accept', { body: { token: value } })),
    onSuccess: async (me) => {
      forgetInviteToken();
      queryClient.setQueryData(meQuery.queryKey, me);
      await navigate({ to: '/', replace: true });
    },
  });
  const started = useRef(false);
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    accept.mutate(token);
  }, [token, accept]);

  async function signOut() {
    await auth.signOut().catch(() => undefined);
    queryClient.clear();
    await navigate({ to: '/sign-in', search: { redirect: '/invite' } });
  }

  const invalid = accept.error instanceof ApiError && [404, 410, 422].includes(accept.error.status);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4">
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      <h1 className="text-2xl font-semibold">{t('invite.title')}</h1>
      {!token ? (
        <Notice tone="error">{t('invite.missing')}</Notice>
      ) : accept.isError ? (
        <>
          <Notice tone="error">
            {invalid ? t('invite.invalid') : errorMessage(accept.error, t)}
          </Notice>
          {invalid ? (
            <Button variant="secondary" onClick={signOut}>
              {t('action.signOut')}
            </Button>
          ) : (
            <Button onClick={() => accept.mutate(token)}>{t('twoFactor.submit')}</Button>
          )}
        </>
      ) : (
        <p role="status">{t('invite.joining')}</p>
      )}
    </main>
  );
}
