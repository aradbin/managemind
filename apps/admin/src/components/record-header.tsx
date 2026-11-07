// A record's own header on phones (ADR 0034, the canvas's phone record
// boards): back to the list, the record's name and its actions, in place of
// the store's header. Desktops show the page header instead.
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

export function PhoneRecordHeader({
  to,
  params,
  backLabel,
  title,
  children,
}: {
  to: NonNullable<ComponentProps<typeof Link>['to']>;
  /** The route's params, such as { id }. */
  params?: Record<string, string>;
  backLabel: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 -mx-3 -mt-3 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background px-2 md:hidden">
      <Link
        to={to}
        {...(params ? { params: params as never } : {})}
        aria-label={backLabel}
        title={backLabel}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-accent"
      >
        <ArrowLeft aria-hidden className="size-4" />
      </Link>
      <h1 className="mx-1 min-w-0 flex-1 truncate text-base leading-6 font-semibold">{title}</h1>
      {children}
    </header>
  );
}
