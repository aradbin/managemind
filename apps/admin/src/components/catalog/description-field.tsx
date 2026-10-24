// A product, category or collection description, stored as whitelisted
// ProseMirror JSON (phase-2-plan §3.5). The formatted editor (TipTap) loads
// on demand. "Plain text" switches to a text area with a small Markdown
// subset, converted by the same shared functions the import uses: the
// plan's fallback should the formatted editor misbehave with a Bangla
// keyboard. The choice is remembered on this device; the stored format is
// the same either way.
import {
  type RichTextDoc,
  richTextFromMarkdown,
  richTextToMarkdown,
} from '@managemind/shared/rich-text';
import { lazy, Suspense, useId, useState } from 'react';
import { useLocale } from '../../i18n';
import { Button } from '../ui/button';

const RichTextEditor = lazy(() => import('./rich-text-editor'));

const PLAIN_KEY = 'mm.plainDescriptions';

function plainPreferred(): boolean {
  try {
    return localStorage.getItem(PLAIN_KEY) === '1';
  } catch {
    return false;
  }
}

interface DescriptionFieldProps {
  label: string;
  value: RichTextDoc | null | undefined;
  onChange: (doc: RichTextDoc) => void;
  lang?: string | undefined;
  disabled?: boolean | undefined;
}

export function DescriptionField({
  label,
  value,
  onChange,
  lang,
  disabled,
}: DescriptionFieldProps) {
  const { t } = useLocale();
  const id = useId();
  const [plain, setPlain] = useState(plainPreferred);

  function switchMode() {
    const next = !plain;
    setPlain(next);
    try {
      localStorage.setItem(PLAIN_KEY, next ? '1' : '0');
    } catch {
      // Not remembered; still switched here.
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label id={`${id}-label`} htmlFor={plain ? id : undefined} className="text-sm font-medium">
          {label} <span className="font-normal text-muted-foreground">({t('form.optional')})</span>
        </label>
        <Button variant="ghost" className="text-primary" disabled={disabled} onClick={switchMode}>
          {plain ? t('editor.useFormatted') : t('editor.usePlain')}
        </Button>
      </div>
      {plain ? (
        <MarkdownArea id={id} lang={lang} value={value} onChange={onChange} disabled={disabled} />
      ) : (
        <Suspense
          fallback={<div className="min-h-52 rounded-md border border-border" aria-busy="true" />}
        >
          <RichTextEditor
            labelId={`${id}-label`}
            lang={lang}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </Suspense>
      )}
    </div>
  );
}

function MarkdownArea({
  id,
  lang,
  value,
  onChange,
  disabled,
}: {
  id: string;
  lang: string | undefined;
  value: RichTextDoc | null | undefined;
  onChange: (doc: RichTextDoc) => void;
  disabled: boolean | undefined;
}) {
  const { t } = useLocale();
  // The text is the source while typing, so the cursor never jumps.
  const [text, setText] = useState(() => (value ? richTextToMarkdown(value) : ''));
  return (
    <>
      <textarea
        id={id}
        lang={lang}
        aria-describedby={`${id}-hint`}
        rows={8}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(richTextFromMarkdown(e.target.value));
        }}
        className="w-full rounded-lg border border-border bg-background p-3 text-base disabled:opacity-50"
      />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {t('description.hint')}
      </p>
    </>
  );
}
