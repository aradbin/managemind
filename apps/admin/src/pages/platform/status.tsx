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
        'inline-flex h-[22px] items-center whitespace-nowrap rounded-md px-2 text-xs font-medium',
        status === 'active'
          ? 'bg-success-soft text-success'
          : status === 'suspended'
            ? 'bg-warning text-warning-foreground'
            : 'border border-border text-muted-foreground',
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}
