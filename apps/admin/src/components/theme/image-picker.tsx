// A theme image (logo, favicon, banner): upload a photo, resized on the
// phone like product photos (banners up to 1600 px wide), or remove it.
import { BANNER_WIDTHS, MEDIA_WIDTHS } from '@managemind/shared/catalog';
import { useQuery } from '@tanstack/react-query';
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

  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label} <span className="font-normal text-muted-foreground">({t('form.optional')})</span>
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
          {file && (
            <img src={`/api/admin/media/files/${file}`} alt="" className="size-full object-cover" />
          )}
        </div>
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
        <Button
          variant="secondary"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          {busy
            ? t('theme.image.uploading')
            : mediaId
              ? t('theme.image.replace')
              : t('theme.image.choose')}
        </Button>
        {mediaId && (
          <Button variant="ghost" disabled={disabled || busy} onClick={() => onChange(null)}>
            {t('theme.image.remove')}
          </Button>
        )}
      </div>
      {failed && <Notice tone="error">{t('theme.image.failed')}</Notice>}
    </div>
  );
}
