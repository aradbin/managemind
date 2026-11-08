// Online store > Pages (phase-3-plan §3.5, §7): about, contact, the policies
// and custom pages, with Bangla and English tabs and the description editor
// from Phase 2. Policy pages start with suggested headings (Q12).
import type { RichTextDoc } from '@managemind/shared/rich-text';
import {
  MAX_PAGES,
  PAGE_KINDS,
  PAGE_TITLES,
  type PageKind,
  storePath,
} from '@managemind/shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ExternalLink, Eye, EyeOff, Plus, SquarePen, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { DescriptionField } from '../components/catalog/description-field';
import { LANGUAGE_NAMES, type Lang } from '../components/catalog/language-tabs';
import { ConfirmDialog } from '../components/confirm-dialog';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import { RowMenu, RowMenuItem, RowMenuSeparator } from '../components/list-tools';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { StatusBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Menu, menuContent, menuItem } from '../components/ui/menu';
import { ChoiceChips } from '../components/ui/segmented';
import { SwitchRow } from '../components/ui/switch';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { ApiError, api, unwrap } from '../lib/api';
import { pick, storeSettingsQuery } from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
import { formatDateTime } from '../lib/dates';
import { saveErrorMessage } from '../lib/errors';
import { pageQuery, pagesQuery, type StorePage } from '../lib/online-store';
import { useOpenNew } from '../lib/open-new';
import { cn } from '../lib/utils';

