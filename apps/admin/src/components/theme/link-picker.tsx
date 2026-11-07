// Where a theme button goes: a category, collection, product or page by ID
// (so renaming its address never breaks the link), a search, or a URL.
import type { ThemeLink } from '@managemind/shared/storefront';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { categoriesQuery, categoryOptions, collectionsQuery, pick } from '../../lib/catalog';
import { pagesQuery } from '../../lib/online-store';
import { fieldLabel } from '../field-styles';
import { Combobox } from '../ui/combobox';
import { Input } from '../ui/input';
import { chipClass } from '../ui/segmented';

type Kind = ThemeLink['type'];
const KINDS: Kind[] = ['category', 'collection', 'product', 'page', 'search', 'url'];

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
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col">
        <span id={`${id}-kind`} className={fieldLabel}>
          {t('section.link')}
        </span>
        <fieldset
          aria-labelledby={`${id}-kind`}
          disabled={disabled}
          className="m-0 flex flex-wrap gap-1.5 border-0 p-0"
        >
          {(['none', ...KINDS] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={chipClass}
            >
              {t(`section.link.${k}`)}
            </button>
          ))}
        </fieldset>
      </div>
      {value && value.type !== 'search' && value.type !== 'url' && (
        <div className="flex flex-col">
          <label htmlFor={`${id}-target`} className={fieldLabel}>
            {t('section.linkTarget')}
          </label>
          <Combobox
            id={`${id}-target`}
            searchLabel={t('section.findTarget')}
            placeholder="—"
            disabled={disabled}
            value={value.id}
            options={targets.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(target) => onChange({ ...value, id: target })}
          />
        </div>
      )}
      {value?.type === 'search' && (
        <div className="flex flex-col">
          <label htmlFor={`${id}-q`} className={fieldLabel}>
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
        <div className="flex flex-col">
          <label htmlFor={`${id}-url`} className={fieldLabel}>
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
