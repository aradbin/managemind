// The platform area (phase-1-plan §5.3, §7.3): only for platform roles, and
// only once two-factor login is on (the API refuses otherwise, too).
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { Button } from '../../components/ui/button';
import { type AdminKey, useLocale } from '../../i18n';
import { meQuery } from '../../lib/api';

export const Route = createFileRoute('/_shell/platform')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me.user.platformRole) throw redirect({ to: '/' });
  },
  component: PlatformLayout,
});

const TABS: {
  to:
    | '/platform'
    | '/platform/dashboard'
    | '/platform/terms'
    | '/platform/staff'
    | '/platform/audit';
  label: AdminKey;
  superAdmin: boolean;
}[] = [
  { to: '/platform', label: 'platform.tenants', superAdmin: false },
  { to: '/platform/dashboard', label: 'platform.dashboard', superAdmin: false },
  { to: '/platform/terms', label: 'platform.terms', superAdmin: false },
  { to: '/platform/staff', label: 'platform.staff', superAdmin: true },
  { to: '/platform/audit', label: 'platform.audit', superAdmin: true },
];

function PlatformLayout() {
  const { t } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  if (!me.user.twoFactorEnabled) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <PageHeader title={t('platform.title')} />
        <Notice>{t('platform.twoFactorRequired')}</Notice>
        <div>
          <Button asChild>
            <Link to="/account" hash="two-factor">
              {t('action.setUpNow')}
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  const tabs = TABS.filter((tab) => !tab.superAdmin || me.user.platformRole === 'super_admin');
  return (
    <div className="flex flex-col gap-4">
      {tabs.length > 1 && (
        <nav
          aria-label={t('platform.sections')}
          className="-mx-1 flex gap-1 overflow-x-auto border-b border-border"
        >
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: tab.to === '/platform', includeSearch: false }}
              className="flex min-h-11 shrink-0 items-center border-b-2 border-transparent px-3 text-sm"
              activeProps={{
                'aria-current': 'page',
                className: 'border-primary font-semibold text-primary',
              }}
            >
              {t(tab.label)}
            </Link>
          ))}
        </nav>
      )}
      <Outlet />
    </div>
  );
}
