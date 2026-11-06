// The canvas's segmented control (.mm-seg) and choice chips (.mm-chipq),
// for picking one of a few options (design rule 3): report ranges, "Show
// by", how often, a language. Each option is a toggle button; the group is
// labelled, and the chosen one is pressed.
import { useId } from 'react';
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
  showLabel,
}: ChoiceProps<T> & {
  /** The label before the control, as reports draw "Show by". */
  showLabel?: boolean;
}) {
  const id = useId();
  const control = (
    <fieldset
      {...(showLabel ? { 'aria-labelledby': id } : { 'aria-label': label })}
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
  if (!showLabel) return control;
  return (
    <div className="flex min-w-0 items-center gap-2 max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none]">
      <span id={id} className="text-[13px] leading-none font-medium whitespace-nowrap">
        {label}
      </span>
      {control}
    </div>
  );
}

export function ChoiceChips<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  showLabel,
}: ChoiceProps<T> & {
  /** The label before the chips, as the delivery log draws "Status". */
  showLabel?: boolean;
}) {
  const id = useId();
  const chips = (
    <fieldset
      {...(showLabel ? { 'aria-labelledby': id } : { 'aria-label': label })}
      className={cn('m-0 flex flex-wrap gap-1.5 border-0 p-0', className)}
    >
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
  if (!showLabel) return chips;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span id={id} className="text-[13px] leading-none font-medium whitespace-nowrap">
        {label}
      </span>
      {chips}
    </div>
  );
}

/** One choice chip: grey, near-black when chosen. */
export const chipClass =
  'inline-flex h-8 items-center rounded-md bg-muted px-3 text-[13px] font-medium text-foreground hover:bg-accent aria-pressed:bg-primary aria-pressed:text-primary-foreground md:h-7 md:px-2.5 md:text-xs';

/** Several choices on at once, as pressed chips (.mm-chipq): reasons, categories. */
export function ToggleChips<T extends string>({
  options,
  value,
  onToggle,
  className,
}: {
  options: readonly Option<T>[];
  value: readonly T[];
  onToggle: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value.includes(o.value)}
          onClick={() => onToggle(o.value)}
          className={chipClass}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
