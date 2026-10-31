// Categories (phase-2-plan §3.3, §3.4, §7; ADR 0033): the tree as a table
// that opens and closes, searched by name, with a row menu to add under, move
// up or down, and delete. A category is made and edited in one side panel: its
// names, where it sits, its descriptions, its specifications (the attributes
// its products usually have) and its web addresses. At most 3 levels.
import { CATALOG_LIMITS } from '@managemind/shared/catalog';
import type { RichTextDoc } from '@managemind/shared/rich-text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsUpDown,
  FolderPlus,
  Plus,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { type MouseEvent, useId, useMemo, useState } from 'react';
import { DescriptionField } from '../components/catalog/description-field';
import { LANGUAGE_NAMES, type Lang, LanguageTabs } from '../components/catalog/language-tabs';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { RowMenu, RowMenuItem, RowMenuSeparator, SearchInput } from '../components/list-tools';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { control } from '../components/ui/input';
import { Sheet, SheetBody, SheetDelete, SheetFooter, SheetForm } from '../components/ui/sheet';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import {
  attributesQuery,
  type Category,
  categoriesQuery,
  categoryOptions,
  pick,
  storeSettingsQuery,
} from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { cn } from '../lib/utils';

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
  const attributes = useQuery(attributesQuery);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [q, setQ] = useState('');
  /** Open rows; the top level starts open. */
  const [open, setOpen] = useState<ReadonlySet<string> | 'all' | null>(null);
  const all = categories.data ?? [];
  const name = (c: Category | null | undefined) => pick(c?.translations, locale)?.name ?? '—';
  const children = (parentId: string | null) =>
    all.filter((c) => c.parentId === parentId).sort((a, b) => a.position - b.position);
  const isOpen = (c: Category) =>
    open === 'all' || (open === null ? c.depth === 0 : open.has(c.id));
  const toggle = (c: Category) =>
    setOpen((prev) => {
      const base =
        prev === 'all'
          ? new Set(all.map((x) => x.id))
          : prev === null
            ? new Set(all.filter((x) => x.depth === 0).map((x) => x.id))
            : new Set(prev);
      if (base.has(c.id)) base.delete(c.id);
      else base.add(c.id);
      return base;
    });

  // A search shows the matches and the categories above them.
  const words = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!words) return null;
    const keep = new Set<string>();
    for (const c of all) {
      const names = [c.translations.bn?.name, c.translations.en?.name].join(' ').toLowerCase();
      if (!names.includes(words)) continue;
      for (let at: Category | undefined = c; at; at = all.find((x) => x.id === at?.parentId)) {
        keep.add(at.id);
      }
    }
    return keep;
  }, [all, words]);

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
      setEditing(null);
      await refresh();
      toast(t('categories.deleted'));
    },
  });
  const specs = (c: Category) =>
    c.attributeIds
      .map((id) => pick(attributes.data?.find((a) => a.id === id)?.name, locale))
      .filter(Boolean)
      .join(', ') || '—';

  /** The rows in tree order, each with its siblings for moving. */
  const rows: { c: Category; i: number; siblings: number }[] = [];
  const walk = (parentId: string | null) => {
    const list = children(parentId).filter((c) => !shown || shown.has(c.id));
    list.forEach((c, i) => {
      rows.push({ c, i, siblings: list.length });
      if (shown || isOpen(c)) walk(c.id);
    });
  };
  walk(null);
  const top = children(null).length;
  const edit = (c: Category) => canWrite && setEditing({ mode: 'edit', category: c });
  const onRow = (c: Category) => (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('a, button, input, [role="menuitem"]')) edit(c);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t('catalog.categories')}
        description={t('categories.intro')}
        actions={
          canWrite && (
            <Button onClick={() => setEditing({ mode: 'create', parentId: null })}>
              <Plus aria-hidden />
              {t('categories.new')}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-64 md:flex-none"
          label={t('categories.search')}
          value={q}
          onChange={setQ}
        />
        {!words && all.some((c) => c.depth > 0) && (
          <Button variant="ghost" onClick={() => setOpen(open === 'all' ? new Set() : 'all')}>
            <ChevronsUpDown aria-hidden />
            {open === 'all' ? t('categories.collapseAll') : t('categories.expandAll')}
          </Button>
        )}
        {all.length > 0 && (
          <span className="ml-auto text-sm text-muted-foreground">
            {t('categories.count', { count: all.length, top })}
          </span>
        )}
      </div>
      {categories.isPending ? (
        <p
          role="status"
          className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground"
        >
          {t('loading')}
        </p>
      ) : categories.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-10">
          <Notice tone="error">{errorMessage(categories.error, t)}</Notice>
          <Button variant="secondary" onClick={() => categories.refetch()}>
            {t('action.retry')}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {words ? t('categories.noMatches') : t('categories.empty')}
          </p>
          {words ? (
            <Button variant="secondary" onClick={() => setQ('')}>
              {t('list.resetFilters')}
            </Button>
          ) : (
            canWrite && (
              <Button
                variant="secondary"
                onClick={() => setEditing({ mode: 'create', parentId: null })}
              >
                {t('categories.new')}
              </Button>
            )
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('catalog.categories')}</caption>
            <thead className="border-b border-border bg-muted/60">
              <tr>
                <th scope="col" className="h-10 px-4 font-medium">
                  {t('categories.name')}
                </th>
                <th scope="col" className="h-10 px-4 text-right font-medium">
                  {t('catalog.products')}
                </th>
                <th scope="col" className="hidden h-10 px-4 font-medium md:table-cell">
                  {t('categories.specs')}
                </th>
                <th className="w-12">
                  <span className="sr-only">{t('list.rowActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ c, i, siblings }) => {
                const kids = children(c.id).length;
                const expanded = Boolean(shown) || isOpen(c);
                return (
                  <tr
                    key={c.id}
                    onClick={onRow(c)}
                    className={cn('hover:bg-muted/50', canWrite && 'cursor-pointer')}
                  >
                    <td
                      className="h-12 py-2 pr-4"
                      style={{ paddingLeft: `${1 + c.depth * 1.5}rem` }}
                    >
                      <span className="flex items-center gap-1">
                        {kids > 0 ? (
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={t('categories.toggle', { name: name(c) })}
                            disabled={Boolean(shown)}
                            onClick={() => toggle(c)}
                            className="-ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                          >
                            <ChevronRight
                              aria-hidden
                              className={cn('size-4 transition-transform', expanded && 'rotate-90')}
                            />
                          </button>
                        ) : (
                          <span aria-hidden className="w-5 shrink-0" />
                        )}
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => edit(c)}
                            className="text-left font-medium underline-offset-2 hover:underline"
                          >
                            {name(c)}
                          </button>
                        ) : (
                          <span className="font-medium">{name(c)}</span>
                        )}
                        {kids > 0 && !expanded && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {t('categories.subcount', { count: kids })}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 text-right tabular-nums">{c.productCount}</td>
                    <td className="hidden px-4 text-muted-foreground md:table-cell">{specs(c)}</td>
                    <td className="w-12 pr-2 text-right">
                      {canWrite && (
                        <RowMenu label={name(c)}>
                          <RowMenuItem onSelect={() => edit(c)}>
                            <SquarePen aria-hidden />
                            {t('categories.editTitle')}
                          </RowMenuItem>
                          {c.depth < CATALOG_LIMITS.categoryDepth - 1 && (
                            <RowMenuItem
                              onSelect={() => setEditing({ mode: 'create', parentId: c.id })}
                            >
                              <FolderPlus aria-hidden />
                              {t('categories.addSub')}
                            </RowMenuItem>
                          )}
                          <RowMenuItem
                            disabled={i === 0 || move.isPending}
                            onSelect={() => move.mutate({ category: c, position: i - 1 })}
                          >
                            <ArrowUp aria-hidden />
                            {t('categories.moveUp')}
                          </RowMenuItem>
                          <RowMenuItem
                            disabled={i === siblings - 1 || move.isPending}
                            onSelect={() => move.mutate({ category: c, position: i + 1 })}
                          >
                            <ArrowDown aria-hidden />
                            {t('categories.moveDown')}
                          </RowMenuItem>
                          <RowMenuSeparator />
                          <RowMenuItem danger onSelect={() => setDeleting(c)}>
                            <Trash2 aria-hidden />
                            {t('action.delete')}
                          </RowMenuItem>
                        </RowMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CategorySheet
          editing={editing}
          onClose={() => setEditing(null)}
          onDelete={editing.mode === 'edit' ? () => setDeleting(editing.category) : undefined}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('categories.deleteTitle')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        <p>{t('categories.deleteBody', { name: name(deleting) })}</p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * Create or edit, in a side panel: a name and description in each language,
 * where the category sits, its specifications, and (when editing) its web
 * addresses. Moving it under another puts it at the end of that list.
 */
function CategorySheet({
  editing,
  onClose,
  onDelete,
}: {
  editing: NonNullable<Editing>;
  onClose: () => void;
  onDelete?: (() => void) | undefined;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const store = useQuery(storeSettingsQuery);
  const categories = useQuery(categoriesQuery);
  const attributes = useQuery(attributesQuery);
  const defaultLang: Lang = store.data?.defaultLocale ?? 'bn';
  const self = editing.mode === 'edit' ? editing.category : null;
  const initial = self?.translations ?? {};
  const [lang, setLang] = useState<Lang>(defaultLang);
  const [names, setNames] = useState<Record<Lang, string>>({
    bn: initial.bn?.name ?? '',
    en: initial.en?.name ?? '',
  });
  const [slugs, setSlugs] = useState<Record<Lang, string>>({
    bn: initial.bn?.slug ?? '',
    en: initial.en?.slug ?? '',
  });
  // Only a description that was changed is sent; one left alone stays.
  const [descriptions, setDescriptions] = useState<Partial<Record<Lang, RichTextDoc>>>({});
  const [parentId, setParentId] = useState<string>(
    self?.parentId ?? (editing.mode === 'create' ? (editing.parentId ?? '') : ''),
  );
  const [chosen, setChosen] = useState<string[]>(self?.attributeIds ?? []);
  const [tried, setTried] = useState(false);
  const parentField = useId();
  // Not itself or anything under it: that would make a loop. Not the third level either.
  const all = categories.data ?? [];
  const below = new Set<string>(self ? [self.id] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of all) {
      if (c.parentId && below.has(c.parentId) && !below.has(c.id)) {
        below.add(c.id);
        grew = true;
      }
    }
  }
  const parents = categoryOptions(all, locale).filter(
    (o) =>
      !below.has(o.id) &&
      (all.find((c) => c.id === o.id)?.depth ?? 0) < CATALOG_LIMITS.categoryDepth - 1,
  );
  const ready = names[defaultLang].trim() !== '';
  const save = useMutation({
    mutationFn: async () => {
      const translations = Object.fromEntries(
        (['bn', 'en'] as const).map((l) => [
          l,
          names[l].trim()
            ? {
                name: names[l],
                ...(slugs[l].trim() ? { slug: slugs[l].trim() } : {}),
                ...(descriptions[l] ? { description: descriptions[l] } : {}),
              }
            : self && initial[l]
              ? null
              : undefined,
        ]),
      );
      let saved: Category;
      if (!self) {
        saved = unwrap(
          await api.POST('/v1/admin/categories', {
            body: { parentId: parentId || null, translations: translations as never },
          }),
        );
      } else {
        saved = unwrap(
          await api.PATCH('/v1/admin/categories/{id}', {
            params: { path: { id: self.id } },
            body: { translations: translations as never },
          }),
        );
        if ((self.parentId ?? '') !== parentId) {
          saved = unwrap(
            await api.POST('/v1/admin/categories/{id}/move', {
              params: { path: { id: self.id } },
              body: { parentId: parentId || null },
            }),
          );
        }
      }
      const before = self?.attributeIds ?? [];
      if (chosen.join() !== before.join()) {
        unwrap(
          await api.PUT('/v1/admin/categories/{id}/attributes', {
            params: { path: { id: saved.id } },
            body: chosen,
          }),
        );
      }
      return saved;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: categoriesQuery.queryKey });
      await queryClient.invalidateQueries({ queryKey: ['template-attributes'] });
      toast(t('categories.saved'));
      onClose();
    },
  });
  const path = self ? categoryOptions(all, locale).find((o) => o.id === self.id)?.label : undefined;
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={self ? t('categories.editTitle') : t('categories.new')}
      description={
        self
          ? `${path ?? ''} · ${t('categories.productCount', { count: self.productCount })}`
          : undefined
      }
    >
      <SheetForm
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!ready) {
            setLang(defaultLang);
            return;
          }
          save.mutate();
        }}
      >
        <SheetBody>
          <LanguageTabs
            defaultLang={defaultLang}
            active={lang}
            onChange={setLang}
            present={new Set((['bn', 'en'] as const).filter((l) => names[l].trim()))}
            invalid={tried && !ready ? new Set([defaultLang]) : undefined}
          >
            {(l) => (
              <div className="flex flex-col gap-4">
                <Field
                  lang={l}
                  label={`${t('categories.name')} (${LANGUAGE_NAMES[l]}${l === defaultLang ? '' : `, ${t('form.optional')}`})`}
                  value={names[l]}
                  maxLength={100}
                  error={tried && l === defaultLang && !ready ? t('form.required') : undefined}
                  onChange={(e) => setNames({ ...names, [l]: e.target.value })}
                />
                <DescriptionField
                  key={l}
                  label={`${t('product.description')} (${LANGUAGE_NAMES[l]})`}
                  lang={l}
                  value={
                    descriptions[l] ??
                    (initial[l]?.description as RichTextDoc | null | undefined) ??
                    null
                  }
                  onChange={(doc) => setDescriptions((d) => ({ ...d, [l]: doc }))}
                />
                {self && (
                  <Field
                    label={`${t('product.slug')} (${LANGUAGE_NAMES[l]})`}
                    hint={t('product.slugHint')}
                    value={slugs[l]}
                    onChange={(e) => setSlugs({ ...slugs, [l]: e.target.value })}
                  />
                )}
              </div>
            )}
          </LanguageTabs>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={parentField} className="text-sm font-medium">
              {t('categories.parent')}
            </label>
            <select
              id={parentField}
              className={cn(control, 'min-h-10 md:min-h-9')}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">{t('categories.topLevel')}</option>
              {parents.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-sm text-muted-foreground">{t('categories.depthHint')}</p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('categories.specs')}</legend>
            <p className="text-sm text-muted-foreground">{t('categories.templateIntro')}</p>
            <div className="grid grid-cols-2 gap-x-3">
              {(attributes.data ?? []).map((a) => (
                <label key={a.id} className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
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
            </div>
          </fieldset>
          {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        </SheetBody>
        <SheetFooter
          start={onDelete && <SheetDelete onClick={onDelete}>{t('action.delete')}</SheetDelete>}
        >
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={save.isPending}>
            {self ? t('action.save') : t('categories.create')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </Sheet>
  );
}
