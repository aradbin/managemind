// The title row of a page as the canvas draws it (ADR 0033 and 0034): a back
// arrow when the page sits under another, the title (20 px), its status
// badges, and the actions on the right; a muted line under it if needed.
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useLocale } from '../i18n';
import { cn } from '../lib/utils';

export function PageHeader({
  title,
  description,
  badges,
  actions,
  className,
  parent,
}: {
  title: string;
  description?: ReactNode;
  /** Status badges right after the title. */
  badges?: ReactNode;
  actions?: ReactNode;
  /** For pages that space their sections themselves, `mb-0`. */
  className?: string;
  /** The page this one sits under: a ghost arrow back to it, before the title. */
  parent?: {
    to:
      | '/settings'
      | '/online-store'
      | '/online-store/pages'
      | '/products'
      | '/customers'
      | '/orders'
      | '/orders/incomplete'
      | '/returns'
      | '/reports'
      | '/inventory'
      | '/inventory/purchase-orders'
      | '/inventory/suppliers'
      | '/inventory/counts'
      | '/catalog/collections'
      | '/promotions'
      | '/platform';
    label: string;
  };
}) {
  return (
    <div className={cn('mb-4 flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-3">
        {parent && <BackLink to={parent.to} label={parent.label} />}
        <h1 className="min-w-0 truncate text-xl leading-7 font-semibold tracking-[-0.01em]">
          {title}
        </h1>
        {badges && <span className="flex flex-wrap gap-1.5">{badges}</span>}
        {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

/** A ghost arrow back to the page this one sits under, named by it. */
export function BackLink({
  to,
  params,
  label,
}: {
  to: NonNullable<ComponentProps<typeof Link>['to']>;
  /** The route's params, such as { id }. */
  params?: Record<string, string>;
  label: string;
}) {
  const { t } = useLocale();
  return (
    <nav aria-label={t('nav.breadcrumb')} className="-ml-2 shrink-0">
      <Link
        to={to}
        {...(params ? { params: params as never } : {})}
        aria-label={label}
        title={label}
        className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-accent md:size-8"
      >
        <ArrowLeft aria-hidden className="size-4" />
      </Link>
    </nav>
  );
}
