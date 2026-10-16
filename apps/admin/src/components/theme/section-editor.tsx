// One homepage section's settings (phase-3-plan §3.4): texts in both
// languages, images, links, and what each kind of section shows.
import type { RichTextDoc } from '@managemind/shared/rich-text';
import { type ThemeSection, TRUST_ICONS } from '@managemind/shared/storefront';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useLocale } from '../../i18n';
import { categoriesQuery, categoryOptions, collectionsQuery, pick } from '../../lib/catalog';
import { DescriptionField } from '../catalog/description-field';
import { LANGUAGE_NAMES, type Lang, otherLang } from '../catalog/language-tabs';
import { Button } from '../ui/button';
import { ImagePicker } from './image-picker';
import { LinkPicker } from './link-picker';
import { LocalizedField } from './localized-field';

const select =
  'min-h-11 w-full rounded-md border border-border bg-background px-3 text-base disabled:opacity-50';

/** A new section of a kind, with empty texts (the storefront hides empty ones). */
export function newSection(type: ThemeSection['type']): ThemeSection {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) =>
    (b % 36).toString(36),
  ).join('');
  switch (type) {
    case 'hero':
      return {
        type,
        id,
        size: 'large',
        slides: [{ mediaId: null, heading: {}, subheading: {}, button: null }],
      };
    case 'category_grid':
      return { type, id, heading: {}, categoryIds: [] };
    case 'collection_carousel':
      return { type, id, heading: {}, collectionIds: [] };
    case 'product_grid':
      return { type, id, heading: {}, collectionId: null, limit: 8, layout: 'grid' };
    case 'image_with_text':
      return {
        type,
        id,
        mediaId: null,
        heading: {},
        text: {},
        button: null,
        imagePosition: 'start',
      };
    case 'rich_text':
      return { type, id, heading: {}, body: {} };
    case 'trust_badges':
      return { type, id, items: [{ icon: 'cod', title: {}, text: {} }] };
  }
}

