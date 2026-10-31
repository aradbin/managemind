// Settings → Facebook and Instagram (phase-9-plan §3.1.4, §3.1.6): the
// product feed's switch and its addresses to paste into Commerce Manager,
// its last build, and when sales are reported to Meta. The settings save
// through PATCH /store; the feed's state comes from /channels/meta.
import { defaultMetaSettings, type MetaSettings } from '@managemind/shared/channels';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/channels';
import { api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateTime } from '../lib/orders';

const card = 'flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5';

export const metaQuery = {
  queryKey: ['channels', 'meta'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/channels/meta')),
};

export function MetaSettingsPage() {
  const { t } = useLocale();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('meta.title')}
        description={t('meta.intro')}
      />
      <MetaForm />
    </div>
  );
}

function MetaForm() {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const store = useQuery(storeSettingsQuery);
  const meta = useQuery(metaQuery);
  const [value, setValue] = useState<MetaSettings>(defaultMetaSettings);
  useEffect(() => {
    if (store.data) setValue(store.data.meta);
  }, [store.data]);
  const save = useMutation({
    // The feed's key is the server's: it is never sent.
    mutationFn: async () =>
      unwrap(
        await api.PATCH('/v1/admin/store', {
          body: {
            meta: {
              feed: { enabled: value.feed.enabled },
              purchaseAt: value.purchaseAt,
              deliveredEvent: value.deliveredEvent,
            },
          },
        }),
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(storeSettingsQuery.queryKey, saved);
      void queryClient.invalidateQueries({ queryKey: metaQuery.queryKey });
      toast(t('meta.saved'));
    },
  });
  if (store.isPending || meta.isPending) return <p role="status">{t('loading')}</p>;
  if (store.isError) return <Notice tone="error">{errorMessage(store.error, t)}</Notice>;
  if (meta.isError) return <Notice tone="error">{errorMessage(meta.error, t)}</Notice>;
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <fieldset disabled={!canEdit || save.isPending} className="contents">
        <section aria-labelledby="meta-feed" className={card}>
          <h2 id="meta-feed" className="font-semibold">
            {t('meta.feed')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('meta.feed.intro')}</p>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={value.feed.enabled}
              onChange={(e) =>
                setValue((v) => ({ ...v, feed: { ...v.feed, enabled: e.target.checked } }))
              }
            />
            {t('meta.feed.on')}
          </label>
          {meta.data?.feed.urls && <FeedState />}
        </section>
        <section aria-labelledby="meta-events" className={card}>
          <h2 id="meta-events" className="font-semibold">
            {t('meta.events')}
          </h2>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('meta.purchaseAt')}</legend>
            {(['placed', 'confirmed'] as const).map((at) => (
              <label key={at} className="flex min-h-11 items-start gap-3">
                <input
                  type="radio"
                  name="purchase-at"
                  className="mt-1 size-5"
                  checked={value.purchaseAt === at}
                  onChange={() => setValue((v) => ({ ...v, purchaseAt: at }))}
                />
                {t(`meta.purchaseAt.${at}` as AdminKey)}
              </label>
            ))}
          </fieldset>
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={value.deliveredEvent}
              onChange={(e) => setValue((v) => ({ ...v, deliveredEvent: e.target.checked }))}
            />
            <span className="flex flex-col">
              {t('meta.deliveredEvent')}
              <span className="text-sm text-muted-foreground">{t('meta.deliveredEvent.hint')}</span>
            </span>
          </label>
        </section>
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        {canEdit && (
          <Button type="submit" className="self-start">
            {t('meta.save')}
          </Button>
        )}
      </fieldset>
    </form>
  );
}

/** The feed's addresses, its last build, and Rebuild and Change the address. */
function FeedState() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const meta = useQuery(metaQuery);
  const [rotating, setRotating] = useState(false);
  const refresh = (data: Awaited<ReturnType<typeof metaQuery.queryFn>>) =>
    queryClient.setQueryData(metaQuery.queryKey, data);
  const rebuild = useMutation({
    mutationFn: async () => unwrap(await api.POST('/v1/admin/channels/meta/feed/rebuild')),
    onSuccess: (data) => {
      refresh(data);
      toast(t('meta.feed.rebuilding'));
    },
  });
  const rotate = useMutation({
    mutationFn: async () => unwrap(await api.POST('/v1/admin/channels/meta/feed/key')),
    onSuccess: (data) => {
      refresh(data);
      setRotating(false);
      toast(t('meta.feed.rotated'));
    },
  });
  const feed = meta.data?.feed;
  if (!feed?.urls) return null;
  const urls: [AdminKey, string][] = [
    ['meta.feed.urlDefault', feed.urls.default],
    ['meta.feed.urlBn', feed.urls.bn],
    ['meta.feed.urlEn', feed.urls.en],
  ];
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{t('meta.feed.urls')}</h3>
      {urls.map(([label, url]) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="text-sm">{t(label)}</span>
          <div className="flex gap-2">
            <Input readOnly value={url} aria-label={t(label)} className="font-mono text-xs" />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                toast(t('meta.feed.copied'));
              }}
            >
              {t('meta.feed.copy')}
            </Button>
          </div>
        </div>
      ))}
      <p className="text-sm text-muted-foreground">{t('meta.feed.steps')}</p>
      <div role="status" className="flex flex-col gap-1 text-sm">
        <p>
          {feed.builtAt
            ? t('meta.feed.builtAt', { date: dateTime(locale, feed.builtAt), count: feed.rows })
            : t('meta.feed.notBuilt')}
        </p>
        {feed.dirtySince && (
          <p>{t('meta.feed.pending', { date: dateTime(locale, feed.dirtySince) })}</p>
        )}
        {Object.entries(feed.skipped).map(([reason, count]) => (
          <p key={reason}>{t(`meta.feed.skipped.${reason}` as AdminKey, { count })}</p>
        ))}
      </div>
      {feed.lastError && (
        <Notice tone="error">{t('meta.feed.error', { error: feed.lastError })}</Notice>
      )}
      {(rebuild.isError || rotate.isError) && (
        <Notice tone="error">{errorMessage(rebuild.error ?? rotate.error, t)}</Notice>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={rebuild.isPending}
            onClick={() => rebuild.mutate()}
          >
            {t('meta.feed.rebuild')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRotating(true)}>
            {t('meta.feed.rotate')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={rotating}
        onOpenChange={setRotating}
        title={t('meta.feed.rotate')}
        confirmLabel={t('meta.feed.rotate')}
        busy={rotate.isPending}
        onConfirm={() => rotate.mutate()}
      >
        <p>{t('meta.feed.rotateConfirm')}</p>
      </ConfirmDialog>
    </div>
  );
}
