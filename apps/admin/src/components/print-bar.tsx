// The bar over a printable page, as the canvas draws it (.mm-printbar, ADR
// 0034): back, the title, the page's choices, and its actions on the right.
// It isn't printed.
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

export function PrintBar({
  back,
  title,
  children,
  actions,
}: {
  back: {
    to: NonNullable<ComponentProps<typeof Link>['to']>;
    params?: Record<string, string>;
    label: string;
  };
  title: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label={typeof title === 'string' ? title : undefined}
      className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3 md:px-6"
    >
      <Link
        to={back.to}
        {...(back.params ? { params: back.params as never } : {})}
        aria-label={back.label}
        title={back.label}
        className="-ml-2 inline-flex size-9 items-center justify-center rounded-lg hover:bg-accent md:size-8"
      >
        <ArrowLeft aria-hidden className="size-4" />
      </Link>
      <span className="font-semibold">{title}</span>
      {children}
      <span className="flex-1" />
      {actions}
    </div>
  );
}

/** One A4 sheet on the grey page (.mm-paper): white, 794 px, its own shadow. */
export const paperClass =
  'print-page w-[794px] max-w-full bg-white px-6 py-8 text-[13px] leading-[19px] text-black shadow-[0_2px_12px_rgb(0_0_0/.12)] md:px-14 md:py-12 print:w-full print:p-0 print:shadow-none';

/** The grey page the sheets sit on (white when printed). */
export const deskClass =
  'flex flex-col items-center gap-6 bg-muted p-4 md:p-6 print:block print:bg-white print:p-0';
