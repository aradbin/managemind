// A settings page's frame, as the canvas draws it (ADR 0034, .mm-sgrid):
// on desktops a sticky 200 px list of every settings page, grouped as on the
// Settings page, beside a column of at most 780 px; on phones the page's own
// header with a back arrow to Settings and its name. The breadcrumb ends
// with the page's name ("Settings › Store profile"). PageHeader reads the
// frame so the page's own title isn't repeated on phones and needs no back
// arrow on desktops.
import type { Permission } from '@managemind/shared/permissions';
import { Link, useRouterState } from '@tanstack/react-router';
import { createContext, type ReactNode, useContext } from 'react';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/messages';
import '../i18n/orders';
import { useRecordPage } from '../lib/crumb';
import { cn } from '../lib/utils';
import { usePermissions } from './permission-gate';
import { PhoneRecordHeader } from './record-header';

type Page = { to: string; label: AdminKey; permission: Permission };

const GROUPS: { label: AdminKey; pages: Page[] }[] = [
  {
    label: 'nav.store',
    pages: [
      { to: '/settings/store', label: 'settings.store', permission: 'settings.read' },
      { to: '/settings/domains', label: 'domains.title', permission: 'settings.read' },
      { to: '/settings/staff', label: 'settings.staff', permission: 'staff.read' },
      { to: '/settings/location', label: 'location.title', permission: 'inventory.read' },
    ],
  },
  {
    label: 'settings.selling',
    pages: [
      { to: '/settings/payments', label: 'payments.title', permission: 'settings.credentials' },
      { to: '/settings/delivery', label: 'delivery.title', permission: 'settings.read' },
      { to: '/settings/couriers', label: 'couriers.title', permission: 'orders.read' },
      { to: '/settings/checkout', label: 'checkoutSettings.title', permission: 'settings.read' },
      { to: '/settings/confirmation', label: 'confirmSettings.title', permission: 'settings.read' },
      { to: '/settings/vat', label: 'vat.title', permission: 'settings.read' },
      { to: '/settings/returns', label: 'returnSettings.title', permission: 'settings.read' },
      { to: '/settings/meta', label: 'meta.title', permission: 'settings.read' },
    ],
  },
  {
    label: 'settings.messages',
    pages: [
      { to: '/settings/notifications', label: 'notify.title', permission: 'settings.read' },
      { to: '/settings/templates', label: 'templates.title', permission: 'settings.read' },
      { to: '/settings/messages', label: 'log.title', permission: 'settings.read' },
    ],
  },
  {
    label: 'settings.planAndData',
    pages: [{ to: '/settings/billing', label: 'billing.title', permission: 'billing.read' }],
  },
];

const InFrame = createContext(false);

/** True inside a settings page's frame: its title shows in the frame on phones. */
export const useInSettingsFrame = () => useContext(InFrame);

export function SettingsFrame({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const permissions = usePermissions();
  const groups = GROUPS.map((g) => ({
    ...g,
    pages: g.pages.filter((p) => permissions.has(p.permission)),
  })).filter((g) => g.pages.length > 0);
  const here = GROUPS.flatMap((g) => g.pages).find(
    (p) => path === p.to || path.startsWith(`${p.to}/`),
  );
  const title = here ? t(here.label) : undefined;
  useRecordPage(title);
  return (
    <InFrame.Provider value={true}>
      <PhoneRecordHeader to="/settings" backLabel={t('settings.back')} title={title ?? ''} />
      <div className="flex flex-col gap-4 md:grid md:grid-cols-[200px_minmax(0,780px)] md:items-start md:gap-8">
        <nav
          aria-label={t('settings.title')}
          // Scrolls by itself once its links outgrow the window: the page
          // scrolls in #main, under the 48 px header and the inset's margins.
          className="sticky top-0 flex max-h-[calc(100dvh-5.5rem)] flex-col gap-px overflow-y-auto overscroll-contain pr-1 pb-1 [scrollbar-width:thin] max-md:hidden"
        >
          {groups.map((g, i) => (
            <div key={g.label} className="contents">
              <p
                className={cn(
                  'mb-1 px-2.5 text-xs font-medium text-muted-foreground',
                  i > 0 && 'mt-3.5',
                )}
              >
                {t(g.label)}
              </p>
              {g.pages.map((p) => {
                const current = here?.to === p.to;
                return (
                  <Link
                    key={p.to}
                    to={p.to}
                    aria-current={current ? 'page' : undefined}
                    className="flex h-8 items-center rounded-lg px-2.5 text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                  >
                    {t(p.label)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-3 md:gap-4">{children}</div>
      </div>
    </InFrame.Provider>
  );
}
