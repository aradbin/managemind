// The title row of a page as the canvas draws it (ADR 0033 and 0034): a back
// arrow when the page sits under another, the title (20 px), its status
// badges, and the actions on the right; a muted line under it if needed.
import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowLeft, Shield } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useLocale } from '../i18n';
import { useRecordPage } from '../lib/crumb';
import { cn } from '../lib/utils';
import { PhoneRecordHeader } from './record-header';
import { useInSettingsFrame } from './settings-frame';

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
      | '/expenses'
      | '/platform';
    label: string;
  };
}) {
  // In a settings page's frame the list beside it leads back, and on phones
  // the frame's own header carries the title (ADR 0034).
  const { t } = useLocale();
  const framed = useInSettingsFrame();
  // Platform pages are marked as such before their title.
  const platform = useRouterState({
    select: (s) => s.location.pathname.startsWith('/platform'),
  });
  // A platform page of its own (not a record under one) has the phone
  // header of the boards: back to Menu, its name and the Platform mark.
  const platformTop = platform && !parent;
  useRecordPage(title, { enabled: platformTop });
  return (
    <>
      {platformTop && (
        <PhoneRecordHeader to="/more" backLabel={t('nav.backToMenu')} title={title}>
          <span className="mr-2">
            <PlatformBadge />
          </span>
        </PhoneRecordHeader>
      )}
      <div
        className={cn(
          'flex flex-col gap-1',
          !framed && 'mb-4',
          // Phones: the frame's header has the title, so the line comes first.
          framed && 'max-md:flex-col-reverse max-md:gap-3',
          className,
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          {parent && !framed && <BackLink to={parent.to} label={parent.label} />}
          {platform && (
            <span className={cn(platformTop && 'max-md:hidden')}>
              <PlatformBadge />
            </span>
          )}
          <h1
            className={cn(
              'min-w-0 truncate text-xl leading-7 font-semibold tracking-[-0.01em]',
              (framed || platformTop) && 'max-md:hidden',
            )}
          >
            {title}
          </h1>
          {badges && <span className="flex flex-wrap gap-1.5">{badges}</span>}
          {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
        </div>
        {description && (
          <p
            className={cn('text-muted-foreground', (framed || platformTop) && 'max-md:text-[13px]')}
          >
            {description}
          </p>
        )}
      </div>
    </>
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

/** The dark "Platform" mark (.mm-plat) before a platform page's title. */
export function PlatformBadge() {
  const { t } = useLocale();
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-[5px] rounded-md bg-foreground px-[7px] text-[11px] leading-5 font-semibold tracking-[.04em] whitespace-nowrap text-background uppercase">
      <Shield aria-hidden className="size-3" />
      {t('nav.platform')}
    </span>
  );
}
