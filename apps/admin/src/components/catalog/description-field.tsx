// A product, category or collection description. The stored format is the
// whitelisted ProseMirror JSON (phase-2-plan §3.5). This field edits it as a
// small Markdown subset in a plain text area (**bold**, *italic*, "- " lists,
// "1. " lists, "## " headings, [links](https://…)), converted with the same
// shared functions the import uses; it is also the fallback should the rich
// editor misbehave with a Bangla keyboard.
import {
  type RichTextDoc,
  richTextFromMarkdown,
  richTextToMarkdown,
} from '@managemind/shared/rich-text';
import { useId, useState } from 'react';
import { useLocale } from '../../i18n';

interface DescriptionFieldProps {
  label: string;
  value: RichTextDoc | null | undefined;
  onChange: (doc: RichTextDoc) => void;
  disabled?: boolean;
}

export function DescriptionField({ label, value, onChange, disabled }: DescriptionFieldProps) {
  const { t } = useLocale();
  const id = useId();
  // The text is the source while typing, so the cursor never jumps.
  const [text, setText] = useState(() => (value ? richTextToMarkdown(value) : ''));
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label} <span className="font-normal text-muted-foreground">({t('form.optional')})</span>
      </label>
      <textarea
        id={id}
        aria-describedby={`${id}-hint`}
        rows={8}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(richTextFromMarkdown(e.target.value));
        }}
        className="w-full rounded-md border border-border bg-background p-3 text-base disabled:opacity-50"
      />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {t('description.hint')}
      </p>
    </div>
  );
}
