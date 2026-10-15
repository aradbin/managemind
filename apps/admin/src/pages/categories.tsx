// Categories (phase-2-plan §3.3, §3.4, §7): the tree with add, rename, move
// and reorder, and each category's attribute template. At most 3 levels.
import { CATALOG_LIMITS } from '@managemind/shared/catalog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { LANGUAGE_NAMES, type Lang, otherLang } from '../components/catalog/language-tabs';
import { CatalogNav } from '../components/catalog-nav';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import {
  attributesQuery,
  type Category,
  categoriesQuery,
  pick,
  storeSettingsQuery,
} from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';

type Editing =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'edit'; category: Category }
  | null;

export function CategoriesPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('catalog.write');
  const categories = useQuery(categoriesQuery);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [template, setTemplate] = useState<Category | null>(null);
  const all = categories.data ?? [];
  const children = (parentId: string | null) =>
    all.filter((c) => c.parentId === parentId).sort((a, b) => a.position - b.position);

  const refresh = () => queryClient.invalidateQueries({ queryKey: categoriesQuery.queryKey });
  const move = useMutation({
    mutationFn: async ({ category, position }: { category: Category; position: number }) =>
      unwrap(
        await api.POST('/v1/admin/categories/{id}/move', {
          params: { path: { id: category.id } },
          body: { parentId: category.parentId, position },
        }),
      ),
    onSuccess: refresh,
    onError: (e) => toast(saveErrorMessage(e, t)),
  });
  const remove = useMutation({
    mutationFn: async (category: Category) =>
      unwrap(
        await api.DELETE('/v1/admin/categories/{id}', { params: { path: { id: category.id } } }),
      ),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
      toast(t('categories.deleted'));
    },
  });

  const renderLevel = (parentId: string | null) => {
    const list = children(parentId);
    if (!list.length) return null;
    return (
      <ul className={parentId ? 'ml-4 border-l border-border pl-3' : 'flex flex-col gap-1'}>
        {list.map((c, i) => (
          <li key={c.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md p-2 hover:bg-muted">
              <span>
                <span className="font-medium">{pick(c.translations, locale)?.name ?? '—'}</span>
                <span className="ml-2 text-sm text-muted-foreground">
                  {t('categories.productCount', { count: c.productCount })}
                </span>
              </span>
              {canWrite && (
                <span className="flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={i === 0 || move.isPending}
                    aria-label={t('categories.up', {
                      name: pick(c.translations, locale)?.name ?? '',
                    })}
                    onClick={() => move.mutate({ category: c, position: i - 1 })}
                  >
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={i === list.length - 1 || move.isPending}
                    aria-label={t('categories.down', {
                      name: pick(c.translations, locale)?.name ?? '',
                    })}
                    onClick={() => move.mutate({ category: c, position: i + 1 })}
                  >
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('categories.edit', {
                      name: pick(c.translations, locale)?.name ?? '',
                    })}
                    onClick={() => setEditing({ mode: 'edit', category: c })}
                  >
                    <Pencil aria-hidden className="size-4" />
                  </Button>
                  {c.depth < CATALOG_LIMITS.categoryDepth - 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('categories.addChild', {
                        name: pick(c.translations, locale)?.name ?? '',
                      })}
                      onClick={() => setEditing({ mode: 'create', parentId: c.id })}
                    >
                      <Plus aria-hidden className="size-4" />
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setTemplate(c)}>
                    {t('categories.template', { count: c.attributeIds.length })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('categories.delete', {
                      name: pick(c.translations, locale)?.name ?? '',
                    })}
                    onClick={() => setDeleting(c)}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </span>
              )}
            </div>
            {renderLevel(c.id)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={t('catalog.categories')}
        description={t('categories.intro')}
        actions={
          canWrite && (
            <Button onClick={() => setEditing({ mode: 'create', parentId: null })}>
              <Plus aria-hidden className="size-4" />
              {t('categories.new')}
            </Button>
          )
        }
      />
      <CatalogNav />
      {categories.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : categories.isError ? (
        <Notice tone="error">{errorMessage(categories.error, t)}</Notice>
      ) : all.length === 0 ? (
        <p className="text-muted-foreground">{t('categories.empty')}</p>
      ) : (
        <nav aria-label={t('catalog.categories')}>{renderLevel(null)}</nav>
      )}
      {editing && <CategoryDialog editing={editing} onClose={() => setEditing(null)} />}
      {template && <TemplateDialog category={template} onClose={() => setTemplate(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('categories.deleteTitle')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        <p>
          {t('categories.deleteBody', { name: pick(deleting?.translations, locale)?.name ?? '' })}
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** Create or rename: a name (and optional URL) in each language. */
function CategoryDialog({
  editing,
  onClose,
}: {
  editing: NonNullable<Editing>;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const store = useQuery(storeSettingsQuery);
  const defaultLang: Lang = store.data?.defaultLocale ?? 'bn';
  const initial = editing.mode === 'edit' ? editing.category.translations : {};
  const [names, setNames] = useState<Record<Lang, string>>({
    bn: initial.bn?.name ?? '',
    en: initial.en?.name ?? '',
  });
  const [slugs, setSlugs] = useState<Record<Lang, string>>({
    bn: initial.bn?.slug ?? '',
    en: initial.en?.slug ?? '',
  });
  const save = useMutation({
    mutationFn: async () => {
      const translations = Object.fromEntries(
        (['bn', 'en'] as const).map((l) => [
          l,
          names[l].trim()
            ? { name: names[l], ...(slugs[l].trim() ? { slug: slugs[l].trim() } : {}) }
            : editing.mode === 'edit' && initial[l]
              ? null
              : undefined,
        ]),
      );
      if (editing.mode === 'create') {
        return unwrap(
          await api.POST('/v1/admin/categories', {
            body: { parentId: editing.parentId, translations: translations as never },
          }),
        );
      }
      return unwrap(
        await api.PATCH('/v1/admin/categories/{id}', {
          params: { path: { id: editing.category.id } },
          body: { translations: translations as never },
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: categoriesQuery.queryKey });
      toast(t('categories.saved'));
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={editing.mode === 'create' ? t('categories.new') : t('categories.rename')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {[defaultLang, otherLang(defaultLang)].map((l) => (
          <div key={l} className="flex flex-col gap-3">
            <Field
              lang={l}
              label={`${t('categories.name')} (${LANGUAGE_NAMES[l]}${l === defaultLang ? '' : `, ${t('form.optional')}`})`}
              value={names[l]}
              maxLength={100}
              required={l === defaultLang}
              onChange={(e) => setNames({ ...names, [l]: e.target.value })}
            />
            {editing.mode === 'edit' && (
              <Field
                label={`${t('product.slug')} (${LANGUAGE_NAMES[l]})`}
                hint={t('product.slugHint')}
                value={slugs[l]}
                onChange={(e) => setSlugs({ ...slugs, [l]: e.target.value })}
              />
            )}
          </div>
        ))}
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending || !names[defaultLang].trim()}>
            {t('action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The attributes a category's products usually have, in order (§3.4). */
function TemplateDialog({ category, onClose }: { category: Category; onClose: () => void }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const attributes = useQuery(attributesQuery);
  const [chosen, setChosen] = useState<string[]>(category.attributeIds);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT('/v1/admin/categories/{id}/attributes', {
          params: { path: { id: category.id } },
          body: chosen,
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: categoriesQuery.queryKey });
      await queryClient.invalidateQueries({ queryKey: ['template-attributes'] });
      toast(t('categories.templateSaved'));
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('categories.templateTitle', {
        name: pick(category.translations, locale)?.name ?? '',
      })}
      description={t('categories.templateIntro')}
    >
      {attributes.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">{t('catalog.attributes')}</legend>
            {(attributes.data ?? []).map((a) => (
              <label key={a.id} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={chosen.includes(a.id)}
                  onChange={(e) =>
                    setChosen(
                      e.target.checked ? [...chosen, a.id] : chosen.filter((x) => x !== a.id),
                    )
                  }
                />
                {pick(a.name, locale) ?? a.key}
              </label>
            ))}
          </fieldset>
          {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="ghost" onClick={onClose}>
              {t('action.cancel')}
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {t('action.save')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
