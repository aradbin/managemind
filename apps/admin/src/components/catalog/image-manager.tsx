// A product's images (phase-2-plan §3.6, §7): add photos (resized on the
// phone, uploaded, registered), reorder them (buttons, so it works with a
// keyboard and a screen reader), set alt text in both languages, remove
// them, and choose a variant's image. At most 10 per product.
import { CATALOG_LIMITS } from '@managemind/shared/catalog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ImageIcon, Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { type Product, productKeys } from '../../lib/catalog';
import { saveErrorMessage } from '../../lib/errors';
import { fileName, ImageError, prepareImage, uploadImage } from '../../lib/images';
import { variantLabel } from '../../pages/products';
import { fieldLabel } from '../field-styles';
import { Notice } from '../notice';
import { useToast } from '../toast';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { LANGUAGE_NAMES, type Lang, otherLang } from './language-tabs';

interface Item {
  mediaId: string;
  file: string | null;
  alt: { bn?: string; en?: string };
}

const fromProduct = (product: Product): Item[] =>
  product.media.map((m) => ({
    mediaId: m.mediaId,
    file: fileName(m),
    alt: { ...m.alt } as Item['alt'],
  }));

export function ImageManager({
  product,
  defaultLang,
  disabled,
}: {
  product: Product;
  defaultLang: Lang;
  disabled?: boolean;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>(() => fromProduct(product));
  const [variantImages, setVariantImages] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(product.variants.map((v) => [v.id, v.imageMediaId])),
  );
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState<string>();
  const [selected, setSelected] = useState<string | null>(null);
  const other = otherLang(defaultLang);
  const room = CATALOG_LIMITS.imagesPerProduct - items.length;

  const change = (next: Item[]) => {
    setItems(next);
    setDirty(true);
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + by, 0, item);
    change(next);
  };

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const chosen = [...files].slice(0, room);
    setUploadError(undefined);
    setUploading({ done: 0, total: chosen.length });
    const added: Item[] = [];
    for (const [i, file] of chosen.entries()) {
      try {
        const media = await uploadImage(await prepareImage(file));
        added.push({
          mediaId: media.id,
          file: fileName(media),
          alt: { ...media.alt } as Item['alt'],
        });
      } catch (e) {
        const reason = e instanceof ImageError ? e.reason : 'upload_failed';
        setUploadError(t(`images.error.${reason}`, { name: file.name }));
      }
      setUploading({ done: i + 1, total: chosen.length });
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = '';
    if (added.length) {
      change([...items, ...added.filter((a) => !items.some((x) => x.mediaId === a.mediaId))]);
      // The first new photo opens, for its alt text.
      setSelected(added[0]?.mediaId ?? null);
    }
  }

  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT('/v1/admin/products/{id}/media', {
          params: { path: { id: product.id } },
          body: {
            images: items.map((i) => ({
              mediaId: i.mediaId,
              alt: { bn: i.alt.bn?.trim() || null, en: i.alt.en?.trim() || null },
            })),
            variantImages: Object.entries(variantImages)
              .filter(([id]) => product.variants.some((v) => v.id === id))
              .map(([variantId, mediaId]) => ({
                variantId,
                mediaId: mediaId && items.some((i) => i.mediaId === mediaId) ? mediaId : null,
              })),
          },
        }),
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['product', product.id], saved);
      for (const k of productKeys()) await queryClient.invalidateQueries({ queryKey: k });
      setItems(fromProduct(saved));
      setDirty(false);
      toast(t('images.saved'));
    },
  });

  const index = items.findIndex((x) => x.mediaId === selected);
  const item = index >= 0 ? items[index] : undefined;
  return (
    <section aria-labelledby="images-heading" className="flex min-w-0 flex-col">
      <span id="images-heading" className={fieldLabel}>
        {t('images.title')}
      </span>
      {/* Tiles as drawn (.mm-ph, .mm-phadd): the first is the main photo. */}
      <ol className="flex flex-wrap gap-2" aria-label={t('images.title')}>
        {items.map((x, i) => (
          <li key={x.mediaId}>
            <button
              type="button"
              aria-pressed={selected === x.mediaId}
              aria-label={i === 0 ? t('images.main') : t('images.position', { n: i + 1 })}
              onClick={() => setSelected(selected === x.mediaId ? null : x.mediaId)}
              className="relative flex size-[72px] items-center justify-center overflow-hidden rounded-[10px] border border-border bg-muted text-muted-foreground aria-pressed:border-2 aria-pressed:border-primary"
            >
              {x.file ? (
                <img
                  src={`/api/admin/media/files/${x.file}`}
                  alt={x.alt[locale] ?? x.alt[otherLang(locale)] ?? ''}
                  className="size-full object-cover"
                />
              ) : (
                <ImageIcon aria-hidden className="size-5" />
              )}
              {i === 0 && (
                <span
                  aria-hidden
                  className="absolute bottom-1 left-1 rounded bg-background px-1 text-[10px] leading-4 font-semibold text-foreground"
                >
                  {t('images.mainShort')}
                </span>
              )}
            </button>
          </li>
        ))}
        {room > 0 && !disabled && (
          <li>
            <button
              type="button"
              disabled={Boolean(uploading)}
              onClick={() => fileInput.current?.click()}
              aria-label={t('images.add')}
              className="flex size-[72px] flex-col items-center justify-center gap-0.5 rounded-[10px] border border-dashed border-input text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Plus aria-hidden className="size-4" />
              {t('images.addShort')}
            </button>
          </li>
        )}
      </ol>
      <input
        ref={fileInput}
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        // The Add tile opens it; screen readers meet only the tile.
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => addFiles(e.target.files)}
      />
      {item && (
        <div className="mt-3 flex flex-col gap-2 rounded-[10px] border border-border p-3">
          <p className="text-[13px] text-muted-foreground">
            {index === 0 ? t('images.main') : t('images.position', { n: index + 1 })}
          </p>
          {[defaultLang, other].map((lang) => (
            <Input
              key={lang}
              lang={lang}
              disabled={disabled}
              aria-label={t('images.alt', { language: LANGUAGE_NAMES[lang], n: index + 1 })}
              placeholder={t('images.alt', { language: LANGUAGE_NAMES[lang], n: index + 1 })}
              value={item.alt[lang] ?? ''}
              onChange={(e) =>
                change(
                  items.map((x) =>
                    x.mediaId === item.mediaId
                      ? { ...x, alt: { ...x.alt, [lang]: e.target.value } }
                      : x,
                  ),
                )
              }
            />
          ))}
          <div className="flex flex-wrap gap-1">
            <Button
              variant="ghost"
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowLeft aria-hidden className="size-4" />
              {t('images.earlier')}
            </Button>
            <Button
              variant="ghost"
              disabled={disabled || index === items.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowRight aria-hidden className="size-4" />
              {t('images.later')}
            </Button>
            <Button
              variant="ghost"
              className="ms-auto text-danger"
              disabled={disabled}
              onClick={() => {
                change(items.filter((x) => x.mediaId !== item.mediaId));
                setSelected(null);
              }}
            >
              <Trash2 aria-hidden className="size-4" />
              {t('images.removeShort')}
            </Button>
          </div>
        </div>
      )}
      {uploading && (
        <p role="status">
          {t('images.uploading', { done: uploading.done, total: uploading.total })}
        </p>
      )}
      {uploadError && <Notice tone="error">{uploadError}</Notice>}
      {product.variants.length > 1 && items.length > 0 && (
        <fieldset className="mt-3 flex flex-col gap-2" disabled={disabled}>
          <legend className="mb-1 font-medium">{t('images.variantImages')}</legend>
          {product.variants.map((v) => (
            <label key={v.id} className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
              <span>{variantLabel(product, v.id, locale)}</span>
              <Select
                className="w-auto"
                value={variantImages[v.id] ?? ''}
                onChange={(next) => {
                  setVariantImages({ ...variantImages, [v.id]: next || null });
                  setDirty(true);
                }}
                options={[
                  { value: '', label: t('images.none') },
                  ...items.map((item, i) => ({
                    value: item.mediaId,
                    label: i === 0 ? t('images.main') : t('images.position', { n: i + 1 }),
                  })),
                ]}
              />
            </label>
          ))}
        </fieldset>
      )}
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {dirty && (
        <div className="mt-3 flex justify-end">
          <Button
            disabled={disabled || save.isPending || Boolean(uploading)}
            onClick={() => save.mutate()}
          >
            {t('images.save')}
          </Button>
        </div>
      )}
    </section>
  );
}
