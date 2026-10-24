// Cards (ADR 0029): the white surfaces every screen is laid out in, on the
// grey canvas. A card with a title is a labelled section, so screen readers
// can jump between them.
import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('rounded-xl border border-border bg-background', className)} {...props} />
  );
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
      className={cn('rounded-xl border border-border bg-background', className)}
    >
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 pt-2 md:px-5">
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {action}
      </div>
      <div className={padded ? 'px-4 pb-4 md:px-5 md:pb-5' : undefined}>{children}</div>
    </section>
  );
}
