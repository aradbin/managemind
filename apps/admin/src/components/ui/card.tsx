// Cards (ADR 0033 and 0034, the canvas's .mm-card): bordered surfaces with
// 14 px corners and 20 px padding on desktops, 12 px corners and 16 px on
// phones. A card with a title is a labelled section, so screen readers can
// jump between them.
import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../../lib/utils';

/** The card surface without padding (tables and lists run to its edges). */
export const cardFrame = 'rounded-xl border border-border bg-card max-md:rounded-[12px]';

/** The padded card: a column with 16 px (20 px on desktops) inside and between. */
export const cardPadded = cn(cardFrame, 'flex flex-col gap-4 p-4 md:gap-5 md:p-5');

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(cardFrame, className)} {...props} />;
}

/** A card title as the canvas draws it: 16 px over 20 px, semibold. */
export const cardTitle = 'text-base leading-5 font-semibold';

/** A card with a heading and, on the right, an optional action (often a ghost button). */
export function CardSection({
  title,
  description,
  action,
  className,
  padded = true,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
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
      className={cn(
        cardFrame,
        'flex flex-col gap-4 md:gap-5',
        padded ? 'p-4 md:p-5' : 'pt-4 md:pt-5',
        className,
      )}
    >
      <div className={cn('flex flex-col gap-1.5', !padded && 'px-4 md:px-5')}>
        <div className="flex min-h-5 items-center justify-between gap-3">
          <h2 id={id} className={cardTitle}>
            {title}
          </h2>
          {action && <div className="-my-1 -mr-2 flex items-center gap-1">{action}</div>}
        </div>
        {description && (
          <p className="text-[13px] leading-[18px] text-muted-foreground">{description}</p>
        )}
      </div>
      {padded ? children : <div className="-mb-px">{children}</div>}
    </section>
  );
}
