// The frame of the screens before the admin, as the canvas draws them (ADR
// 0034): sign-in, two-factor and accepting an invitation. The brand above a
// 380 px card on the grey page, and the languages under it; on phones the
// whole screen, the brand on top and the languages at the bottom.
import type { ReactNode } from 'react';
import { useLocale } from '../i18n';
import { cn } from '../lib/utils';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex min-h-dvh flex-col gap-6 bg-background px-5 pt-14 pb-6 md:items-center md:justify-center md:bg-muted md:p-6">
      <p className="flex items-center gap-2.5 text-base font-semibold">
        <span
          aria-hidden
          className="inline-flex size-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground"
        >
          m
        </span>
        managemind
      </p>
      <main className="flex flex-1 flex-col gap-5 md:w-[380px] md:max-w-full md:flex-none md:rounded-[14px] md:border md:border-border md:bg-card md:p-7 md:shadow-[0_1px_3px_rgb(0_0_0/.06)]">
        {children}
      </main>
      <p className="flex justify-center gap-1 text-xs text-muted-foreground">
        {(['bn', 'en'] as const).map((l, i) => (
          <span key={l} className="flex gap-1">
            {i > 0 && <span aria-hidden>·</span>}
            <button
              type="button"
              lang={l}
              aria-pressed={locale === l}
              onClick={() => setLocale(l)}
              className={cn(
                'hover:text-foreground hover:underline',
                locale === l && 'text-foreground',
              )}
            >
              {l === 'bn' ? 'বাংলা' : 'English'}
            </button>
          </span>
        ))}
      </p>
    </div>
  );
}

/** The screen's title and the line under it. */
export function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
      {children && <p className="text-muted-foreground">{children}</p>}
    </div>
  );
}

/** A one-time code's box: large, spaced digits. */
export const otpClass =
  'h-12 text-center text-xl font-semibold tracking-[0.5em] tabular-nums md:h-12 md:text-xl';
