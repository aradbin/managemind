// Choices as the canvas draws them (ADR 0034), each a real radio input
// underneath, so forms, keyboards and tests treat them as radios:
// - RadioCard (.mm-mode): a bordered row with a radio, a label and a
//   second line, such as "Cash on delivery" and "Paid already";
// - ButtonChoices (.mm-paygrid/.mm-paybtn): a grid of buttons, the chosen
//   one filled, such as how a payment was made;
// - MoneyInput (.mm-affix): an amount with ৳ inside the box.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Input } from './input';

export function RadioCard({
  name,
  checked,
  onChange,
  label,
  hint,
  className,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-input bg-background px-2.5 py-2 text-sm leading-[18px] md:min-h-10 md:text-[13px]',
        'has-[:checked]:border-primary has-[:checked]:bg-muted/60 has-[:checked]:font-medium',
        'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="focus-visible:shadow-none"
      />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {hint && (
          <span className="text-xs leading-4 font-normal text-muted-foreground">{hint}</span>
        )}
      </span>
    </label>
  );
}

export function ButtonChoices<T extends string>({
  name,
  label,
  labelId,
  value,
  options,
  onChange,
}: {
  name: string;
  /** Names the group when no visible label does. */
  label?: string;
  labelId?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelId}
      className="grid grid-cols-3 gap-1.5"
    >
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'relative flex h-10 cursor-pointer items-center justify-center rounded-lg border border-input bg-background px-2 text-sm font-medium md:h-9',
            'has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground',
            'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
          )}
        >
          <input
            type="radio"
            name={name}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
            // Over the whole button, unseen: a tap on it is a tap on the radio.
            className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-lg border-0 bg-transparent opacity-0"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function MoneyInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <span className="relative block min-w-0">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
      >
        ৳
      </span>
      <Input inputMode="decimal" className={cn('pl-7 tabular-nums', className)} {...props} />
    </span>
  );
}
