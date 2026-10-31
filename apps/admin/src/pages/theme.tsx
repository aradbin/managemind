// Online store > Theme (phase-3-plan §3.4, §7): presets, colours with the
// contrast check, font, corners, logo, cards, the announcement bar, the
// homepage's sections and product page settings, with the live preview
// beside the editor (a "Preview" tab on phones). The draft saves itself a
// moment after each change; "Publish" shows it to shoppers.
import {
  COLOR_KEYS,
  type ColorKey,
  contrastIssues,
  FONTS,
  IMAGE_RATIOS,
  MAX_SECTIONS,
  RADII,
  SECTION_TYPES,
  THEME_PRESETS,
  type Theme,
  type ThemePreset,
  type ThemeSection,
} from '@managemind/shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, Monitor, Smartphone, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Lang } from '../components/catalog/language-tabs';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { ImagePicker } from '../components/theme/image-picker';
import { LinkPicker } from '../components/theme/link-picker';
import { LocalizedField } from '../components/theme/localized-field';
import { newSection, SectionEditor } from '../components/theme/section-editor';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { ApiError, api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { saveErrorMessage } from '../lib/errors';
import { type ThemeState, themeQuery } from '../lib/online-store';
import { cn } from '../lib/utils';

const SAVE_DELAY_MS = 1200;
const select =
  'w-full min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm disabled:opacity-50';

/** The CSS variables the storefront takes from the tokens (its Layout.astro). */
function cssVars(theme: Theme): Record<string, string> {
  const c = theme.tokens.colors;
  const system =
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans Bengali', 'Noto Sans', sans-serif";
  return {
    '--c-primary': c.primary,
    '--c-on-primary': c.onPrimary,
    '--c-background': c.background,
    '--c-surface': c.surface,
    '--c-text': c.text,
    '--c-accent': c.accent,
    '--c-sale': c.sale,
    '--radius': { none: '0', small: '6px', large: '14px' }[theme.tokens.radius],
    '--font': theme.tokens.font === 'hind-siliguri' ? `'Hind Siliguri', ${system}` : system,
    '--card-ratio': theme.tokens.card.imageRatio === '3:4' ? '3 / 4' : '1 / 1',
  };
}

export function ThemePage() {
  const { t } = useLocale();
  const theme = useQuery(themeQuery);
  const store = useQuery(storeSettingsQuery);
  return (
    <>
      <PageHeader title={t('theme.title')} description={t('theme.description')} />
      {theme.isPending || store.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : theme.isError || store.isError ? (
        <Notice tone="error">{saveErrorMessage(theme.error ?? store.error, t)}</Notice>
      ) : (
        <Editor
          initial={theme.data}
          defaultLang={store.data.defaultLocale}
          storeUrl={store.data.storeUrl}
        />
      )}
    </>
  );
}

function Editor({
  initial,
  defaultLang,
  storeUrl,
}: {
  initial: ThemeState;
  defaultLang: Lang;
  storeUrl: string;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const disabled = !canEdit;
  const [draft, setDraft] = useState<Theme>(initial.draft);
  const [unpublished, setUnpublished] = useState(initial.unpublishedChanges);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string>();
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [preset, setPreset] = useState<ThemePreset | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reloadAfterSave = useRef(false);
  const issues = contrastIssues(draft.tokens.colors);

  const preview = useQuery({
    queryKey: ['theme-preview-token'],
    queryFn: async () => unwrap(await api.POST('/v1/admin/theme/preview-token')),
    // Tokens last 15 minutes; a fresh one well before that.
    refetchInterval: 12 * 60_000,
    staleTime: 10 * 60_000,
  });
  const previewUrl = preview.data?.url ?? null;
  const previewOrigin = previewUrl ? new URL(previewUrl).origin : null;

  const save = useMutation({
    mutationFn: async (theme: Theme) =>
      unwrap(
        await api.PUT('/v1/admin/theme/draft', { body: theme as never }),
      ) as unknown as ThemeState,
    onMutate: () => setStatus('saving'),
    onSuccess: (state) => {
      queryClient.setQueryData(themeQuery.queryKey, state);
      setUnpublished(state.unpublishedChanges);
      setStatus('saved');
      setSaveError(undefined);
      if (reloadAfterSave.current) {
        reloadAfterSave.current = false;
        setReloadKey((k) => k + 1);
      }
    },
    onError: (e) => {
      setStatus('error');
      const fields = e instanceof ApiError ? (e.problem?.errors ?? []) : [];
      setSaveError(
        fields.length
          ? fields.map((f) => `${f.path}: ${f.message}`).join(' · ')
          : saveErrorMessage(e, t),
      );
    },
  });

  /** Colours, fonts and corners reach the preview at once; everything else after the save. */
  const pushTokens = useCallback(
    (theme: Theme) => {
      if (!previewOrigin) return;
      frame.current?.contentWindow?.postMessage(
        { type: 'mm-theme-vars', vars: cssVars(theme) },
        previewOrigin,
      );
    },
    [previewOrigin],
  );

  function change(next: Theme, kind: 'tokens' | 'content' = 'content') {
    setDraft(next);
    setUnpublished(true);
    if (kind === 'tokens') pushTokens(next);
    else reloadAfterSave.current = true;
    clearTimeout(timer.current);
    // A draft below WCAG AA isn't saved; the messages say which colours to change.
    if (contrastIssues(next.tokens.colors).length) return;
    timer.current = setTimeout(() => save.mutate(next), SAVE_DELAY_MS);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  const applyPreset = useMutation({
    mutationFn: async (name: ThemePreset) =>
      unwrap(
        await api.POST('/v1/admin/theme/presets/{name}', { params: { path: { name } } }),
      ) as unknown as ThemeState,
    onSuccess: (state) => {
      clearTimeout(timer.current);
      queryClient.setQueryData(themeQuery.queryKey, state);
      setDraft(state.draft);
      setUnpublished(state.unpublishedChanges);
      setPreset(null);
      setReloadKey((k) => k + 1);
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      clearTimeout(timer.current);
      // Publish exactly what's on screen.
      await api.PUT('/v1/admin/theme/draft', { body: draft as never }).then(unwrap);
      return unwrap(await api.POST('/v1/admin/theme/publish')) as unknown as ThemeState;
    },
    onSuccess: (state) => {
      queryClient.setQueryData(themeQuery.queryKey, state);
      setUnpublished(false);
      setPublishing(false);
      toast(t('theme.published'));
    },
  });

  const tokens = draft.tokens;
  const setTokens = (next: Partial<Theme['tokens']>, kind: 'tokens' | 'content' = 'tokens') =>
    change({ ...draft, tokens: { ...tokens, ...next } }, kind);
  const sections = draft.sections;
  const setSections = (next: ThemeSection[]) => change({ ...draft, sections: next });
  const move = (i: number, by: -1 | 1) => {
    const next = [...sections];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + by, 0, item);
    setSections(next);
  };

  const editor = (
    <div className="flex flex-col gap-5">
      {disabled && <Notice>{t('theme.readOnly')}</Notice>}

      <section
        aria-labelledby="presets"
        className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <h2 id="presets" className="font-semibold">
          {t('theme.presets')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('theme.presetsHint')}</p>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((p) => (
            <Button
              key={p}
              variant={draft.preset === p ? 'primary' : 'secondary'}
              disabled={disabled}
              onClick={() => setPreset(p)}
            >
              {t(`theme.preset.${p}`)}
            </Button>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="colors"
        className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <h2 id="colors" className="font-semibold">
          {t('theme.colors')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {COLOR_KEYS.map((key) => (
            <ColorInput
              key={key}
              label={t(`theme.color.${key}`)}
              value={tokens.colors[key]}
              invalid={issues.some((i) => i.fg === key || i.bg === key)}
              disabled={disabled}
              onChange={(value) =>
                setTokens({
                  colors: { ...tokens.colors, [key]: value } as Record<ColorKey, string>,
                })
              }
            />
          ))}
        </div>
        {issues.map((issue) => (
          <Notice key={`${issue.fg}-${issue.bg}`} tone="error">
            {t('theme.contrast', {
              use: t(`theme.contrastUse.${issue.use}` as 'theme.contrastUse.links'),
              ratio: issue.ratio.toFixed(2),
            })}
          </Notice>
        ))}
      </section>

      <section
        aria-labelledby="look"
        className="grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-2 md:p-5"
      >
        <h2 id="look" className="sr-only">
          {t('theme.font')}
        </h2>
        <Select
          label={t('theme.font')}
          value={tokens.font}
          disabled={disabled}
          options={FONTS.map((f) => ({ value: f, label: t(`theme.font.${f}`) }))}
          onChange={(font) => setTokens({ font })}
        />
        <Select
          label={t('theme.radius')}
          value={tokens.radius}
          disabled={disabled}
          options={RADII.map((r) => ({ value: r, label: t(`theme.radius.${r}`) }))}
          onChange={(radius) => setTokens({ radius })}
        />
        <ImagePicker
          label={t('theme.logo')}
          mediaId={tokens.logoMediaId}
          disabled={disabled}
          onChange={(logoMediaId) => setTokens({ logoMediaId }, 'content')}
        />
        <ImagePicker
          label={t('theme.favicon')}
          mediaId={tokens.faviconMediaId}
          disabled={disabled}
          onChange={(faviconMediaId) => setTokens({ faviconMediaId }, 'content')}
        />
      </section>

      <section
        aria-labelledby="cards"
        className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <h2 id="cards" className="font-semibold">
          {t('theme.cards')}
        </h2>
        <Select
          label={t('theme.card.ratio')}
          value={tokens.card.imageRatio}
          disabled={disabled}
          options={IMAGE_RATIOS.map((r) => ({ value: r, label: t(`theme.card.ratio.${r}`) }))}
          onChange={(imageRatio) => setTokens({ card: { ...tokens.card, imageRatio } })}
        />
        <Check
          label={t('theme.card.showCompareAt')}
          checked={tokens.card.showCompareAt}
          disabled={disabled}
          onChange={(showCompareAt) =>
            setTokens({ card: { ...tokens.card, showCompareAt } }, 'content')
          }
        />
        <Check
          label={t('theme.card.showBrand')}
          checked={tokens.card.showBrand}
          disabled={disabled}
          onChange={(showBrand) => setTokens({ card: { ...tokens.card, showBrand } }, 'content')}
        />
      </section>

      <section
        aria-labelledby="announcement"
        className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <h2 id="announcement" className="font-semibold">
          {t('theme.announcement')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('theme.announcementHint')}</p>
        <Check
          label={t('theme.announcementOn')}
          checked={draft.announcement !== null}
          disabled={disabled}
          onChange={(on) =>
            change({ ...draft, announcement: on ? { text: {}, link: null } : null })
          }
        />
        {draft.announcement && (
          <>
            <LocalizedField
              label="section.text"
              defaultLang={defaultLang}
              maxLength={140}
              disabled={disabled}
              value={draft.announcement.text}
              onChange={(text) =>
                change({
                  ...draft,
                  announcement: draft.announcement ? { ...draft.announcement, text } : null,
                })
              }
            />
            <LinkPicker
              value={draft.announcement.link}
              disabled={disabled}
              onChange={(link) =>
                change({
                  ...draft,
                  announcement: draft.announcement ? { ...draft.announcement, link } : null,
                })
              }
            />
          </>
        )}
      </section>

      <section
        aria-labelledby="sections"
        className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <h2 id="sections" className="font-semibold">
          {t('theme.sections')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('theme.sectionsHint')}</p>
        <ol className="flex flex-col gap-3">
          {sections.map((section, i) => {
            const name = `${i + 1}. ${t(`section.${section.type}`)}`;
            return (
              <li key={section.id} className="rounded-md border border-border">
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 font-medium">
                    {name}
                  </summary>
                  <div className="border-t border-border p-3">
                    <SectionEditor
                      section={section}
                      defaultLang={defaultLang}
                      disabled={disabled}
                      onChange={(next) =>
                        setSections(sections.map((s) => (s.id === section.id ? next : s)))
                      }
                    />
                  </div>
                </details>
                <div className="flex justify-end gap-1 border-t border-border p-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('theme.moveUp', { section: name })}
                    disabled={disabled || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('theme.moveDown', { section: name })}
                    disabled={disabled || i === sections.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('theme.removeSection', { section: name })}
                    disabled={disabled}
                    onClick={() => setSections(sections.filter((s) => s.id !== section.id))}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        {sections.length < MAX_SECTIONS ? (
          <AddSection
            disabled={disabled}
            onAdd={(type) => setSections([...sections, newSection(type)])}
          />
        ) : (
          <Notice>{t('theme.sectionLimit')}</Notice>
        )}
      </section>

      <section
        aria-labelledby="product-page"
        className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <h2 id="product-page" className="font-semibold">
          {t('theme.productPage')}
        </h2>
        <Check
          label={t('theme.showRelated')}
          checked={draft.pages.product.showRelated}
          disabled={disabled}
          onChange={(showRelated) =>
            change({ ...draft, pages: { product: { ...draft.pages.product, showRelated } } })
          }
        />
        <Select
          label={t('theme.specifications')}
          value={draft.pages.product.specifications}
          disabled={disabled}
          options={(['table', 'list'] as const).map((v) => ({
            value: v,
            label: t(`theme.specifications.${v}`),
          }))}
          onChange={(specifications) =>
            change({ ...draft, pages: { product: { ...draft.pages.product, specifications } } })
          }
        />
      </section>
    </div>
  );

  const previewPane = (
    <div
      className={cn(
        'mx-auto flex h-[75dvh] w-full flex-col overflow-hidden border border-border bg-background shadow-sm lg:sticky lg:top-36 lg:h-[calc(100dvh-10rem)]',
        device === 'phone' ? 'max-w-[390px] rounded-[1.75rem]' : 'rounded-xl',
      )}
    >
      {previewUrl ? (
        <iframe
          key={reloadKey}
          ref={frame}
          title={t('theme.previewTitle')}
          src={previewUrl}
          className="size-full bg-white"
          onLoad={() => pushTokens(draft)}
        />
      ) : preview.isError ? (
        <Notice tone="error">{t('theme.previewUnavailable')}</Notice>
      ) : (
        <p role="status" className="p-4">
          {t('loading')}
        </p>
      )}
    </div>
  );

  return (
    <>
      <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-4 py-2 shadow-sm">
        <p role="status" className="flex-1 text-sm text-muted-foreground">
          {status === 'saving'
            ? t('theme.saving')
            : status === 'error'
              ? t('theme.saveFailed')
              : unpublished
                ? t('theme.unpublished')
                : t('theme.upToDate')}
          {status === 'saved' && unpublished ? ` · ${t('theme.saved')}` : ''}
        </p>
        <fieldset className="hidden min-w-0 rounded-lg border-0 bg-muted p-0.5 lg:flex">
          <legend className="sr-only">{t('theme.previewSize')}</legend>
          {(['desktop', 'phone'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={cn(
                'flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground',
                device === d && 'bg-background text-foreground shadow-sm',
              )}
            >
              {d === 'desktop' ? (
                <Monitor aria-hidden className="size-4" />
              ) : (
                <Smartphone aria-hidden className="size-4" />
              )}
              {t(d === 'desktop' ? 'theme.desktop' : 'theme.phone')}
            </button>
          ))}
        </fieldset>
        <Button asChild variant="ghost">
          <a href={storeUrl} target="_blank" rel="noopener">
            <ExternalLink aria-hidden className="size-4" />
            {t('store.view')}
          </a>
        </Button>
        {canEdit && (
          <Button
            disabled={!unpublished || issues.length > 0 || publish.isPending}
            onClick={() => setPublishing(true)}
          >
            {t('theme.publish')}
          </Button>
        )}
      </div>
      {saveError && <Notice tone="error">{saveError}</Notice>}
      <div
        role="tablist"
        aria-label={t('theme.title')}
        className="mb-4 flex gap-1 border-b border-border lg:hidden"
      >
        {(['edit', 'preview'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px min-h-11 border-b-2 px-3 text-sm',
              tab === key
                ? 'border-primary font-semibold'
                : 'border-transparent text-muted-foreground',
            )}
          >
            {t(key === 'edit' ? 'theme.edit' : 'theme.preview')}
          </button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className={cn(tab === 'edit' ? 'block' : 'hidden', 'lg:block')}>{editor}</div>
        <div className={cn(tab === 'preview' ? 'block' : 'hidden', 'lg:block')}>{previewPane}</div>
      </div>
      <ConfirmDialog
        open={preset !== null}
        onOpenChange={(open) => !open && setPreset(null)}
        title={t('theme.presetConfirm', { preset: preset ? t(`theme.preset.${preset}`) : '' })}
        confirmLabel={t('theme.presetApply')}
        destructive={false}
        busy={applyPreset.isPending}
        error={applyPreset.isError ? saveErrorMessage(applyPreset.error, t) : undefined}
        onConfirm={() => preset && applyPreset.mutate(preset)}
      >
        <p>{t('theme.presetBody')}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={publishing}
        onOpenChange={setPublishing}
        title={t('theme.publishConfirm')}
        confirmLabel={t('theme.publish')}
        destructive={false}
        busy={publish.isPending}
        error={publish.isError ? saveErrorMessage(publish.error, t) : undefined}
        onConfirm={() => publish.mutate()}
      >
        <p>{t('theme.publishBody')}</p>
      </ConfirmDialog>
    </>
  );
}

function ColorInput({
  label,
  value,
  invalid,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={label}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-border bg-background p-1"
        />
        <Input
          id={id}
          value={text}
          maxLength={7}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
        />
      </div>
    </div>
  );
}

function Select<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (value: V) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        className={select}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as V)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex min-h-10 items-center gap-3 md:min-h-9">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function AddSection({
  onAdd,
  disabled,
}: {
  onAdd: (type: ThemeSection['type']) => void;
  disabled: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  const [type, setType] = useState<ThemeSection['type']>('product_grid');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-48 flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {t('theme.addSection')}
        </label>
        <select
          id={id}
          className={select}
          value={type}
          disabled={disabled}
          onChange={(e) => setType(e.target.value as ThemeSection['type'])}
        >
          {SECTION_TYPES.map((s) => (
            <option key={s} value={s}>
              {t(`section.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <Button variant="secondary" disabled={disabled} onClick={() => onAdd(type)}>
        {t('theme.addSection')}
      </Button>
    </div>
  );
}
