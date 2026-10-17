// Where a theme button goes: a category, collection, product or page by ID
// (so renaming its address never breaks the link), a search, or a URL.
import type { ThemeLink } from '@managemind/shared/storefront';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { categoriesQuery, categoryOptions, collectionsQuery, pick } from '../../lib/catalog';
import { pagesQuery } from '../../lib/online-store';
import { Input } from '../ui/input';

type Kind = ThemeLink['type'];
const KINDS: Kind[] = ['category', 'collection', 'product', 'page', 'search', 'url'];
const select =
  'min-h-11 w-full rounded-md border border-border bg-background px-3 text-base disabled:opacity-50';

export function LinkPicker({
  value,
  onChange,
  disabled,
}: {
  value: ThemeLink | null;
  onChange: (link: ThemeLink | null) => void;
  disabled?: boolean | undefined;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const kind = value?.type ?? 'none';
  const categories = useQuery({ ...categoriesQuery, enabled: kind === 'category' });
  const collections = useQuery({ ...collectionsQuery, enabled: kind === 'collection' });
  const products = useQuery({
    queryKey: ['products', 'link-picker'],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/products', {
          params: { query: { status: 'active', limit: 100 } },
        }),
      ),
    enabled: kind === 'product',
  });
  const pages = useQuery({ ...pagesQuery, enabled: kind === 'page' });

  const targets: { id: string; label: string }[] =
    kind === 'category'
      ? categoryOptions(categories.data ?? [], locale)
      : kind === 'collection'
        ? (collections.data ?? []).map((c) => ({
            id: c.id,
            label: pick(c.translations, locale)?.name ?? '—',
          }))
        : kind === 'product'
          ? (products.data?.items ?? []).map((p) => ({
              id: p.id,
              label: pick(p.titles, locale) ?? '—',
            }))
          : kind === 'page'
            ? (pages.data ?? []).map((p) => ({
                id: p.id,
                label: pick(p.translations, locale)?.title ?? '—',
              }))
            : [];

  function setKind(next: string) {
    if (next === 'none') return onChange(null);
    if (next === 'search') return onChange({ type: 'search', q: '' });
    if (next === 'url') return onChange({ type: 'url', url: 'https://' });
    onChange({ type: next as 'category', id: '' });
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-kind`} className="text-sm font-medium">
          {t('section.link')}
        </label>
        <select
          id={`${id}-kind`}
          className={select}
          disabled={disabled}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="none">{t('section.link.none')}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`section.link.${k}`)}
            </option>
          ))}
        </select>
      </div>
      {value && value.type !== 'search' && value.type !== 'url' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-target`} className="text-sm font-medium">
            {t('section.linkTarget')}
          </label>
          <select
            id={`${id}-target`}
            className={select}
            disabled={disabled}
            value={value.id}
            onChange={(e) => onChange({ ...value, id: e.target.value })}
          >
            <option value="" disabled>
              —
            </option>
            {targets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {value?.type === 'search' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-q`} className="text-sm font-medium">
            {t('section.linkSearch')}
          </label>
          <Input
            id={`${id}-q`}
            maxLength={100}
            disabled={disabled}
            value={value.q}
            onChange={(e) => onChange({ type: 'search', q: e.target.value })}
          />
        </div>
      )}
      {value?.type === 'url' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-url`} className="text-sm font-medium">
            {t('section.linkUrl')}
          </label>
          <Input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            maxLength={2048}
            disabled={disabled}
            value={value.url}
            onChange={(e) => onChange({ type: 'url', url: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
