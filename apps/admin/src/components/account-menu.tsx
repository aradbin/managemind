// The account menu in the header: who is signed in, the account page and
// sign out.
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CircleUser } from 'lucide-react';
import { useLocale } from '../i18n';
import type { Me } from '../lib/api';
import { auth } from '../lib/auth';
import { Button } from './ui/button';

export function AccountMenu({ me }: { me: Me }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
          className="z-50 min-w-56 rounded-md border border-border bg-background p-1 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="font-medium">{me.user.name}</p>
            <p className="text-sm text-muted-foreground">{me.user.email}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className={item} onSelect={() => navigate({ to: '/account' })}>
            {t('account.title')}
          </Menu.Item>
          <Menu.Item
            className={item}
            onSelect={async () => {
              await auth.signOut().catch(() => undefined);
              queryClient.clear();
              await navigate({ to: '/sign-in', replace: true });
            }}
          >
            {t('action.signOut')}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
