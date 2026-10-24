import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useLocale } from '../../i18n';
import { meQuery } from '../../lib/api';
import { DashboardView } from '../../pages/dashboard';

export const Route = createFileRoute('/_shell/')({ component: Page });

function Page() {
  const { t } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  if (me.stores.length === 0 && !me.user.platformRole) {
    return (
      <>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">{t('home.noStore.title')}</h1>
        <p className="text-muted-foreground">{t('home.noStore.body')}</p>
      </>
    );
  }
  // The dashboard has its own heading: a greeting.
  if (me.activeStore) return <DashboardView />;
  return <h1 className="text-2xl font-semibold tracking-tight">{t('home.title')}</h1>;
}
