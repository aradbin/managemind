// Tags as removable chips, with the store's existing tags suggested as you
// type (phase-2-plan §3.4). Tags are normalized the way the server stores them.
import { CATALOG_LIMITS, normalizeTag } from '@managemind/shared/catalog';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { fieldHint, fieldLabel } from '../field-styles';

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
    <div className="flex min-w-0 flex-col">
      <label htmlFor={id} className={fieldLabel}>
        {t('product.tags')}
      </label>
      {/* The box the canvas draws (.mm-chipbox): the chips, then the input. */}
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input p-[5px_6px] shadow-xs focus-within:ring-[3px] focus-within:ring-ring/50 md:min-h-9 md:p-[4px_6px]">
        {value.length > 0 && (
          <ul className="contents" aria-label={t('product.tags')}>
            {value.map((tag) => (
              <li
                key={tag}
                className="inline-flex h-7 items-center gap-0.5 rounded-md bg-secondary pr-0.5 pl-2.5 text-[13px] font-medium text-secondary-foreground md:h-6 md:pl-2 md:text-xs"
              >
                {tag}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t('tags.remove', { tag })}
                  className="inline-flex size-6 items-center justify-center rounded hover:bg-foreground/10 md:size-5"
                  onClick={() => onChange(value.filter((x) => x !== tag))}
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id={id}
          list={`${id}-suggestions`}
          disabled={disabled}
          value={draft}
          placeholder={t('tags.add')}
          aria-describedby={`${id}-hint`}
          className="h-7 min-w-20 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground focus-visible:shadow-none md:h-6 md:text-sm"
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
      </div>
      <datalist id={`${id}-suggestions`}>
        {(suggestions.data ?? []).map((s) => (
          <option key={s.tag} value={s.tag} />
        ))}
      </datalist>
      <p id={`${id}-hint`} className={fieldHint}>
        {t('tags.hint')}
      </p>
    </div>
  );
}