function Choice<V extends string>({
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
  disabled?: boolean | undefined;
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

function CheckList({
  legend,
  hint,
  options,
  selected,
  onChange,
  disabled,
}: {
  legend: string;
  hint: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <fieldset
      className="flex flex-col gap-1 rounded-md border border-border p-3"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      <p className="text-sm text-muted-foreground">{hint}</p>
      {options.map((o) => (
        <label key={o.id} className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={selected.includes(o.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, o.id].slice(0, 12)
                  : selected.filter((x) => x !== o.id),
              )
            }
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export function SectionEditor({
  section,
  onChange,
  defaultLang,
  disabled,
}: {
  section: ThemeSection;
  onChange: (section: ThemeSection) => void;
  defaultLang: Lang;
  disabled?: boolean | undefined;
}) {
  const { t, locale } = useLocale();
  const categories = useQuery({ ...categoriesQuery, enabled: section.type === 'category_grid' });
  const collections = useQuery({
    ...collectionsQuery,
    enabled: section.type === 'collection_carousel' || section.type === 'product_grid',
  });
  const collectionOptions = (collections.data ?? []).map((c) => ({
    id: c.id,
    label: pick(c.translations, locale)?.name ?? '—',
  }));
  const common = { defaultLang, disabled: Boolean(disabled) };

  switch (section.type) {
    case 'hero':
      return (
        <div className="flex flex-col gap-4">
          <Choice
            label={t('section.size')}
            value={section.size}
            disabled={disabled}
            options={[
              { value: 'large', label: t('section.size.large') },
              { value: 'compact', label: t('section.size.compact') },
            ]}
            onChange={(size) => onChange({ ...section, size })}
          />
          {section.slides.map((slide, i) => {
            const setSlide = (next: typeof slide) =>
              onChange({ ...section, slides: section.slides.map((s, j) => (j === i ? next : s)) });
            return (
              <fieldset key={i} className="flex flex-col gap-3 rounded-md border border-border p-3">
                <legend className="px-1 font-medium">{t('section.slide', { n: i + 1 })}</legend>
                <ImagePicker
                  banner
                  label={t('section.image')}
                  mediaId={slide.mediaId}
                  disabled={disabled}
                  onChange={(mediaId) => setSlide({ ...slide, mediaId })}
                />
                <LocalizedField
                  {...common}
                  label="section.heading"
                  maxLength={80}
                  value={slide.heading}
                  onChange={(heading) => setSlide({ ...slide, heading })}
                />
                <LocalizedField
                  {...common}
                  label="section.subheading"
                  maxLength={160}
                  value={slide.subheading}
                  onChange={(subheading) => setSlide({ ...slide, subheading })}
                />
                <LinkPicker
                  value={slide.button?.link ?? null}
                  disabled={disabled}
                  onChange={(link) =>
                    setSlide({
                      ...slide,
                      button: link ? { label: slide.button?.label ?? {}, link } : null,
                    })
                  }
                />
                {slide.button && (
                  <LocalizedField
                    {...common}
                    label="section.buttonLabel"
                    maxLength={40}
                    value={slide.button.label}
                    onChange={(label) =>
                      setSlide({
                        ...slide,
                        button: slide.button ? { ...slide.button, label } : null,
                      })
                    }
                  />
                )}
                {section.slides.length > 1 && (
                  <div>
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        onChange({ ...section, slides: section.slides.filter((_, j) => j !== i) })
                      }
                    >
                      {t('section.removeSlide', { n: i + 1 })}
                    </Button>
                  </div>
                )}
              </fieldset>
            );
          })}
          {section.slides.length < 3 && (
            <div>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    ...section,
                    slides: [
                      ...section.slides,
                      { mediaId: null, heading: {}, subheading: {}, button: null },
                    ],
                  })
                }
              >
                {t('section.addSlide')}
              </Button>
            </div>
          )}
        </div>
      );
    case 'category_grid':
      return (
        <div className="flex flex-col gap-4">
          <LocalizedField
            {...common}
            label="section.heading"
            maxLength={80}
            value={section.heading}
            onChange={(heading) => onChange({ ...section, heading })}
          />
          <CheckList
            legend={t('section.categories')}
            hint={t('section.categoriesHint')}
            options={categoryOptions(categories.data ?? [], locale)}
            selected={section.categoryIds}
            disabled={disabled}
            onChange={(categoryIds) => onChange({ ...section, categoryIds })}
          />
        </div>
      );
    case 'collection_carousel':
      return (
        <div className="flex flex-col gap-4">
          <LocalizedField
            {...common}
            label="section.heading"
            maxLength={80}
            value={section.heading}
            onChange={(heading) => onChange({ ...section, heading })}
          />
          <CheckList
            legend={t('section.collections')}
            hint={t('section.collectionsHint')}
            options={collectionOptions}
            selected={section.collectionIds}
            disabled={disabled}
            onChange={(collectionIds) => onChange({ ...section, collectionIds })}
          />
        </div>
      );
    case 'product_grid':
      return (
        <div className="flex flex-col gap-4">
          <LocalizedField
            {...common}
            label="section.heading"
            maxLength={80}
            value={section.heading}
            onChange={(heading) => onChange({ ...section, heading })}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <Choice
              label={t('section.collection')}
              value={section.collectionId ?? ''}
              disabled={disabled}
              options={[
                { value: '', label: t('section.collection.newest') },
                ...collectionOptions.map((c) => ({ value: c.id, label: c.label })),
              ]}
              onChange={(id) => onChange({ ...section, collectionId: id || null })}
            />
            <Choice
              label={t('section.limit')}
              value={String(section.limit)}
              disabled={disabled}
              options={[4, 6, 8, 12, 16, 24].map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(n) => onChange({ ...section, limit: Number(n) })}
            />
            <Choice
              label={t('section.layout')}
              value={section.layout}
              disabled={disabled}
              options={[
                { value: 'grid', label: t('section.layout.grid') },
                { value: 'carousel', label: t('section.layout.carousel') },
              ]}
              onChange={(layout) => onChange({ ...section, layout })}
            />
          </div>
        </div>
      );
    case 'image_with_text':
      return (
        <div className="flex flex-col gap-4">
          <ImagePicker
            banner
            label={t('section.image')}
            mediaId={section.mediaId}
            disabled={disabled}
            onChange={(mediaId) => onChange({ ...section, mediaId })}
          />
          <Choice
            label={t('section.imagePosition')}
            value={section.imagePosition}
            disabled={disabled}
            options={[
              { value: 'start', label: t('section.imagePosition.start') },
              { value: 'end', label: t('section.imagePosition.end') },
            ]}
            onChange={(imagePosition) => onChange({ ...section, imagePosition })}
          />
          <LocalizedField
            {...common}
            label="section.heading"
            maxLength={80}
            value={section.heading}
            onChange={(heading) => onChange({ ...section, heading })}
          />
          <LocalizedField
            {...common}
            multiline
            label="section.text"
            maxLength={600}
            value={section.text}
            onChange={(text) => onChange({ ...section, text })}
          />
          <LinkPicker
            value={section.button?.link ?? null}
            disabled={disabled}
            onChange={(link) =>
              onChange({
                ...section,
                button: link ? { label: section.button?.label ?? {}, link } : null,
              })
            }
          />
          {section.button && (
            <LocalizedField
              {...common}
              label="section.buttonLabel"
              maxLength={40}
              value={section.button.label}
              onChange={(label) =>
                onChange({
                  ...section,
                  button: section.button ? { ...section.button, label } : null,
                })
              }
            />
          )}
        </div>
      );
    case 'rich_text':
      return (
        <div className="flex flex-col gap-4">
          <LocalizedField
            {...common}
            label="section.heading"
            maxLength={80}
            value={section.heading}
            onChange={(heading) => onChange({ ...section, heading })}
          />
          {[defaultLang, otherLang(defaultLang)].map((lang) => (
            <DescriptionField
              key={lang}
              lang={lang}
              label={t('section.body', { language: LANGUAGE_NAMES[lang] })}
              value={(section.body[lang] as RichTextDoc | undefined) ?? null}
              disabled={disabled}
              onChange={(doc) => onChange({ ...section, body: { ...section.body, [lang]: doc } })}
            />
          ))}
        </div>
      );
    case 'trust_badges':
      return (
        <div className="flex flex-col gap-4">
          {section.items.map((item, i) => {
            const setItem = (next: typeof item) =>
              onChange({ ...section, items: section.items.map((x, j) => (j === i ? next : x)) });
            return (
              <fieldset key={i} className="flex flex-col gap-3 rounded-md border border-border p-3">
                <legend className="px-1 font-medium">{t('section.badge', { n: i + 1 })}</legend>
                <Choice
                  label={t('section.icon')}
                  value={item.icon}
                  disabled={disabled}
                  options={TRUST_ICONS.map((icon) => ({
                    value: icon,
                    label: t(`section.icon.${icon}`),
                  }))}
                  onChange={(icon) => setItem({ ...item, icon })}
                />
                <LocalizedField
                  {...common}
                  label="section.badgeTitle"
                  maxLength={40}
                  value={item.title}
                  onChange={(title) => setItem({ ...item, title })}
                />
                <LocalizedField
                  {...common}
                  label="section.badgeText"
                  maxLength={120}
                  value={item.text}
                  onChange={(text) => setItem({ ...item, text })}
                />
                {section.items.length > 1 && (
                  <div>
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        onChange({ ...section, items: section.items.filter((_, j) => j !== i) })
                      }
                    >
                      {t('section.removeBadge', { n: i + 1 })}
                    </Button>
                  </div>
                )}
              </fieldset>
            );
          })}
          {section.items.length < 4 && (
            <div>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    ...section,
                    items: [...section.items, { icon: 'delivery', title: {}, text: {} }],
                  })
                }
              >
                {t('section.addBadge')}
              </Button>
            </div>
          )}
        </div>
      );
  }
}
