import { createFileRoute } from '@tanstack/react-router';
import { useLocale } from '../../i18n';

export const Route = createFileRoute('/_shell/account')({ component: Page });

function Page() {
  const { t } = useLocale();
  return (
    <>
      <h1 className="mb-2 text-xl font-semibold">{t('account.title')}</h1>
    </>
  );
}
