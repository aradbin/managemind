// The platform area (phase-1-plan §5.3, §7.3): only for platform roles, and
// only once two-factor login is on (the API refuses otherwise, too).
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { Button } from '../../components/ui/button';
import { useLocale } from '../../i18n';
import { meQuery } from '../../lib/api';

export const Route = createFileRoute('/_shell/platform')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me.user.platformRole) throw redirect({ to: '/' });
  },
  component: PlatformLayout,
});

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
  // The sidebar's Platform area and the header's breadcrumb list its pages (ADR 0033).
  return <Outlet />;
}
