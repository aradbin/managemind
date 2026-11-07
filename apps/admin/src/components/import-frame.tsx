// The import pages as the canvas draws them (ADR 0034): a 760 px column with
// the title, "Download a sample file", the steps as numbered dots, and a
// dashed drop zone to choose the spreadsheet. Products, customers,
// suppliers and expenses share it.
import { Download, FileUp } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useLocale } from '../i18n';
import { download, toCsv } from '../lib/download';
import { type Parsed, parseFile } from '../lib/sheet';
import { cn } from '../lib/utils';
import { Notice } from './notice';
import { PageHeader } from './page-header';
import { Button } from './ui/button';
import { cardPadded } from './ui/card';

/** Numbered steps joined by lines (.mm-steps): done ones filled, the current one ringed. */
export function StepDots({
  label,
  steps,
  current,
  className,
}: {
  label: string;
  steps: readonly string[];
  current: number;
  className?: string;
}) {
  return (
    <ol aria-label={label} className={cn('flex items-center', className)}>
      {steps.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? 'step' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground last:flex-none',
            i < current && 'text-foreground',
            i === current && 'font-medium text-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold',
              i < current && 'border-primary bg-primary text-primary-foreground',
              i === current &&
                'border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_15%,transparent)]',
            )}
          >
            {i + 1}
          </span>
          <span className="truncate max-md:sr-only">{s}</span>
          {i < steps.length - 1 && (
            <span aria-hidden className="mx-2 h-px min-w-2 flex-1 bg-border" />
          )}
        </li>
      ))}
    </ol>
  );
}

export interface Sample {
  /** The file's name, such as "customers-sample.csv". */
  name: string;
  header: string[];
  rows: string[][];
}

export function ImportFrame({
  title,
  intro,
  parent,
  sample,
  steps,
  step,
  children,
}: {
  title: string;
  intro: string;
  parent?: Parameters<typeof PageHeader>[0]['parent'];
  sample?: Sample | undefined;
  steps: readonly string[];
  step: number;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 md:gap-4">
      <PageHeader
        className="mb-0"
        title={title}
        description={intro}
        {...(parent ? { parent } : {})}
        actions={
          sample && (
            <Button
              variant="secondary"
              onClick={() =>
                download(
                  sample.name,
                  new Blob([toCsv(sample.header, sample.rows)], { type: 'text/csv' }),
                )
              }
            >
              <Download aria-hidden />
              {t('import.sample')}
            </Button>
          )
        }
      />
      <StepDots label={t('import.steps')} steps={steps} current={step} />
      {children}
    </div>
  );
}

/** The dashed box to drop a spreadsheet on, or choose one. */
export function DropZone({ hint, onParsed }: { hint: string; onParsed: (p: Parsed) => void }) {
  const { t } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  async function read(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await parseFile(file);
      if (!result.rows.length) throw new Error('empty');
      onParsed(result);
    } catch {
      setError(t('import.unreadable'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <section className={cn(cardPadded, 'gap-3 md:gap-3')} aria-label={t('import.drop')}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping a file is extra; the button chooses one. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void read(e.dataTransfer.files[0]);
        }}
        className={cn(
          'flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-input px-4 py-8 text-center',
          over && 'border-primary bg-muted/60',
        )}
      >
        <span
          aria-hidden
          className="mb-1 inline-flex size-9 items-center justify-center rounded-full bg-muted"
        >
          <FileUp className="size-4" />
        </span>
        <p className="font-semibold">{t('import.drop')}</p>
        <p className="max-w-md text-[13px] text-muted-foreground">{hint}</p>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          // The button below opens it; screen readers meet only the button.
          tabIndex={-1}
          aria-hidden
          onChange={(e) => void read(e.target.files?.[0])}
        />
        <Button className="mt-1" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t('loading') : t('import.chooseFile')}
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}
