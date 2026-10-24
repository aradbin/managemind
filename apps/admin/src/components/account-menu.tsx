// The account menu in the header: who is signed in, the account page,
// the dev mailbox outside production, light or dark, and sign out.
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CircleUser } from 'lucide-react';
import { useLocale } from '../i18n';
import { healthQuery, type Me } from '../lib/api';
import { auth } from '../lib/auth';
import { ThemeMenuItems } from './theme-choice';
import { Button } from './ui/button';

/** Signs out, forgets this account's data, and goes back to sign-in. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await auth.signOut().catch(() => undefined);
    queryClient.clear();
    await navigate({ to: '/sign-in', replace: true });
  };
}

export function AccountMenu({ me }: { me: Me }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const { data: health } = useQuery(healthQuery);
  const item =
    'flex min-h-11 cursor-pointer items-center rounded px-3 outline-none data-[highlighted]:bg-muted';
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('account.menu')}>
          <CircleUser aria-hidden className="size-6" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-56 rounded-lg border border-border bg-background p-1 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="font-medium">{me.user.name}</p>
            <p className="text-sm text-muted-foreground">{me.user.email}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className={item} onSelect={() => navigate({ to: '/account' })}>
            {t('account.title')}
          </Menu.Item>
          {health && health.environment !== 'production' && (
            <Menu.Item className={item} onSelect={() => navigate({ to: '/dev/mailbox' })}>
              {t('dev.mailbox')}
            </Menu.Item>
          )}
          <Menu.Separator className="my-1 h-px bg-border" />
          <ThemeMenuItems item={item} />
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className={item} onSelect={signOut}>
            {t('action.signOut')}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
