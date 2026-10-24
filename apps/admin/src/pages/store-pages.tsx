// Online store > Pages (phase-3-plan §3.5, §7): about, contact, the policies
// and custom pages, with Bangla and English tabs and the description editor
// from Phase 2. Policy pages start with suggested headings (Q12).

import type { RichTextDoc } from '@managemind/shared/rich-text';
import { MAX_PAGES, PAGE_KINDS, PAGE_TITLES, type PageKind } from '@managemind/shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { DescriptionField } from '../components/catalog/description-field';
import { LANGUAGE_NAMES, type Lang, LanguageTabs } from '../components/catalog/language-tabs';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { ApiError, api, unwrap } from '../lib/api';
import { pick, storeSettingsQuery } from '../lib/catalog';
import { saveErrorMessage } from '../lib/errors';
import { pageQuery, pagesQuery, type StorePage } from '../lib/online-store';

export function StorePagesPage() {
  const { t, locale } = useLocale();
  const canWrite = usePermission('settings.write');
  const pages = useQuery(pagesQuery);
  const [adding, setAdding] = useState(false);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={t('pages.title')}
        description={t('pages.description')}
        actions={
          canWrite && (
            <Button
              disabled={(pages.data?.length ?? 0) >= MAX_PAGES}
              onClick={() => setAdding(true)}
            >
              <Plus aria-hidden className="size-4" />
              {t('pages.new')}
            </Button>
          )
        }
      />
      {pages.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : pages.isError ? (
        <Notice tone="error">{saveErrorMessage(pages.error, t)}</Notice>
      ) : pages.data.length === 0 ? (
        <Notice>{t('pages.empty')}</Notice>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {pages.data.map((p) => (
            <li key={p.id} className="flex min-h-16 items-center justify-between gap-3 p-4">
              <span className="flex flex-col">
                <Link
                  to="/online-store/pages/$id"
                  params={{ id: p.id }}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {pick(p.translations, locale)?.title ?? '—'}
                </Link>
                <span className="text-sm text-muted-foreground">{t(`pages.kind.${p.kind}`)}</span>
              </span>
              <span className="text-sm">
                {p.published ? t('pages.published') : t('pages.hidden')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding && pages.data && <NewPage existing={pages.data} onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewPage({ existing, onClose }: { existing: StorePage[]; onClose: () => void }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const store = useQuery(storeSettingsQuery);
  const id = useId();
  const taken = new Set<PageKind>(existing.map((p) => p.kind).filter((k) => k !== 'custom'));
  const [kind, setKind] = useState<PageKind>(PAGE_KINDS.find((k) => !taken.has(k)) ?? 'custom');
  const [title, setTitle] = useState('');
  const lang = (store.data?.defaultLocale ?? 'bn') as Lang;
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/pages', {
          body: {
            kind,
            published: false,
            translations: {
              [lang]: { title: title.trim() || (kind !== 'custom' ? PAGE_TITLES[kind][lang] : '') },
              ...(kind !== 'custom' && lang === 'bn'
                ? { en: { title: PAGE_TITLES[kind].en } }
                : {}),
              ...(kind !== 'custom' && lang === 'en'
                ? { bn: { title: PAGE_TITLES[kind].bn } }
                : {}),
            },
          },
        }),
      ),
    onSuccess: async (page) => {
      await queryClient.invalidateQueries({ queryKey: pagesQuery.queryKey });
      await navigate({ to: '/online-store/pages/$id', params: { id: page.id } });
    },
  });
  const needsTitle = kind === 'custom' && !title.trim();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('pages.new')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!needsTitle) create.mutate();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            {t('pages.kind')}
          </label>
          <select
            id={id}
            value={kind}
            onChange={(e) => setKind(e.target.value as PageKind)}
            className="min-h-11 rounded-lg border border-input bg-background px-3 text-base"
          >
            {PAGE_KINDS.map((k) => (
              <option key={k} value={k} disabled={taken.has(k)}>
                {t(`pages.kind.${k}`)}
                {taken.has(k) ? ` (${t('pages.kindTaken')})` : ''}
              </option>
            ))}
          </select>
        </div>
        <Field
          label={t('pages.titleIn', { language: LANGUAGE_NAMES[lang] })}
          lang={lang}
          maxLength={120}
          value={title}
          placeholder={kind !== 'custom' ? PAGE_TITLES[kind][lang] : undefined}
          onChange={(e) => setTitle(e.target.value)}
        />
        {create.isError && (
          <Notice tone="error">
            {create.error instanceof ApiError && create.error.problem?.code === 'limit_exceeded'
              ? t('pages.limit')
              : saveErrorMessage(create.error, t)}
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={needsTitle || create.isPending}>
            {t('pages.new')}
          </Button>
        </div>
      </form>
    </Dialog>
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

export function StorePageEditorPage({ id }: { id: string }) {
  const { t } = useLocale();
  const page = useQuery(pageQuery(id));
  const store = useQuery(storeSettingsQuery);
  return (
    <div className="max-w-3xl">
      <Link
        to="/online-store/pages"
        className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('pages.back')}
      </Link>
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
        <PageEditor page={page.data} defaultLang={store.data.defaultLocale} />
      )}
    </div>
  );
}

function PageEditor({ page, defaultLang }: { page: StorePage; defaultLang: Lang }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = usePermission('settings.write');
  const [active, setActive] = useState<Lang>(defaultLang);
  const [published, setPublished] = useState(page.published);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => {
    const from = (lang: Lang) => {
      const tr = page.translations[lang];
      return {
        title: tr?.title ?? '',
        slug: tr?.slug ?? '',
        body: (tr?.body as RichTextDoc | null) ?? null,
        present: Boolean(tr),
        edited: false,
      };
    };
    return { bn: from('bn'), en: from('en') };
  });
  const set = (lang: Lang, patch: Partial<Draft[Lang]>) =>
    setDraft((d) => ({
      ...d,
      [lang]: { ...d[lang], ...patch, present: true, edited: d[lang].edited || 'body' in patch },
    }));

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
  const title = pick(page.translations, locale)?.title ?? t(`pages.kind.${page.kind}`);
  return (
    <>
      <PageHeader title={title} description={t(`pages.kind.${page.kind}`)} />
      {page.followsTemplate && <Notice>{t('pages.followsTemplate')}</Notice>}
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={!canWrite || save.isPending} className="flex flex-col gap-5">
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              className="mt-3 size-5"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
            />
            <span className="flex flex-col justify-center">
              <span className="font-medium">{t('pages.published')}</span>
              <span className="text-sm text-muted-foreground">{t('pages.publishedHint')}</span>
            </span>
          </label>
          <LanguageTabs
            defaultLang={defaultLang}
            active={active}
            onChange={setActive}
            present={new Set((['bn', 'en'] as const).filter((l) => draft[l].present))}
          >
            {(lang) => (
              <div className="flex flex-col gap-4">
                <Field
                  label={t('pages.titleIn', { language: LANGUAGE_NAMES[lang] })}
                  maxLength={120}
                  value={draft[lang].title}
                  onChange={(e) => set(lang, { title: e.target.value })}
                />
                <Field
                  label={t('product.slug')}
                  hint={t('product.slugHint')}
                  maxLength={120}
                  value={draft[lang].slug}
                  onChange={(e) => set(lang, { slug: e.target.value })}
                />
                <DescriptionField
                  key={lang}
                  lang={lang}
                  label={t('pages.body')}
                  value={draft[lang].body}
                  onChange={(body) => set(lang, { body })}
                />
              </div>
            )}
          </LanguageTabs>
        </fieldset>
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        {canWrite && (
          <div className="flex flex-wrap justify-between gap-2">
            <Button type="submit" disabled={save.isPending}>
              {t('action.save')}
            </Button>
            <Button variant="ghost" className="text-danger" onClick={() => setDeleting(true)}>
              {t('pages.delete')}
            </Button>
          </div>
        )}
      </form>
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
    </>
  );
}
