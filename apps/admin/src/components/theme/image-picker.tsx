// A theme image (logo, favicon, banner): upload a photo, resized on the
// phone like product photos (banners up to 1600 px wide), or remove it.
import { BANNER_WIDTHS, MEDIA_WIDTHS } from '@managemind/shared/catalog';
import { useQuery } from '@tanstack/react-query';
import { ImageIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useLocale } from '../../i18n';
import { fileName, prepareImage, uploadImage } from '../../lib/images';
import { mediaQuery } from '../../lib/online-store';
import { Notice } from '../notice';
import { Button } from '../ui/button';

interface Props {
  label: string;
  mediaId: string | null;
  onChange: (mediaId: string | null) => void;
  banner?: boolean;
  disabled?: boolean | undefined;
}

export function ImagePicker({ label, mediaId, onChange, banner = false, disabled }: Props) {
  const { t } = useLocale();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const media = useQuery({ ...mediaQuery(mediaId ? [mediaId] : []), enabled: Boolean(mediaId) });
  const file = mediaId && media.data?.[0] ? fileName(media.data[0], 400) : null;

  async function upload(files: FileList | null) {
    const chosen = files?.[0];
    if (!chosen) return;
    setBusy(true);
    setFailed(false);
    try {
      const image = await prepareImage(chosen, banner ? BANNER_WIDTHS : MEDIA_WIDTHS);
      const saved = await uploadImage(image);
      onChange(saved.id);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const info = mediaId ? media.data?.[0] : undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-input p-3">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground"
        >
          {file ? (
            <img src={`/api/admin/media/files/${file}`} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-4" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span id={`${id}-label`} className="font-medium">
            {label}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {info
              ? `${info.ext.toUpperCase()} · ${info.width} × ${info.height}`
              : t('form.optional')}
          </span>
        </span>
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-labelledby={`${id}-label`}
          disabled={disabled || busy}
          onChange={(e) => upload(e.target.files)}
        />
        {mediaId && (
          <Button
            variant="ghost"
            className="h-8 md:h-8"
            disabled={disabled || busy}
            onClick={() => onChange(null)}
          >
            {t('theme.image.remove')}
          </Button>
        )}
        <Button
          variant="secondary"
          className="h-8 md:h-8"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          {busy
            ? t('theme.image.uploading')
            : mediaId
              ? t('theme.image.replace')
              : t('theme.image.choose')}
        </Button>
      </div>
      {failed && <Notice tone="error">{t('theme.image.failed')}</Notice>}
    </div>
  );
}
