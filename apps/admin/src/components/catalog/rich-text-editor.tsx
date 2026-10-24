// The description editor (phase-2-plan §3.5): TipTap limited to paragraphs,
// headings 2–3, bold, italic, lists and http(s)/mailto links. Loaded lazily,
// only where a description is edited, so TipTap stays out of other screens.
import { isSafeHref, type RichTextDoc } from '@managemind/shared/rich-text';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useLocale } from '../../i18n';
import { toRichTextDoc } from '../../lib/rich-text';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export interface RichTextEditorProps {
  labelId: string;
  describedBy?: string | undefined;
  lang?: string | undefined;
  value: RichTextDoc | null | undefined;
  onChange: (doc: RichTextDoc) => void;
  disabled?: boolean | undefined;
}

/** "example.com" -> "https://example.com"; an address -> mailto. */
export function linkHref(input: string): string {
  const text = input.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(text)) return `mailto:${text}`;
  return `https://${text}`;
}

export default function RichTextEditor({
  labelId,
  describedBy,
  lang,
  value,
  onChange,
  disabled,
}: RichTextEditorProps) {
  const { t } = useLocale();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        hardBreak: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          protocols: ['mailto'],
          isAllowedUri: (url) => isSafeHref(url),
          HTMLAttributes: { rel: 'nofollow noopener noreferrer', target: null },
        },
      }),
    ],
    // ProseMirror JSON in and out; the stored format (phase-2-plan §3.5).
    content: (value ?? { type: 'doc', content: [] }) as object,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelId,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(lang ? { lang } : {}),
        class: 'rich-text min-h-40 px-3 py-2 text-base outline-none',
      },
    },
    onUpdate: ({ editor }) => onChange(toRichTextDoc(editor.getJSON())),
  });

  useEffect(() => {
    // Without `false` Tiptap emits an update, which marked every product as changed on load.
    editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      link: e.isActive('link'),
      href: (e.getAttributes('link').href as string | undefined) ?? '',
    }),
  });

  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [linkError, setLinkError] = useState(false);
  const linkId = useId();

  function applyLink() {
    const url = linkHref(href);
    if (!href.trim() || !isSafeHref(url)) {
      setLinkError(true);
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    // With nothing selected, the address itself becomes the link's text.
    if (editor.state.selection.empty && !active.link) {
      chain
        .insertContent({
          type: 'text',
          text: href.trim(),
          marks: [{ type: 'link', attrs: { href: url } }],
        })
        .run();
    } else chain.setLink({ href: url }).run();
    setLinkOpen(false);
  }

  const tool = (label: string, pressed: boolean, icon: ReactNode, run: () => void) => (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={cn(pressed && 'bg-muted text-foreground')}
      // Keeps the editor's selection: a tap on the toolbar doesn't blur the text.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon}
    </Button>
  );

  return (
    <div className="rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
      <div
        role="toolbar"
        aria-label={t('editor.toolbar')}
        className="flex flex-wrap gap-0.5 border-b border-border p-1"
      >
        {tool(t('editor.bold'), active.bold, <Bold aria-hidden className="size-4" />, () =>
          editor.chain().focus().toggleBold().run(),
        )}
        {tool(t('editor.italic'), active.italic, <Italic aria-hidden className="size-4" />, () =>
          editor.chain().focus().toggleItalic().run(),
        )}
        {tool(t('editor.heading2'), active.h2, <Heading2 aria-hidden className="size-4" />, () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
        )}
        {tool(t('editor.heading3'), active.h3, <Heading3 aria-hidden className="size-4" />, () =>
          editor.chain().focus().toggleHeading({ level: 3 }).run(),
        )}
        {tool(t('editor.bulletList'), active.bullet, <List aria-hidden className="size-4" />, () =>
          editor.chain().focus().toggleBulletList().run(),
        )}
        {tool(
          t('editor.orderedList'),
          active.ordered,
          <ListOrdered aria-hidden className="size-4" />,
          () => editor.chain().focus().toggleOrderedList().run(),
        )}
        {tool(
          t('editor.link'),
          active.link || linkOpen,
          <Link2 aria-hidden className="size-4" />,
          () => {
            setHref(active.href);
            setLinkError(false);
            setLinkOpen((open) => !open);
          },
        )}
      </div>
      {linkOpen && (
        <div className="flex flex-col gap-2 border-b border-border p-2 md:flex-row md:items-start">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={linkId} className="sr-only">
              {t('editor.linkUrl')}
            </label>
            <Input
              id={linkId}
              type="url"
              inputMode="url"
              autoFocus
              placeholder={t('editor.linkUrl')}
              value={href}
              aria-invalid={linkError || undefined}
              aria-describedby={linkError ? `${linkId}-error` : undefined}
              onChange={(e) => {
                setHref(e.target.value);
                setLinkError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                } else if (e.key === 'Escape') setLinkOpen(false);
              }}
            />
            {linkError && (
              <p id={`${linkId}-error`} className="text-sm text-danger">
                {t('editor.linkInvalid')}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={applyLink}>
              {t('editor.linkApply')}
            </Button>
            {active.link && (
              <Button
                variant="ghost"
                onClick={() => {
                  editor.chain().focus().extendMarkRange('link').unsetLink().run();
                  setLinkOpen(false);
                }}
              >
                {t('editor.linkRemove')}
              </Button>
            )}
          </div>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
