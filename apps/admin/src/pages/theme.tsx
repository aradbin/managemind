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
  presetTheme,
  RADII,
  SECTION_TYPES,
  THEME_PRESETS,
  type Theme,
  type ThemePreset,
  type ThemeSection,
} from '@managemind/shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  Eye,
  Monitor,
  Plus,
  Smartphone,
  X,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Lang } from '../components/catalog/language-tabs';
import { ConfirmDialog } from '../components/confirm-dialog';
import { fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { ImagePicker } from '../components/theme/image-picker';
import { LinkPicker } from '../components/theme/link-picker';
import { LocalizedField } from '../components/theme/localized-field';
import { newSection, SectionEditor } from '../components/theme/section-editor';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { RadioCard } from '../components/ui/choice';
import { Input } from '../components/ui/input';
import { Menu, menuContent, menuItem } from '../components/ui/menu';
import { chipClass } from '../components/ui/segmented';
import { SwitchRow } from '../components/ui/switch';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { ApiError, api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
import { saveErrorMessage } from '../lib/errors';
import { type ThemeState, themeQuery } from '../lib/online-store';
import { cn } from '../lib/utils';

const SAVE_DELAY_MS = 1200;

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
  useRecordPage(t('theme.title'));
  return (
    <>
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

  const [open, setOpen] = useState<Panel | null>('colors');
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const closePreview = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!previewOpen) return;
    closePreview.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPreviewOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewOpen]);
  const acc = (key: Panel, title: string, body: ReactNode) => (
    <Accordion
      key={key}
      title={title}
      open={open === key}
      onToggle={() => setOpen(open === key ? null : key)}
    >
      {body}
    </Accordion>
  );
  const sectionName = (section: ThemeSection) => t(`section.${section.type}`);

  const editor = (
    <>
      {disabled && <Notice>{t('theme.readOnly')}</Notice>}
      {saveError && <Notice tone="error">{saveError}</Notice>}
      {acc(
        'preset',
        t('theme.presets'),
        <>
          <p className="text-[13px] text-muted-foreground">{t('theme.presetsHint')}</p>
          <div className="grid grid-cols-3 gap-2">
            {THEME_PRESETS.map((p) => {
              const colors = presetTheme(p).tokens.colors;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={disabled}
                  onClick={() => setPreset(p)}
                  className={cn(modeClass, 'flex-col items-start gap-2')}
                >
                  <span aria-hidden className="flex gap-1">
                    {(['primary', 'surface', 'accent'] as const).map((c) => (
                      <span
                        key={c}
                        className="size-3.5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/.1)]"
                        style={{ background: colors[c] }}
                      />
                    ))}
                  </span>
                  {t(`theme.preset.${p}`)}
                </button>
              );
            })}
          </div>
        </>,
      )}
      {acc(
        'colors',
        t('theme.colors'),
        <>
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
          {issues.map((issue) => (
            <div
              key={`${issue.fg}-${issue.bg}`}
              role="alert"
              className="flex items-start gap-2.5 rounded-[10px] border border-[color-mix(in_oklch,var(--tone-warn)_35%,transparent)] bg-[color-mix(in_oklch,var(--tone-warn)_7%,transparent)] px-3.5 py-3 text-[13px]"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--tone-warn)]" />
              <p>
                {t('theme.contrast', {
                  use: t(`theme.contrastUse.${issue.use}` as 'theme.contrastUse.links'),
                  ratio: issue.ratio.toFixed(1),
                })}
              </p>
            </div>
          ))}
        </>,
      )}
      {acc(
        'type',
        t('theme.fontAndCorners'),
        <>
          <div role="radiogroup" aria-labelledby="theme-font" className="flex flex-col">
            <p id="theme-font" className={fieldLabel}>
              {t('theme.font')}
            </p>
            <div className="flex flex-col gap-1.5">
              {FONTS.map((f) => (
                <RadioCard
                  key={f}
                  name="theme-font"
                  checked={tokens.font === f}
                  onChange={() => !disabled && setTokens({ font: f })}
                  label={t(`theme.font.${f}`)}
                />
              ))}
            </div>
          </div>
          <Chips
            label={t('theme.radius')}
            value={tokens.radius}
            disabled={disabled}
            options={RADII.map((r) => ({ value: r, label: t(`theme.radius.${r}`) }))}
            onChange={(radius) => setTokens({ radius })}
          />
        </>,
      )}
      {acc(
        'logo',
        t('theme.logoAndIcon'),
        <>
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
        </>,
      )}
      {acc(
        'ann',
        t('theme.announcement'),
        <>
          <SwitchRow
            label={t('theme.announcementOn')}
            hint={t('theme.announcementHint')}
            checked={draft.announcement !== null}
            disabled={disabled}
            onCheckedChange={(on) =>
              change({ ...draft, announcement: on ? { text: {}, link: null } : null })
            }
          />
          {draft.announcement && (
            <>
              <LocalizedField
                label="section.text"
                stacked
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
        </>,
      )}
      {acc(
        'sections',
        t('theme.sections'),
        <>
          <p className="text-[13px] text-muted-foreground">{t('theme.sectionsHint')}</p>
          <ol className="flex flex-col gap-1.5">
            {sections.map((section, i) => {
              const name = sectionName(section);
              const isOpen = openSection === section.id;
              return (
                <li key={section.id} className="flex flex-col">
                  <div
                    className={cn(
                      'flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background py-0 pr-1.5 pl-3',
                      isOpen && 'border-primary',
                    )}
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenSection(isOpen ? null : section.id)}
                      className="min-w-0 flex-1 self-stretch text-left font-medium"
                    >
                      {name}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 md:size-7"
                      aria-label={t('theme.moveUp', { section: name })}
                      disabled={disabled || i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ChevronUp aria-hidden className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 md:size-7"
                      aria-label={t('theme.moveDown', { section: name })}
                      disabled={disabled || i === sections.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ChevronDown aria-hidden className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 md:size-7"
                      aria-label={t('theme.removeSection', { section: name })}
                      disabled={disabled}
                      onClick={() => setSections(sections.filter((s) => s.id !== section.id))}
                    >
                      <X aria-hidden className="size-3.5" />
                    </Button>
                  </div>
                  {isOpen && (
                    <div className="-mt-1.5 flex flex-col gap-3 rounded-b-lg border border-t-0 border-border p-3 pt-[18px]">
                      <SectionEditor
                        section={section}
                        defaultLang={defaultLang}
                        disabled={disabled}
                        onChange={(next) =>
                          setSections(sections.map((s) => (s.id === section.id ? next : s)))
                        }
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {sections.length < MAX_SECTIONS ? (
            <Menu.Root>
              <Menu.Trigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  className="flex h-10 w-full items-center gap-2 rounded-[10px] border border-dashed border-input px-3 text-left text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <Plus aria-hidden className="size-4" />
                  {t('theme.addSection')}
                </button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content align="start" sideOffset={4} className={cn(menuContent, 'w-[220px]')}>
                  {SECTION_TYPES.map((type) => (
                    <Menu.Item
                      key={type}
                      className={menuItem}
                      onSelect={() => {
                        const added = newSection(type);
                        setSections([...sections, added]);
                        setOpenSection(added.id);
                      }}
                    >
                      {t(`section.${type}`)}
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          ) : (
            <Notice>{t('theme.sectionLimit')}</Notice>
          )}
        </>,
      )}
      {acc(
        'cards',
        t('theme.cards'),
        <>
          <Chips
            label={t('theme.card.ratio')}
            value={tokens.card.imageRatio}
            disabled={disabled}
            options={IMAGE_RATIOS.map((r) => ({ value: r, label: t(`theme.card.ratio.${r}`) }))}
            onChange={(imageRatio) => setTokens({ card: { ...tokens.card, imageRatio } })}
          />
          <SwitchRow
            label={t('theme.card.showCompareAt')}
            checked={tokens.card.showCompareAt}
            disabled={disabled}
            onCheckedChange={(showCompareAt) =>
              setTokens({ card: { ...tokens.card, showCompareAt } }, 'content')
            }
          />
          <SwitchRow
            label={t('theme.card.showBrand')}
            checked={tokens.card.showBrand}
            disabled={disabled}
            onCheckedChange={(showBrand) =>
              setTokens({ card: { ...tokens.card, showBrand } }, 'content')
            }
          />
        </>,
      )}
      {acc(
        'product',
        t('theme.productPage'),
        <>
          <SwitchRow
            label={t('theme.showRelated')}
            checked={draft.pages.product.showRelated}
            disabled={disabled}
            onCheckedChange={(showRelated) =>
              change({ ...draft, pages: { product: { ...draft.pages.product, showRelated } } })
            }
          />
          <div role="radiogroup" aria-labelledby="theme-specs" className="flex flex-col">
            <p id="theme-specs" className={fieldLabel}>
              {t('theme.specifications')}
            </p>
            <div className="flex flex-col gap-1.5">
              {(['table', 'list'] as const).map((v) => (
                <RadioCard
                  key={v}
                  name="theme-specs"
                  checked={draft.pages.product.specifications === v}
                  onChange={() =>
                    !disabled &&
                    change({
                      ...draft,
                      pages: { product: { ...draft.pages.product, specifications: v } },
                    })
                  }
                  label={t(`theme.specifications.${v}`)}
                />
              ))}
            </div>
          </div>
        </>,
      )}
    </>
  );

  const statusLine =
    status === 'saving'
      ? t('theme.saving')
      : status === 'error'
        ? t('theme.saveFailed')
        : unpublished
          ? t('theme.unpublished')
          : t('theme.upToDate');
  const warn = unpublished || status === 'error';

  const frameBox = previewUrl ? (
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
  );

  return (
    <div className="flex flex-col max-md:gap-2.5 md:-mx-6 md:-mt-5 md:-mb-6 md:min-h-0 md:flex-1">
      <PhoneRecordHeader to="/online-store" backLabel={t('theme.back')} title={t('theme.title')}>
        {canEdit && (
          <Button
            className="mr-1 h-8"
            disabled={!unpublished || issues.length > 0 || publish.isPending}
            onClick={() => setPublishing(true)}
          >
            {t('theme.publish')}
          </Button>
        )}
      </PhoneRecordHeader>
      <div className="flex flex-wrap items-center gap-3 md:px-5 md:py-3.5">
        <Button asChild variant="ghost" size="icon" className="-ml-2 max-md:hidden">
          <Link to="/online-store" aria-label={t('theme.back')} title={t('theme.back')}>
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-col">
          <h1 className="text-lg leading-6 font-semibold max-md:hidden">{t('theme.title')}</h1>
          <p
            role="status"
            className="flex flex-wrap items-center gap-1.5 text-[13px] md:text-xs md:leading-5"
          >
            <span
              className={warn ? 'font-medium text-warning-foreground' : 'text-muted-foreground'}
            >
              {statusLine}
            </span>
            {status === 'saved' && unpublished && (
              <span className="text-muted-foreground max-md:hidden">· {t('theme.saved')}</span>
            )}
          </p>
        </div>
        <span className="flex-1 max-md:hidden" />
        <fieldset
          aria-label={t('theme.previewSize')}
          className="inline-flex h-8 items-center rounded-[10px] bg-muted p-[3px] max-md:hidden"
        >
          {(['desktop', 'phone'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              aria-label={t(d === 'desktop' ? 'theme.desktop' : 'theme.phone')}
              title={t(d === 'desktop' ? 'theme.desktop' : 'theme.phone')}
              onClick={() => setDevice(d)}
              className="inline-flex h-[26px] items-center rounded-lg border border-transparent px-2.5 text-muted-foreground hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm dark:aria-pressed:border-input dark:aria-pressed:bg-input"
            >
              {d === 'desktop' ? (
                <Monitor aria-hidden className="size-[15px]" />
              ) : (
                <Smartphone aria-hidden className="size-[15px]" />
              )}
            </button>
          ))}
        </fieldset>
        <Button asChild variant="secondary" className="max-md:hidden">
          <a href={storeUrl} target="_blank" rel="noopener">
            <ExternalLink aria-hidden />
            {t('store.view')}
          </a>
        </Button>
        {canEdit && (
          <Button
            className="max-md:hidden"
            disabled={!unpublished || issues.length > 0 || publish.isPending}
            onClick={() => setPublishing(true)}
          >
            {t('theme.publish')}
          </Button>
        )}
      </div>
      <div className="flex flex-col md:grid md:min-h-0 md:flex-1 md:grid-cols-[400px_minmax(0,1fr)] md:border-t md:border-border">
        <div className="flex flex-col gap-2.5 md:gap-3 md:overflow-y-auto md:border-r md:border-border md:p-4">
          {editor}
        </div>
        <div
          {...(previewOpen
            ? { role: 'dialog', 'aria-modal': true, 'aria-label': t('theme.previewTitle') }
            : {})}
          className={cn(
            'flex-col md:flex md:items-center md:gap-3 md:overflow-auto md:bg-muted md:p-4',
            previewOpen ? 'fixed inset-0 z-[60] flex bg-page md:static' : 'hidden',
          )}
        >
          <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background px-2 md:hidden">
            <Button
              ref={closePreview}
              variant="ghost"
              size="icon"
              aria-label={t('theme.closePreview')}
              onClick={() => setPreviewOpen(false)}
            >
              <X aria-hidden />
            </Button>
            <h2 className="mx-1 flex-1 truncate text-base leading-6 font-semibold">
              {t('theme.preview')}
            </h2>
          </header>
          <div
            className={cn(
              'min-h-0 w-full flex-1 overflow-hidden bg-background md:max-w-full md:rounded-[10px] md:border md:border-border md:shadow-[0_10px_30px_rgb(0_0_0/.12)]',
              device === 'phone' && 'md:w-[375px]',
            )}
          >
            {frameBox}
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 z-20 -mx-3 -mb-3 border-t border-border bg-background px-4 py-3 md:hidden">
        <Button
          variant="secondary"
          className="w-full"
          aria-haspopup="dialog"
          onClick={() => setPreviewOpen(true)}
        >
          <Eye aria-hidden />
          {t('theme.preview')}
        </Button>
      </div>
      <ConfirmDialog
        open={preset !== null}
        onOpenChange={(o) => !o && setPreset(null)}
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
    </div>
  );
}

type Panel = 'preset' | 'colors' | 'type' | 'logo' | 'ann' | 'sections' | 'cards' | 'product';

/** A .mm-mode choice: a bordered box, as the presets draw it. */
const modeClass =
  'flex min-h-10 items-center gap-2.5 rounded-lg border border-input bg-background px-2.5 py-2 text-left text-[13px] leading-[18px] hover:bg-accent disabled:opacity-50';

/** One of the editor's folding cards (.mm-acc): only one is open at a time. */
function Accordion({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="m-0 text-sm">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-b`}
          onClick={onToggle}
          className="flex min-h-12 w-full items-center gap-2.5 px-3.5 text-left font-semibold"
        >
          <span className="flex-1">{title}</span>
          {open && <ChevronUp aria-hidden className="size-4 opacity-60" />}
        </button>
      </h2>
      {open && (
        <div id={`${id}-b`} className="flex flex-col gap-3.5 px-3.5 pt-1 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}

function Chips<V extends string>({
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
    <div className="flex flex-col">
      <span id={id} className={fieldLabel}>
        {label}
      </span>
      <fieldset
        aria-labelledby={id}
        disabled={disabled}
        className="m-0 flex flex-wrap gap-1.5 border-0 p-0"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className={chipClass}
          >
            {o.label}
          </button>
        ))}
      </fieldset>
    </div>
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
    <div className="grid grid-cols-[36px_minmax(0,1fr)_112px] items-center gap-2.5">
      <span
        className="relative size-9 overflow-hidden rounded-lg border border-border shadow-[inset_0_0_0_1px_rgb(0_0_0/.04)] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
        style={{ background: value }}
      >
        <input
          type="color"
          aria-label={label}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </span>
      <label htmlFor={id} className="text-[13px] leading-[18px]">
        {label}
      </label>
      <Input
        id={id}
        value={text}
        maxLength={7}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className="h-8 font-mono text-[13px] md:h-8 md:text-[13px]"
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
        }}
      />
    </div>
  );
}
