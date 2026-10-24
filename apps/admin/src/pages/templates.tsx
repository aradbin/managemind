// Settings → Notifications → Templates (phase-5a-plan §3.7, §7): the
// wording of each message, per channel and language. The store's own
// wording replaces the default; Reset goes back to it. The preview fills
// the template with sample values and counts SMS parts.
import { STAFF_EVENTS } from '@managemind/shared/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/messages';
import { api, unwrap } from '../lib/api';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { fieldErrors, type Template, templatesQuery } from '../lib/messaging';

type Channel = Template['channel'];
type Locale = Template['locale'];

/** A message event's label: shopper updates and staff alerts have their own. */
export const eventLabel = (event: string): AdminKey =>
  ((STAFF_EVENTS as readonly string[]).includes(event)
    ? `alerts.event.${event}`
    : `message.event.${event}`) as AdminKey;

const channelLabel = (channel: Channel): AdminKey => `templates.channel.${channel}` as AdminKey;

export function TemplatesPage() {
  const { t, locale: uiLocale } = useLocale();
  const list = useQuery(templatesQuery);
  const events = [...new Set((list.data ?? []).map((x) => x.event))];
  const [event, setEvent] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>('sms');
  const [locale, setLocale] = useState<Locale>(uiLocale === 'en' ? 'en' : 'bn');
  const chosenEvent = event ?? events[0] ?? null;
  const channels = (list.data ?? [])
    .filter((x) => x.event === chosenEvent && x.locale === locale)
    .map((x) => x.channel);
  const chosenChannel = channels.includes(channel) ? channel : (channels[0] ?? 'email');
  const template = (list.data ?? []).find(
    (x) => x.event === chosenEvent && x.channel === chosenChannel && x.locale === locale,
  );

  if (list.isPending) return <p role="status">{t('loading')}</p>;
  if (list.isError) return <Notice tone="error">{errorMessage(list.error, t)}</Notice>;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('templates.title')}
        description={t('templates.intro')}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('templates.message')}
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 font-normal"
            value={chosenEvent ?? ''}
            onChange={(e) => setEvent(e.target.value)}
          >
            {events.map((e) => (
              <option key={e} value={e}>
                {t(eventLabel(e))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('templates.channel')}
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 font-normal"
            value={chosenChannel}
            onChange={(e) => setChannel(e.target.value as Channel)}
          >
            {channels.map((c) => (
              <option key={c} value={c}>
                {t(channelLabel(c))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('templates.language')}
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3 font-normal"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="bn">বাংলা</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      {template && (
        <Editor
          key={`${template.event}:${template.channel}:${template.locale}`}
          template={template}
        />
      )}
    </div>
  );
}

function Editor({ template }: { template: Template }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const [subject, setSubject] = useState(template.subject ?? '');
  const [body, setBody] = useState(template.body);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const hasSubject = template.channel === 'email';
  const draft = {
    event: template.event as never,
    channel: template.channel,
    locale: template.locale,
    ...(hasSubject && subject.trim() ? { subject: subject.trim() } : {}),
    body: body.trim(),
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: templatesQuery.queryKey });

  const preview = useMutation({
    mutationFn: async () => unwrap(await api.POST('/v1/admin/templates/preview', { body: draft })),
  });
  // The preview follows the text, a moment after typing stops.
  useEffect(() => {
    if (!body.trim()) return;
    const timer = setTimeout(() => preview.mutate(), 400);
    return () => clearTimeout(timer);
  }, [subject, body]);

  const save = useMutation({
    mutationFn: async () => unwrap(await api.PUT('/v1/admin/templates', { body: draft })),
    onSuccess: async () => {
      toast(t('account.saved'));
      await refresh();
    },
  });
  const reset = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/templates/{event}/{channel}/{locale}', {
          params: {
            path: { event: template.event, channel: template.channel, locale: template.locale },
          },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      const fresh = queryClient
        .getQueryData<Template[]>(templatesQuery.queryKey)
        ?.find(
          (x) =>
            x.event === template.event &&
            x.channel === template.channel &&
            x.locale === template.locale,
        );
      if (fresh) {
        setSubject(fresh.subject ?? '');
        setBody(fresh.body);
      }
    },
  });

  const insert = (name: string) => {
    const el = bodyRef.current;
    const token = `{${name}}`;
    if (!el) return setBody(body + token);
    const at = el.selectionStart ?? body.length;
    setBody(body.slice(0, at) + token + body.slice(el.selectionEnd ?? at));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const errors = fieldErrors(save.error ?? preview.error);
  const sms = preview.data?.sms;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          {template.custom ? t('templates.custom') : t('templates.default')}
        </p>
        <fieldset disabled={!canEdit || save.isPending} className="flex flex-col gap-4">
          {hasSubject && (
            <Field
              label={t('templates.subject')}
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
              error={errors.subject ? t('form.invalid') : undefined}
            />
          )}
          <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="template-body">
            {t('templates.body')}
          </label>
          <textarea
            id="template-body"
            ref={bodyRef}
            rows={template.channel === 'email' ? 10 : 5}
            maxLength={5000}
            className="rounded-md border border-input bg-background p-3"
            value={body}
            aria-describedby="template-body-e"
            onChange={(e) => setBody(e.target.value)}
          />
          <p id="template-body-e" className="text-sm text-destructive">
            {errors.body?.code === 'unknown_variable'
              ? t('templates.unknown', { names: errors.body.message.replace(/^unknown: /, '') })
              : !body.trim()
                ? t('form.required')
                : ''}
          </p>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{t('templates.variables')}</p>
            <div className="flex flex-wrap gap-2">
              {template.variables.map((v) => (
                <Button
                  key={v}
                  type="button"
                  variant="secondary"
                  className="min-h-9 font-mono text-xs"
                  onClick={() => insert(v)}
                >
                  {`{${v}}`}
                </Button>
              ))}
            </div>
          </div>
        </fieldset>
        {(save.error || reset.error) && !errors.body && (
          <Notice tone="error">{saveErrorMessage(save.error ?? reset.error, t)}</Notice>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending || !body.trim()}>
              {t('action.save')}
            </Button>
            {template.custom && (
              <Button variant="secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>
                {t('templates.reset')}
              </Button>
            )}
          </div>
        )}
      </form>
      <section aria-labelledby="preview-h" aria-live="polite" className="flex flex-col gap-2">
        <h2 id="preview-h" className="font-semibold">
          {t('templates.preview')}
        </h2>
        {preview.data ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-4">
            {hasSubject && <p className="font-medium">{preview.data.subject}</p>}
            <p className="whitespace-pre-wrap break-words">{preview.data.body}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        )}
        {sms && (
          <p
            className={sms.parts > 2 ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
          >
            {t(sms.encoding === 'unicode' ? 'templates.smsUnicode' : 'templates.smsGsm', {
              length: sms.length,
              parts: sms.parts,
            })}
          </p>
        )}
      </section>
    </div>
  );
}
