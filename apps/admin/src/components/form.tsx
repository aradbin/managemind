// Form fields on react-hook-form with zod schemas (phase-1-plan §7.3): every
// input labelled, errors linked and announced, messages in the user's
// language, and server-side field errors shown on the field they belong to.
import type { FieldError as ApiFieldError } from '@managemind/shared';
import { normalizePhone } from '@managemind/shared/phone';
import { type ComponentProps, type ReactNode, useId } from 'react';
import {
  type FieldError,
  type FieldValues,
  FormProvider,
  type Path,
  type UseFormReturn,
  useFormContext,
} from 'react-hook-form';
import { z } from 'zod';
import { type AdminKey, useLocale } from '../i18n';
import { ApiError } from '../lib/api';
import { cn } from '../lib/utils';
import { Input } from './ui/input';

/** A message key for a field's error; zod's own messages are English-only. */
export function fieldErrorKey(error: FieldError | undefined): AdminKey | undefined {
  if (!error) return;
  if (error.message?.startsWith('form.')) return error.message as AdminKey;
  if (error.type === 'too_small') return 'form.required';
  if (error.type === 'too_big') return 'form.tooLong';
  return 'form.invalid';
}

/** Optional text: empty becomes undefined, so it isn't sent. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v));

export const optionalEmail = () =>
  z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === '' || z.email().safeParse(v).success, 'form.invalidEmail')
    .transform((v) => (v === '' ? undefined : v));

export const optionalPhone = () =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || normalizePhone(v) !== null, 'form.invalidPhone')
    .transform((v) => (v === '' ? undefined : (normalizePhone(v) ?? undefined)));

/**
 * Puts a 422's field errors on the fields (path "profile.contactPhone" ->
 * field "contactPhone" when `map` says so). Returns false when there were none.
 */
export function applyServerErrors<T extends FieldValues, TOut extends FieldValues>(
  form: UseFormReturn<T, unknown, TOut>,
  error: unknown,
  map: (path: string) => Path<T> | undefined = (p) => p as Path<T>,
): boolean {
  if (!(error instanceof ApiError) || error.status !== 422) return false;
  const fields = (error.problem as { errors?: ApiFieldError[] } | undefined)?.errors ?? [];
  let applied = false;
  for (const f of fields) {
    const name = map(f.path);
    if (!name) continue;
    form.setError(name, { type: f.code, message: 'form.invalid' });
    applied = true;
  }
  return applied;
}

export function Form<T extends FieldValues, TOut extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
}: {
  form: UseFormReturn<T, unknown, TOut>;
  onSubmit: (values: TOut) => unknown;
  children: ReactNode;
  className?: string;
}) {
  return (
    <FormProvider {...form}>
      <form
        noValidate
        className={cn('flex flex-col gap-4', className)}
        onSubmit={form.handleSubmit((values) => {
          onSubmit(values);
        })}
      >
        {children}
      </form>
    </FormProvider>
  );
}

interface FieldShellProps {
  label: string;
  hint?: string | undefined;
  optional?: boolean;
  error: FieldError | undefined;
  children: (props: {
    id: string;
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  }) => ReactNode;
}

function FieldShell({ label, hint, optional, error, children }: FieldShellProps) {
  const { t } = useLocale();
  const id = useId();
  const key = fieldErrorKey(error);
  const described = [hint && `${id}-hint`, key && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground"> ({t('form.optional')})</span>
        )}
      </label>
      {children({
        id,
        ...(key ? { 'aria-invalid': true as const } : {}),
        ...(described ? { 'aria-describedby': described } : {}),
      })}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {key && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {t(key)}
        </p>
      )}
    </div>
  );
}

/** Reads a nested error ("address.line1") from the form state. */
function useFieldError(name: string): FieldError | undefined {
  const { formState } = useFormContext();
  return name
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      formState.errors,
    ) as FieldError | undefined;
}

interface TextFieldProps extends Omit<ComponentProps<'input'>, 'name'> {
  name: string;
  label: string;
  hint?: string | undefined;
  optional?: boolean;
}

export function TextField({ name, label, hint, optional, ...props }: TextFieldProps) {
  const { register } = useFormContext();
  const error = useFieldError(name);
  return (
    <FieldShell label={label} hint={hint} optional={optional ?? false} error={error}>
      {(a11y) => <Input {...a11y} {...props} {...register(name)} />}
    </FieldShell>
  );
}

/** A Bangladeshi mobile number; any common way of writing it is accepted. */
export function PhoneField(props: TextFieldProps) {
  return (
    <TextField
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="01712-345678"
      {...props}
    />
  );
}

export function SelectField({
  name,
  label,
  hint,
  options,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string | undefined;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
}) {
  const { register } = useFormContext();
  const error = useFieldError(name);
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(a11y) => (
        <select
          {...a11y}
          {...register(name)}
          disabled={disabled}
          className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-base disabled:opacity-50"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function SwitchField({
  name,
  label,
  hint,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string | undefined;
  disabled?: boolean;
}) {
  const { register } = useFormContext();
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        disabled={disabled}
        {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
        {...register(name)}
        className="mt-3 size-5"
      />
      <div className="flex min-h-11 flex-col justify-center">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
