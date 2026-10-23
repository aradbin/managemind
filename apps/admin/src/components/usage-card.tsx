// Plan limits on the dashboard (phase-5b-plan §3.6, §7): each limit the store
// is near (80%) or at, for those who see billing, linked to the billing page.
// Nothing shows while every limit is comfortable.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/billing';
import { billingQuery } from '../lib/billing';
import { usePermission } from './permission-gate';

export function UsageCard() {
  const { t } = useLocale();
  const canRead = usePermission('billing.read');
  const billing = useQuery({ ...billingQuery, enabled: canRead });
  const near = (billing.data?.meters ?? []).filter((m) => m.level !== 'ok' && m.limit !== null);
  if (!near.length) return null;
  return (
    <section
      aria-labelledby="usage-card-h"
      className="flex flex-col gap-2 rounded-md border border-danger/40 p-4"
    >
      <h2 id="usage-card-h" className="font-semibold">
        {t('usage.title')}
      </h2>
      <ul className="flex flex-col gap-1">
        {near.map((m) => (
          <li key={m.name} className={m.level === 'over' ? 'font-medium text-danger' : ''}>
            {t(m.level === 'over' ? 'usage.over' : 'usage.warn', {
              name: t(`meter.${m.name}` as AdminKey),
              used: m.used,
              limit: m.limit ?? 0,
            })}
          </li>
        ))}
      </ul>
      <Link to="/settings/billing" className="text-primary underline-offset-2 hover:underline">
        {t('usage.link')}
      </Link>
    </section>
  );
}
