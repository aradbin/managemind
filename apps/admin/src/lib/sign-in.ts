// What every way of signing in ends with: a fresh cache, the user's saved
// language, and the page they were going to.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useLocale } from '../i18n';
import { meQuery } from './api';

export function useFinishSignIn() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setLocale } = useLocale();
  return async (to?: string) => {
    queryClient.clear();
    const me = await queryClient.fetchQuery(meQuery);
    setLocale(me.user.locale);
    await router.navigate({ href: to ?? '/', replace: true });
  };
}
