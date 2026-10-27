// The title row of a page, with its main action on the right.
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocale } from '../i18n';
import { cn } from '../lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  className,
  parent,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
  /** For pages that space their sections themselves, `mb-0`. */
  className?: string;
  /** The page this one sits under, as a breadcrumb above the title. */
  parent?: {
    to:
      | '/settings'
      | '/online-store'
      | '/products'
      | '/customers'
      | '/orders'
      | '/reports'
      | '/inventory/purchase-orders'
      | '/inventory/suppliers'
      | '/inventory/counts';
    label: string;
  };
}) {
  const { t } = useLocale();
  return (
    <div className={cn('mb-6 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex flex-col gap-1">
        {parent && (
          <nav aria-label={t('nav.breadcrumb')} className="mb-1 flex items-center gap-1.5 text-sm">
            <Link to={parent.to} className="font-medium text-primary hover:underline">
              {parent.label}
            </Link>
            <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">{title}</span>
          </nav>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
