// The account menu in the header, behind the person's initials (ADR 0033):
// who is signed in, the account page,
// the dev mailbox outside production, light or dark, and sign out.
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useLocale } from '../i18n';
import { healthQuery, type Me } from '../lib/api';
import { auth } from '../lib/auth';
import { initials } from './store-switcher';
import { ThemeMenuItems } from './theme-choice';
import { menuContent, menuItem, menuSeparator } from './ui/menu';

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
  const item = menuItem;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          aria-label={t('account.menu')}
          title={me.user.name}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium hover:bg-border"
        >
          <span aria-hidden>{initials(me.user.name)}</span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className={menuContent}>
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{me.user.name}</p>
            <p className="text-xs text-muted-foreground">{me.user.email}</p>
          </div>
          <Menu.Separator className={menuSeparator} />
          <Menu.Item className={item} onSelect={() => navigate({ to: '/account' })}>
            {t('account.title')}
          </Menu.Item>
          {health && health.environment !== 'production' && (
            <Menu.Item className={item} onSelect={() => navigate({ to: '/dev/mailbox' })}>
              {t('dev.mailbox')}
            </Menu.Item>
          )}
          <Menu.Separator className={menuSeparator} />
          <ThemeMenuItems item={item} />
          <Menu.Separator className={menuSeparator} />
          <Menu.Item className={item} onSelect={signOut}>
            {t('action.signOut')}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
