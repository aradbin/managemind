// Cards (ADR 0029, ADR 0033): bordered surfaces with 14 px corners on the
// white page. A card with a title is a labelled section, so screen readers
// can jump between them.
import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-xl border border-border bg-card', className)} {...props} />;
}

/** A card with a heading and, on the right, an optional action. */
export function CardSection({
  title,
  action,
  className,
  padded = true,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  /** False for content that runs to the edges, such as a table or a list. */
  padded?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn('rounded-xl border border-border bg-card', className)}
    >
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 pt-1.5 md:min-h-16 md:px-5 md:pt-2">
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {action}
      </div>
      <div className={padded ? 'px-4 pb-4 md:px-5 md:pb-5' : undefined}>{children}</div>
    </section>
  );
}
