// A setting that's on or off (ADR 0033, design rule 3): a checkbox drawn as
// a switch, so it keeps the checkbox's keyboard and form behaviour.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** The switch's look, for a checkbox that keeps its checkbox role. */
export const switchLook =
  'relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-background before:shadow-sm before:transition-transform checked:bg-primary checked:before:translate-x-4 disabled:cursor-not-allowed disabled:opacity-50';

export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'role' | 'onChange'> & {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-checked={checked}
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
      className={cn(switchLook, className)}
      {...props}
    />
  );
}
