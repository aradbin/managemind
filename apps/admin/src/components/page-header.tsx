// The title row of a page, with its main action on the right. A page under
// another starts with a back arrow to it (ADR 0033); the header's breadcrumb
// says where the page sits.
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
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
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-2">
        {parent && <BackLink to={parent.to} label={parent.label} />}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** A ghost arrow back to the page this one sits under, named by it. */
export function BackLink({
  to,
  label,
}: {
  to: NonNullable<ComponentProps<typeof Link>['to']>;
  label: string;
}) {
  const { t } = useLocale();
  return (
    <nav aria-label={t('nav.breadcrumb')} className="-ml-1.5 shrink-0">
      <Link
        to={to}
        aria-label={label}
        title={label}
        className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted"
      >
        <ArrowLeft aria-hidden className="size-4" />
      </Link>
    </nav>
  );
}
