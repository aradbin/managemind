// The frame of the screens before the admin (ADR 0029): sign-in, two-factor
// and accepting an invitation. The brand and the language switch on top,
// the form in a card from the md breakpoint (the whole screen on phones),
// and, for sign-in, a bar for its steps.
import type { ReactNode } from 'react';
import { useLocale } from '../i18n';
import { cn } from '../lib/utils';
import { LanguageSwitch } from './language-switch';

export function AuthLayout({
  step,
  steps = 2,
  children,
}: {
  /** Which step of signing in this is, from 1; none for other screens. */
  step?: number;
  steps?: number;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div className="flex min-h-dvh flex-col bg-background md:items-center md:justify-center md:bg-canvas md:p-6">
      <div className="flex w-full flex-1 flex-col md:max-w-md md:flex-none md:rounded-2xl md:border md:border-border md:bg-background md:shadow-sm">
        <header className="flex items-center justify-between gap-2 px-5 pt-4 md:px-8 md:pt-6">
          <p className="flex items-center gap-2.5 font-semibold">
            <span
              aria-hidden
              className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground"
            >
              m
            </span>
            {t('app.name', { platform: 'managemind' })}
          </p>
          <LanguageSwitch />
        </header>
        {step !== undefined && (
          <div aria-hidden className="flex gap-1.5 px-5 pt-4 md:px-8">
            {Array.from({ length: steps }, (_, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: the steps never reorder.
                key={i}
                className={cn('h-1 flex-1 rounded-full', i < step ? 'bg-primary' : 'bg-border')}
              />
            ))}
          </div>
        )}
        <main className="flex flex-1 flex-col gap-6 px-5 pt-8 pb-8 md:px-8 md:pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
