// WhatsApp with the store's own Meta app (phase-9-plan §3.2.1, §3.2.3): the
// number's IDs, token and app secret, checked with Meta before they are
// saved; the webhook address and token to paste into the app; and each
// template's review. Stage 3's one-click connection replaces the form.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/channels';
import '../i18n/messages';
import { api, unwrap } from '../lib/api';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { Field } from './field';
import { Notice } from './notice';
import { usePermission } from './permission-gate';
import { useToast } from './toast';
import { Button } from './ui/button';
import { Input } from './ui/input';

const card = 'flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5';

export const whatsappQuery = {
  queryKey: ['channels', 'whatsapp'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/channels/whatsapp')),
};

export function WhatsappCard() {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canConnect = usePermission('settings.credentials');
  const canEdit = usePermission('settings.write');
  const wa = useQuery(whatsappQuery);
  const [form, setForm] = useState({
    phoneNumberId: '',
    wabaId: '',
    accessToken: '',
    appSecret: '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value.trim() }));
  const update = (data: Awaited<ReturnType<typeof whatsappQuery.queryFn>>) =>
    queryClient.setQueryData(whatsappQuery.queryKey, data);
  const connect = useMutation({
    mutationFn: async () => unwrap(await api.PUT('/v1/admin/channels/whatsapp', { body: form })),
    onSuccess: (data) => {
      update(data);
      setForm((f) => ({ ...f, accessToken: '', appSecret: '' }));
      toast(t('wa.saved'));
    },
  });
  const submit = useMutation({
    mutationFn: async () => unwrap(await api.POST('/v1/admin/channels/whatsapp/templates/submit')),
    onSuccess: update,
  });
  const disconnect = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/v1/admin/channels/whatsapp')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: whatsappQuery.queryKey });
      toast(t('wa.disconnected'));
    },
  });
  if (wa.isPending) return <p role="status">{t('loading')}</p>;
  if (wa.isError) return <Notice tone="error">{errorMessage(wa.error, t)}</Notice>;
  const d = wa.data;
  return (
    <section aria-labelledby="wa-title" className={card}>
      <h2 id="wa-title" className="font-semibold">
        {t('wa.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('wa.intro')}</p>
      {d.connected && (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p>{t('wa.connected', { phone: d.displayPhone ?? '', name: d.verifiedName ?? '' })}</p>
          {d.qualityRating && (
            <p>{t('wa.quality', { quality: d.qualityRating, limit: d.messagingLimit ?? '' })}</p>
          )}
        </div>
      )}
      {d.checkError && <Notice tone="error">{t('wa.failing', { error: d.checkError })}</Notice>}
      {!canConnect && <Notice>{t('wa.ownersOnly')}</Notice>}
      {canConnect && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            connect.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">{t('wa.steps')}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label={t('wa.phoneNumberId')}
              inputMode="numeric"
              value={form.phoneNumberId}
              placeholder={d.phoneNumberId ?? ''}
              onChange={set('phoneNumberId')}
            />
            <Field
              label={t('wa.wabaId')}
              inputMode="numeric"
              value={form.wabaId}
              placeholder={d.wabaId ?? ''}
              onChange={set('wabaId')}
            />
            <Field
              label={t('wa.token')}
              type="password"
              autoComplete="off"
              value={form.accessToken}
              onChange={set('accessToken')}
            />
            <Field
              label={t('wa.appSecret')}
              type="password"
              autoComplete="off"
              value={form.appSecret}
              onChange={set('appSecret')}
            />
          </div>
          {connect.isError && <Notice tone="error">{saveErrorMessage(connect.error, t)}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={
                !form.phoneNumberId || !form.wabaId || !form.accessToken || connect.isPending
              }
            >
              {t('wa.connect')}
            </Button>
            {d.connected && (
              <Button
                type="button"
                variant="ghost"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                {t('wa.disconnect')}
              </Button>
            )}
          </div>
        </form>
      )}
      {d.webhook && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t('wa.webhook')}</h3>
          <p className="text-sm text-muted-foreground">{t('wa.webhookSteps')}</p>
          <Input
            readOnly
            value={d.webhook.url}
            aria-label={t('wa.webhookUrl')}
            className="font-mono text-xs"
          />
          <Input
            readOnly
            value={d.webhook.verifyToken}
            aria-label={t('wa.verifyToken')}
            className="font-mono text-xs"
          />
        </div>
      )}
      {d.templates.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t('wa.templates')}</h3>
          <p className="text-sm text-muted-foreground">{t('wa.templatesIntro')}</p>
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">{t('wa.template.event')}</th>
                <th className="py-1 font-medium">{t('wa.template.language')}</th>
                <th className="py-1 font-medium">{t('wa.template.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.templates.map((tpl) => (
                <tr key={`${tpl.event}-${tpl.locale}`}>
                  <td className="py-1.5">
                    {tpl.event === 'confirm_request'
                      ? t('wa.event.confirm_request')
                      : t(`message.event.${tpl.event}` as AdminKey)}
                  </td>
                  <td className="py-1.5">{tpl.locale === 'bn' ? 'বাংলা' : 'English'}</td>
                  <td className="py-1.5">
                    {t(`wa.status.${tpl.status}` as AdminKey)}
                    {tpl.reason && ` (${tpl.reason})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
            >
              {t('wa.submit')}
            </Button>
          )}
          {submit.isError && <Notice tone="error">{errorMessage(submit.error, t)}</Notice>}
        </div>
      )}
    </section>
  );
}