export function StorePagesPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('settings.write');
  const pages = useQuery(pagesQuery);
  const store = useQuery(storeSettingsQuery);
  const [naming, setNaming] = useState(false);
  const [deleting, setDeleting] = useState<StorePage | null>(null);
  useRecordPage(t('pages.title'));
  useOpenNew(
    useCallback(() => setNaming(true), []),
    canWrite && Boolean(pages.data),
  );
  const title = (p: StorePage) => pick(p.translations, locale)?.title ?? '—';
  const open = (p: StorePage) => navigate({ to: '/online-store/pages/$id', params: { id: p.id } });
  const other = (p: StorePage) => pick(p.translations, locale === 'bn' ? 'en' : 'bn')?.title;
  const otherTitle = (p: StorePage) => (other(p) && other(p) !== title(p) ? other(p) : undefined);
  const lang = (store.data?.defaultLocale ?? 'bn') as Lang;
  const create = useCreatePage(lang);
  const shown = (p: StorePage) => (
    <StatusBadge tone={p.published ? 'good' : 'ended'}>
      {p.published ? t('pages.published') : t('pages.hidden')}
    </StatusBadge>
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: pagesQuery.queryKey });
  const setPublished = useMutation({
    mutationFn: async (p: StorePage) =>
      unwrap(
        await api.PATCH('/v1/admin/pages/{id}', {
          params: { path: { id: p.id } },
          body: { published: !p.published },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast(t('onlineStore.purgeNote'));
    },
  });
  const remove = useMutation({
    mutationFn: async (p: StorePage) =>
      unwrap(await api.DELETE('/v1/admin/pages/{id}', { params: { path: { id: p.id } } })),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
    },
  });
  const viewUrl = (p: StorePage) => {
    const slug = p.translations[lang]?.slug ?? pick(p.translations, locale)?.slug;
    return store.data && slug
      ? `${store.data.storeUrl}${storePath({ kind: 'page', slug }, lang, lang)}`
      : undefined;
  };
  const taken = new Set<PageKind>(
    (pages.data ?? []).map((p) => p.kind).filter((k) => k !== 'custom'),
  );
  const full = (pages.data?.length ?? 0) >= MAX_PAGES;
  const newMenu = (phone: boolean) =>
    canWrite && (
      <Menu.Root>
        <Menu.Trigger asChild>
          {phone ? (
            <Button
              variant="ghost"
              size="icon"
              disabled={full || !pages.data}
              aria-label={t('pages.new')}
              title={t('pages.new')}
            >
              <Plus aria-hidden />
            </Button>
          ) : (
            <Button disabled={full || !pages.data}>
              <Plus aria-hidden />
              {t('pages.new')}
              <ChevronDown aria-hidden />
            </Button>
          )}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={4} className={cn(menuContent, 'w-[240px]')}>
            {PAGE_KINDS.map((k) => (
              <Menu.Item
                key={k}
                disabled={taken.has(k) || create.isPending}
                className={menuItem}
                onSelect={() => (k === 'custom' ? setNaming(true) : create.mutate({ kind: k }))}
              >
                <span className="flex-1">{t(`pages.kind.${k}`)}</span>
                {taken.has(k) && <span className="text-xs">{t('pages.kindTaken')}</span>}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    );
  const columns: Column<StorePage>[] = [
    {
      header: t('pages.pageTitle'),
      skeleton: 'lines',
      cell: (p) => (
        <span className="flex min-w-0 flex-col">
          <Link to="/online-store/pages/$id" params={{ id: p.id }} className="truncate font-medium">
            {title(p)}
          </Link>
          {otherTitle(p) && (
            <span className="truncate text-[13px] text-muted-foreground">{otherTitle(p)}</span>
          )}
        </span>
      ),
    },
    {
      header: t('pages.kind'),
      cell: (p) => <span className="text-muted-foreground">{t(`pages.kind.${p.kind}`)}</span>,
    },
    { header: t('pages.status'), skeleton: 'badge', cell: shown },
    {
      header: t('pages.updated'),
      cell: (p) => (
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {formatDateTime(locale, new Date(p.updatedAt), { dateStyle: 'medium' })}
        </span>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PhoneRecordHeader to="/online-store" backLabel={t('theme.back')} title={t('pages.title')}>
        {newMenu(true)}
      </PhoneRecordHeader>
      <PageHeader
        className="mb-0 max-md:hidden"
        title={t('pages.title')}
        description={t('pages.description')}
        parent={{ to: '/online-store', label: t('nav.onlineStore') }}
        actions={newMenu(false)}
      />
      <p className="text-[13px] text-muted-foreground md:hidden">{t('pages.description')}</p>
      {create.isError && (
        <Notice tone="error">
          {create.error instanceof ApiError && create.error.problem?.code === 'limit_exceeded'
            ? t('pages.limit')
            : saveErrorMessage(create.error, t)}
        </Notice>
      )}
      <DataList
        label={t('pages.title')}
        items={pages.data}
        rowKey={(p) => p.id}
        columns={columns}
        grid="minmax(0,1.6fr) minmax(0,1fr) 110px 120px 36px"
        rowHeight={56}
        isPending={pages.isPending}
        error={pages.isError ? saveErrorMessage(pages.error, t) : undefined}
        onRetry={() => pages.refetch()}
        empty={t('pages.empty')}
        onOpen={open}
        menuOnPhone={false}
        menu={(p) => {
          const url = viewUrl(p);
          return (
            <RowMenu label={title(p)}>
              <RowMenuItem onSelect={() => open(p)}>
                <SquarePen aria-hidden />
                {t('action.edit')}
              </RowMenuItem>
              <RowMenuItem
                disabled={!url}
                onSelect={() => url && window.open(url, '_blank', 'noopener')}
              >
                <ExternalLink aria-hidden />
                {t('pages.viewInStore')}
              </RowMenuItem>
              {canWrite && (
                <RowMenuItem onSelect={() => setPublished.mutate(p)}>
                  {p.published ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  {p.published ? t('pages.hide') : t('pages.publish')}
                </RowMenuItem>
              )}
              {canWrite && <RowMenuSeparator />}
              {canWrite && (
                <RowMenuItem danger onSelect={() => setDeleting(p)}>
                  <Trash2 aria-hidden />
                  {t('pages.delete')}
                </RowMenuItem>
              )}
            </RowMenu>
          );
        }}
        card={(p) => (
          <div className="flex min-h-12 items-center gap-2.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <Link
                to="/online-store/pages/$id"
                params={{ id: p.id }}
                className="truncate font-medium"
              >
                {title(p)}
              </Link>
              <span className="truncate text-[13px] text-muted-foreground">
                {t(`pages.kind.${p.kind}`)}
                {otherTitle(p) ? ` · ${otherTitle(p)}` : ''}
              </span>
            </div>
            {shown(p)}
          </div>
        )}
      />
      {pages.data && (
        <p className="text-[13px] text-muted-foreground max-md:hidden">
          {t('pages.countNote', { count: pages.data.length, max: MAX_PAGES })}
        </p>
      )}
      {naming && (
        <NameNewPage
          lang={lang}
          busy={create.isPending}
          onClose={() => setNaming(false)}
          onCreate={(name) => create.mutate({ kind: 'custom', title: name })}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('pages.deleteConfirm', { title: deleting ? title(deleting) : '' })}
        confirmLabel={t('pages.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        <p>{t('pages.deleteBody')}</p>
      </ConfirmDialog>
    </div>
  );
}

/** Adds a page of a kind, titled from the kind (a custom page by its name), and opens it. */
function useCreatePage(lang: Lang) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, title }: { kind: PageKind; title?: string }) =>
      unwrap(
        await api.POST('/v1/admin/pages', {
          body: {
            kind,
            published: false,
            translations:
              kind === 'custom'
                ? { [lang]: { title: title ?? '' } }
                : { bn: { title: PAGE_TITLES[kind].bn }, en: { title: PAGE_TITLES[kind].en } },
          },
        }),
      ),
    onSuccess: async (page) => {
      await queryClient.invalidateQueries({ queryKey: pagesQuery.queryKey });
      await navigate({ to: '/online-store/pages/$id', params: { id: page.id } });
    },
  });
}

/** "Other page" needs its name first. */
function NameNewPage({
  lang,
  busy,
  onClose,
  onCreate,
}: {
  lang: Lang;
  busy: boolean;
  onClose: () => void;
  onCreate: (title: string) => void;
}) {
  const { t } = useLocale();
  const [title, setTitle] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('pages.kind.custom')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onCreate(title.trim());
        }}
      >
        <Field
          label={t('pages.titleIn', { language: LANGUAGE_NAMES[lang] })}
          lang={lang}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={!title.trim() || busy}>
            {t('pages.new')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function StorePageEditorPage({ id }: { id: string }) {
  const { t, locale } = useLocale();
  const page = useQuery(pageQuery(id));
  const store = useQuery(storeSettingsQuery);
  const title = page.data
    ? (pick(page.data.translations, locale)?.title ?? t(`pages.kind.${page.data.kind}`))
    : undefined;
  useRecordPage(title);
  return (
    <div className="flex w-full max-w-[860px] flex-col gap-3 md:gap-4">
      <PhoneRecordHeader
        to="/online-store/pages"
        backLabel={t('pages.backToPages')}
        title={title ?? t('pages.title')}
      />
      {page.isPending || store.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : page.isError ? (
        <Notice tone="error">
          {page.error instanceof ApiError && page.error.status === 404
            ? t('pages.notFound')
            : saveErrorMessage(page.error, t)}
        </Notice>
      ) : store.isError ? (
        <Notice tone="error">{saveErrorMessage(store.error, t)}</Notice>
      ) : (
        <PageEditor
          key={page.data.id}
          page={page.data}
          title={title ?? ''}
          defaultLang={store.data.defaultLocale}
          storeUrl={store.data.storeUrl}
        />
      )}
    </div>
  );
}

type Draft = Record<
  Lang,
  {
    title: string;
    slug: string;
    body: RichTextDoc | null;
    present: boolean;
    /** The text was changed here: a templated page sends it only then. */
    edited: boolean;
  }
>;

function PageEditor({
  page,
  title,
  defaultLang,
  storeUrl,
}: {
  page: StorePage;
  title: string;
  defaultLang: Lang;
  storeUrl: string;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = usePermission('settings.write');
  const [active, setActive] = useState<Lang>(defaultLang);
  const [deleting, setDeleting] = useState(false);
  const initial = (p: StorePage) => {
    const from = (lang: Lang) => {
      const tr = p.translations[lang];
      return {
        title: tr?.title ?? '',
        slug: tr?.slug ?? '',
        body: (tr?.body as RichTextDoc | null) ?? null,
        present: Boolean(tr),
        edited: false,
      };
    };
    return { published: p.published, draft: { bn: from('bn'), en: from('en') } as Draft };
  };
  const [published, setPublished] = useState(page.published);
  const [draft, setDraft] = useState<Draft>(() => initial(page).draft);
  // A templated page shows a note until someone takes its text over.
  const [own, setOwn] = useState(!page.followsTemplate);
  const current = JSON.stringify({ published, draft, own });
  const [snapshot, setSnapshot] = useState(current);
  const set = (lang: Lang, patch: Partial<Draft[Lang]>) =>
    setDraft((d) => ({
      ...d,
      [lang]: { ...d[lang], ...patch, present: true, edited: d[lang].edited || 'body' in patch },
    }));
  const discard = () => {
    const back = JSON.parse(snapshot) as { published: boolean; draft: Draft; own: boolean };
    setPublished(back.published);
    setDraft(back.draft);
    setOwn(back.own);
  };

  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH('/v1/admin/pages/{id}', {
          params: { path: { id: page.id } },
          body: {
            published,
            translations: Object.fromEntries(
              (['bn', 'en'] as const)
                .filter((lang) => draft[lang].present)
                .map((lang) => {
                  const d = draft[lang];
                  if (!d.title.trim())
                    return [lang, lang === defaultLang ? { title: d.title } : null];
                  // A templated page keeps following its template until its text is edited.
                  const body = !page.followsTemplate || d.edited ? { body: d.body } : {};
                  return [
                    lang,
                    { title: d.title.trim(), ...(d.slug ? { slug: d.slug } : {}), ...body },
                  ];
                }),
            ),
          },
        }),
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(pageQuery(page.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: pagesQuery.queryKey });
      setSnapshot(current);
      toast(t('onlineStore.purgeNote'));
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(await api.DELETE('/v1/admin/pages/{id}', { params: { path: { id: page.id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pagesQuery.queryKey });
      await navigate({ to: '/online-store/pages' });
    },
  });
  const slug = draft[active].slug || page.translations[active]?.slug || '';
  const path = slug ? storePath({ kind: 'page', slug }, active, defaultLang) : '';
  const host = new URL(storeUrl).host;
  const savedSlug = page.translations[defaultLang]?.slug;
  const viewUrl = savedSlug
    ? `${storeUrl}${storePath({ kind: 'page', slug: savedSlug }, defaultLang, defaultLang)}`
    : undefined;
  const disabled = !canWrite || save.isPending;
  return (
    <form
      className="flex flex-col gap-3 md:gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PageHeader
        className="mb-0 max-md:hidden"
        title={title}
        description={t('onlineStore.purgeNote')}
        parent={{ to: '/online-store/pages', label: t('pages.backToPages') }}
        actions={
          viewUrl && (
            <Button asChild variant="secondary">
              <a href={viewUrl} target="_blank" rel="noopener">
                <ExternalLink aria-hidden />
                {t('pages.view')}
              </a>
            </Button>
          )
        }
      />
      <p className="text-[13px] text-muted-foreground md:hidden">{t('onlineStore.purgeNote')}</p>
      {!canWrite && <Notice>{t('store.readOnly')}</Notice>}
      <section aria-labelledby="page-card" className={cardPadded}>
        <h2 id="page-card" className={cardTitle}>
          {t('pages.kind')}
        </h2>
        <ChoiceChips
          label={t('pages.language')}
          value={active}
          options={(['bn', 'en'] as const).map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))}
          onChange={setActive}
        />
        <Field
          key={`title-${active}`}
          label={t('pages.titleIn', { language: LANGUAGE_NAMES[active] })}
          lang={active}
          maxLength={120}
          disabled={disabled}
          value={draft[active].title}
          onChange={(e) => set(active, { title: e.target.value })}
        />
        {own ? (
          <DescriptionField
            key={active}
            lang={active}
            label={t('pages.body')}
            disabled={disabled}
            value={draft[active].body}
            onChange={(body) => set(active, { body })}
          />
        ) : (
          <div className="flex flex-col items-start gap-2.5 rounded-[10px] bg-muted px-3.5 py-3 text-[13px]">
            <p>{t('pages.followsTemplate')}</p>
            <Button
              variant="secondary"
              className="h-8 bg-background md:h-8"
              disabled={disabled}
              onClick={() => setOwn(true)}
            >
              <SquarePen aria-hidden />
              {t('pages.editText')}
            </Button>
          </div>
        )}
      </section>
      <section aria-labelledby="page-visibility" className={cardPadded}>
        <h2 id="page-visibility" className={cardTitle}>
          {t('pages.visibility')}
        </h2>
        <SwitchRow
          label={t('pages.published')}
          hint={t('pages.publishedHint')}
          checked={published}
          disabled={disabled}
          onCheckedChange={setPublished}
        />
        <Field
          key={`slug-${active}`}
          label={t('product.slug')}
          hint={`${path ? `${host}${path}. ` : ''}${t('product.slugHint')}`}
          maxLength={120}
          disabled={disabled}
          value={draft[active].slug}
          onChange={(e) => set(active, { slug: e.target.value })}
        />
      </section>
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {canWrite && (
        <Button
          variant="ghost"
          className="self-start text-danger hover:text-danger"
          onClick={() => setDeleting(true)}
        >
          <Trash2 aria-hidden />
          {t('pages.delete')}
        </Button>
      )}
      <SaveBar
        show={canWrite && current !== snapshot}
        message={t('form.unsaved')}
        discardLabel={t('action.discard')}
        onDiscard={discard}
        saveLabel={t('action.save')}
        busy={save.isPending}
        onSave={() => save.mutate()}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('pages.deleteConfirm', { title })}
        confirmLabel={t('pages.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('pages.deleteBody')}</p>
      </ConfirmDialog>
    </form>
  );
}
