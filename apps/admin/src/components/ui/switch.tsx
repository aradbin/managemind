// A setting that's on or off (ADR 0033, design rule 3): a checkbox drawn as
// the canvas's .mm-switch (32 × 18, a 16 px knob), so it keeps the checkbox's keyboard and form behaviour.
import { type ComponentProps, type ReactNode, useId } from 'react';
import { cn } from '../../lib/utils';

/** The switch's look, for a checkbox that keeps its checkbox role. */
export const switchLook =
  'mm-switch relative h-[18px] w-8 shrink-0 cursor-pointer appearance-none rounded-full bg-input shadow-xs transition-colors duration-150 before:absolute before:top-px before:left-px before:size-4 before:rounded-full before:bg-background before:transition-transform before:duration-150 checked:bg-primary checked:before:translate-x-3.5 disabled:cursor-not-allowed disabled:opacity-50 dark:before:bg-foreground dark:checked:before:bg-primary-foreground';

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

/**
 * A setting's row, as drawn (.mm-swrow): its name and a line under it on the
 * left, the switch on the right. The whole row's text is the switch's label.
 */
export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  disabled?: boolean | undefined;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      className={cn('flex justify-between gap-4', hint ? 'items-start' : 'items-center', className)}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer font-medium">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(hint && 'mt-0.5')}
        {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
      />
    </div>
  );
}
