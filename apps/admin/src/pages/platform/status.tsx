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
        'inline-flex h-[22px] items-center whitespace-nowrap rounded-lg px-2 text-xs font-medium',
        status === 'active'
          ? 'bg-success-soft text-success-foreground'
          : status === 'suspended'
            ? 'bg-warning text-warning-foreground'
            : 'text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]',
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}
