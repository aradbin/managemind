// A store's lifecycle status as a coloured label (text, not colour alone).
import { useLocale } from '../../i18n';
import { cn } from '../../lib/utils';

export const TENANT_STATUSES = ['active', 'suspended', 'closed', 'purged'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export function StatusBadge({ status }: { status: TenantStatus }) {
  const { t } = useLocale();
  return (
    <span
      className={cn(
        'inline-block rounded px-2 py-0.5 text-xs font-medium',
        status === 'active' ? 'bg-muted' : 'bg-warning text-warning-foreground',
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}
