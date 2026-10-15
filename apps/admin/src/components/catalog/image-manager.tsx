// A product's images (phase-2-plan §3.6, §7): add photos (resized on the
// phone, uploaded, registered), reorder them (buttons, so it works with a
// keyboard and a screen reader), set alt text in both languages, remove
// them, and choose a variant's image. At most 10 per product.
import { CATALOG_LIMITS } from '@managemind/shared/catalog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useLocale } from '../../i18n';
import { api, unwrap } from '../../lib/api';
import { type Product, productKeys } from '../../lib/catalog';
import { saveErrorMessage } from '../../lib/errors';
import { fileName, ImageError, prepareImage, uploadImage } from '../../lib/images';
import { variantLabel } from '../../pages/products';
import { Notice } from '../notice';
import { useToast } from '../toast';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
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
    if (added.length)
      change([...items, ...added.filter((a) => !items.some((x) => x.mediaId === a.mediaId))]);
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

  return (
    <section aria-labelledby="images-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="images-heading" className="text-lg font-semibold">
          {t('images.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('images.intro', { max: CATALOG_LIMITS.imagesPerProduct })}
        </p>
      </div>
      {items.length > 0 && (
        <ol className="flex flex-col gap-3" aria-label={t('images.title')}>
          {items.map((item, i) => (
            <li
              key={item.mediaId}
              className="flex flex-col gap-3 rounded-md border border-border p-3 md:flex-row"
            >
              {item.file && (
                <img
                  src={`/api/admin/media/files/${item.file}`}
                  alt={item.alt[locale] ?? item.alt[otherLang(locale)] ?? ''}
                  className="size-28 shrink-0 rounded object-cover"
                />
              )}
              <div className="flex flex-1 flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  {i === 0 ? t('images.main') : t('images.position', { n: i + 1 })}
                </p>
                {[defaultLang, other].map((lang) => (
                  <Input
                    key={lang}
                    lang={lang}
                    disabled={disabled}
                    aria-label={t('images.alt', { language: LANGUAGE_NAMES[lang], n: i + 1 })}
                    placeholder={t('images.alt', { language: LANGUAGE_NAMES[lang], n: i + 1 })}
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
              </div>
              <div className="flex gap-1 md:flex-col">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={disabled || i === 0}
                  aria-label={t('images.up', { n: i + 1 })}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={disabled || i === items.length - 1}
                  aria-label={t('images.down', { n: i + 1 })}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={t('images.remove', { n: i + 1 })}
                  onClick={() => change(items.filter((x) => x.mediaId !== item.mediaId))}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {room > 0 && !disabled && (
        <div>
          <input
            ref={fileInput}
            id={inputId}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => addFiles(e.target.files)}
          />
          <Button
            variant="secondary"
            disabled={Boolean(uploading)}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus aria-hidden className="size-4" />
            {t('images.add')}
          </Button>
        </div>
      )}
      {uploading && (
        <p role="status">
          {t('images.uploading', { done: uploading.done, total: uploading.total })}
        </p>
      )}
      {uploadError && <Notice tone="error">{uploadError}</Notice>}
      {product.variants.length > 1 && items.length > 0 && (
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
          <legend className="mb-1 font-medium">{t('images.variantImages')}</legend>
          {product.variants.map((v) => (
            <label key={v.id} className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
              <span>{variantLabel(product, v.id, locale)}</span>
              <select
                className="min-h-11 rounded-md border border-border bg-background px-3"
                value={variantImages[v.id] ?? ''}
                onChange={(e) => {
                  setVariantImages({ ...variantImages, [v.id]: e.target.value || null });
                  setDirty(true);
                }}
              >
                <option value="">{t('images.none')}</option>
                {items.map((item, i) => (
                  <option key={item.mediaId} value={item.mediaId}>
                    {i === 0 ? t('images.main') : t('images.position', { n: i + 1 })}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {dirty && (
        <div>
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
