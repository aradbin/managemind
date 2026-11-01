// The canvas's segmented control (.mm-seg) and choice chips (.mm-chipq),
// for picking one of a few options (design rule 3): report ranges, "Show
// by", how often, a language. Each option is a toggle button; the group is
// labelled, and the chosen one is pressed.
import { cn } from '../../lib/utils';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface ChoiceProps<T extends string> {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: ChoiceProps<T>) {
  return (
    <fieldset
      aria-label={label}
      className={cn(
        'inline-flex h-10 shrink-0 items-center rounded-[10px] bg-muted p-[3px] md:h-9',
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className="h-[34px] whitespace-nowrap rounded-lg border border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm md:h-[30px] md:px-2.5 md:text-[13px] dark:aria-pressed:border-input dark:aria-pressed:bg-input"
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

export function ChoiceChips<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: ChoiceProps<T>) {
  return (
    <fieldset aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={chipClass}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

/** One choice chip: grey, near-black when chosen. */
export const chipClass =
  'inline-flex h-8 items-center rounded-md bg-muted px-3 text-[13px] font-medium text-foreground hover:bg-accent aria-pressed:bg-primary aria-pressed:text-primary-foreground md:h-7 md:px-2.5 md:text-xs';
