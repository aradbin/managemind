// Plan limits on the dashboard (phase-5b-plan §3.6, §7): each limit the store
// is near (80%) or at, for those who see billing, linked to the billing page.
// Nothing shows while every limit is comfortable. Drawn as the canvas's
// .mm-banner (ADR 0034): amber while near, red once a limit is reached.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/billing';
import { billingQuery } from '../lib/billing';
import { cn } from '../lib/utils';
import { usePermission } from './permission-gate';

export function UsageCard() {
  const { t } = useLocale();
  const canRead = usePermission('billing.read');
  const billing = useQuery({ ...billingQuery, enabled: canRead });
  const near = (billing.data?.meters ?? []).filter((m) => m.level !== 'ok' && m.limit !== null);
  if (!near.length) return null;
  const over = near.some((m) => m.level === 'over');
  return (
    <div
      role="note"
      className={cn(
        'flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3',
        over
          ? 'border-[color-mix(in_oklch,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-destructive)_5%,transparent)]'
          : 'border-[color-mix(in_oklch,var(--tone-warn)_35%,transparent)] bg-[color-mix(in_oklch,var(--tone-warn)_7%,transparent)]',
      )}
    >
      <CircleAlert
        aria-hidden
        className={cn('mt-0.5 size-4 shrink-0', over ? 'text-danger' : 'text-[var(--tone-warn)]')}
      />
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-[200px] flex-1">
          <span className="font-semibold">{t('usage.lead')}</span>{' '}
          {near
            .map((m) =>
              t(m.level === 'over' ? 'usage.over' : 'usage.warn', {
                name: t(`meter.${m.name}` as AdminKey),
                used: m.used,
                limit: m.limit ?? 0,
              }),
            )
            .join(' ')}
        </p>
        <Link to="/settings/billing" className="font-medium underline underline-offset-[3px]">
          {t('usage.link')}
        </Link>
      </div>
    </div>
  );
}
