// Tags as removable chips, with the store's existing tags suggested as you
// type (phase-2-plan §3.4). Tags are normalized the way the server stores them.
import { CATALOG_LIMITS, normalizeTag } from '@managemind/shared/catalog';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { Input } from '../ui/input';

export function TagInput({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  const [draft, setDraft] = useState('');
  const prefix = normalizeTag(draft) ?? '';
  const suggestions = useQuery({
    queryKey: ['tags', prefix],
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/tags', { params: { query: { prefix, limit: 8 } } })),
    enabled: prefix.length > 0,
    staleTime: 60_000,
  });
  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    setDraft('');
    if (!tag || value.includes(tag) || value.length >= CATALOG_LIMITS.tagsPerProduct) return;
    onChange([...value, tag]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {t('product.tags')}{' '}
        <span className="font-normal text-muted-foreground">({t('form.optional')})</span>
      </label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('product.tags')}>
          {value.map((tag) => (
            <li key={tag} className="flex items-center gap-1 rounded-full bg-muted pl-3 text-sm">
              {tag}
              <button
                type="button"
                disabled={disabled}
                aria-label={t('tags.remove', { tag })}
                className="flex size-9 items-center justify-center rounded-full hover:bg-border"
                onClick={() => onChange(value.filter((x) => x !== tag))}
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        list={`${id}-suggestions`}
        disabled={disabled}
        value={draft}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          // A comma ends a tag, as in the spreadsheet.
          if (e.target.value.includes(',')) {
            for (const part of e.target.value.split(',').slice(0, -1)) add(part);
            setDraft(e.target.value.split(',').at(-1) ?? '');
          } else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
      <datalist id={`${id}-suggestions`}>
        {(suggestions.data ?? []).map((s) => (
          <option key={s.tag} value={s.tag} />
        ))}
      </datalist>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {t('tags.hint')}
      </p>
    </div>
  );
}
