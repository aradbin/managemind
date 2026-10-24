// "Parent › This page" above a page's title (ADR 0029), in place of the old
// back links, so every screen shows where it sits the same way.
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useLocale } from '../i18n';

/** The list pages a detail page can sit under. */
type Parent =
  | '/orders'
  | '/returns'
  | '/promotions'
  | '/customers'
  | '/catalog/collections'
  | '/online-store/pages'
  | '/platform';

export function Breadcrumb({
  to,
  label,
  current,
}: {
  to: Parent;
  label: string;
  current?: string | undefined;
}) {
  const { t } = useLocale();
  return (
    <nav aria-label={t('nav.breadcrumb')} className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link to={to} className="shrink-0 font-medium text-primary hover:underline">
        {label}
      </Link>
      {current && (
        <>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-muted-foreground">{current}</span>
        </>
      )}
    </nav>
  );
}
