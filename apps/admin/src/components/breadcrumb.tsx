// "← Parent" above a record's title (ADR 0029, ADR 0033): the header's
// breadcrumb says where the page sits, this goes back to the list.
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
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
    <nav aria-label={t('nav.breadcrumb')} className="flex min-w-0 items-center text-sm">
      <Link
        to={to}
        className="-ml-2 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {label}
      </Link>
      {current && <span className="sr-only">{current}</span>}
    </nav>
  );
}
