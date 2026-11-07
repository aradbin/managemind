// Settings → Notifications → Templates (phase-5a-plan §3.7, §7): the
// wording of each message, per channel and language. The store's own
// wording replaces the default; Reset goes back to it. The preview fills
// the template with sample values and counts SMS parts.
import { STAFF_EVENTS } from '@managemind/shared/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Field } from '../components/field';
import { fieldHint, fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { Textarea } from '../components/ui/input';
import { ChoiceChips } from '../components/ui/segmented';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/messages';
import { api, unwrap } from '../lib/api';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { fieldErrors, type Template, templatesQuery } from '../lib/messaging';
import { cn } from '../lib/utils';

type Channel = Template['channel'];
type Locale = Template['locale'];

/** A message event's label: shopper updates and staff alerts have their own. */
export const eventLabel = (event: string): AdminKey =>
  ((STAFF_EVENTS as readonly string[]).includes(event)
    ? `alerts.event.${event}`
    : `message.event.${event}`) as AdminKey;

const CHANNEL_ORDER: readonly Channel[] = ['sms', 'email', 'push'];

const channelLabel = (channel: Channel): AdminKey => `templates.channel.${channel}` as AdminKey;

export function TemplatesPage() {
  const { t, locale: uiLocale } = useLocale();
  const list = useQuery(templatesQuery);
  const events = [...new Set((list.data ?? []).map((x) => x.event))];
  const [event, setEvent] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>('sms');
  const [locale, setLocale] = useState<Locale>(uiLocale === 'en' ? 'en' : 'bn');
  const chosenEvent = event ?? events[0] ?? null;
  // SMS first, as drawn.
  const channels = (list.data ?? [])
    .filter((x) => x.event === chosenEvent && x.locale === locale)
    .map((x) => x.channel)
    .sort((a, b) => CHANNEL_ORDER.indexOf(a) - CHANNEL_ORDER.indexOf(b));
  const chosenChannel = channels.includes(channel) ? channel : (channels[0] ?? 'email');
  const template = (list.data ?? []).find(
    (x) => x.event === chosenEvent && x.channel === chosenChannel && x.locale === locale,
  );

  if (list.isPending) return <p role="status">{t('loading')}</p>;
  if (list.isError) return <Notice tone="error">{errorMessage(list.error, t)}</Notice>;
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('templates.title')}
        description={t('templates.intro')}
      />
      <div className="flex flex-col gap-3 md:grid md:grid-cols-[176px_minmax(0,1fr)] md:items-start md:gap-4">
        {/* The messages: a list beside the editor, a select on phones. */}
        <nav
          aria-label={t('templates.message')}
          className="flex flex-col gap-px rounded-[12px] border border-border bg-card p-1.5 max-md:hidden"
        >
          {events.map((e) => (
            <button
              key={e}
              type="button"
              aria-current={e === chosenEvent ? 'true' : undefined}
              onClick={() => setEvent(e)}
              className="flex min-h-8 items-center rounded-lg px-2.5 py-1 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=true]:bg-accent aria-[current=true]:font-medium aria-[current=true]:text-foreground"
            >
              {t(eventLabel(e))}
            </button>
          ))}
        </nav>
        <label className="flex flex-col md:hidden">
          <span className={fieldLabel}>{t('templates.message')}</span>
          <select
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-base shadow-xs dark:bg-white/[0.045]"
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
        {template && chosenEvent && (
          <Editor
            key={`${template.event}:${template.channel}:${template.locale}`}
            template={template}
            title={t(eventLabel(chosenEvent))}
            choices={
              <div className="flex flex-wrap gap-x-5 gap-y-3">
                <div className="flex flex-col">
                  <span className={fieldLabel}>{t('templates.channel')}</span>
                  <ChoiceChips<Channel>
                    label={t('templates.channel')}
                    value={chosenChannel}
                    options={channels.map((c) => ({ value: c, label: t(channelLabel(c)) }))}
                    onChange={setChannel}
                  />
                </div>
                <div className="flex flex-col">
                  <span className={fieldLabel}>{t('templates.language')}</span>
                  <ChoiceChips<Locale>
                    label={t('templates.language')}
                    value={locale}
                    options={[
                      { value: 'bn', label: 'বাংলা' },
                      { value: 'en', label: 'English' },
                    ]}
                    onChange={setLocale}
                  />
                </div>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

function Editor({
  template,
  title,
  choices,
}: {
  template: Template;
  title: string;
  choices: ReactNode;
}) {
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
  const dirty = body !== template.body || (hasSubject && subject !== (template.subject ?? ''));
  return (
    <div className="flex min-w-0 flex-col gap-3 md:gap-4">
      <form
        aria-labelledby="template-h"
        className={cn(cardPadded, 'gap-4 md:gap-4')}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h2 id="template-h" className={cardTitle}>
          {title}
        </h2>
        {choices}
        <fieldset
          disabled={!canEdit || save.isPending}
          className="m-0 flex flex-col gap-4 border-0 p-0"
        >
          {hasSubject && (
            <Field
              label={t('templates.subject')}
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
              error={errors.subject ? t('form.invalid') : undefined}
            />
          )}
          <div className="flex flex-col">
            <label className={fieldLabel} htmlFor="template-body">
              {t('templates.body')}
            </label>
            <Textarea
              id="template-body"
              ref={bodyRef}
              rows={template.channel === 'email' ? 10 : 4}
              maxLength={5000}
              value={body}
              aria-describedby="template-body-e"
              onChange={(e) => setBody(e.target.value)}
            />
            <p id="template-body-e" className={cn(fieldHint, 'text-danger empty:hidden')}>
              {errors.body?.code === 'unknown_variable'
                ? t('templates.unknown', { names: errors.body.message.replace(/^unknown: /, '') })
                : !body.trim()
                  ? t('form.required')
                  : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[13px] text-muted-foreground">{t('templates.insert')}</span>
            {template.variables.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insert(v)}
                className="inline-flex h-7 items-center rounded-full border border-border bg-background px-2.5 font-mono text-xs hover:bg-accent md:h-6"
              >
                {`{${v}}`}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-[13px] text-muted-foreground">
            {template.custom ? t('templates.custom') : t('templates.default')}
          </p>
          {canEdit && template.custom && (
            <Button
              variant="ghost"
              className="-mr-2"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              {t('templates.reset')}
            </Button>
          )}
        </div>
        {(save.error || reset.error) && !errors.body && (
          <Notice tone="error">{saveErrorMessage(save.error ?? reset.error, t)}</Notice>
        )}
        <SaveBar
          show={canEdit && dirty}
          message={t('form.unsaved')}
          discardLabel={t('action.discard')}
          onDiscard={() => {
            setBody(template.body);
            setSubject(template.subject ?? '');
            save.reset();
          }}
          saveLabel={t('action.save')}
          busy={save.isPending}
          saveDisabled={!body.trim()}
          onSave={() => save.mutate()}
        />
      </form>
      <section
        aria-labelledby="preview-h"
        aria-live="polite"
        className="flex flex-col gap-3 rounded-[12px] bg-muted p-4 md:rounded-[14px] md:p-5"
      >
        <h2 id="preview-h" className={cardTitle}>
          {t('templates.preview')}
        </h2>
        {preview.data ? (
          <div className="flex max-w-[85%] flex-col gap-1 self-start rounded-xl border border-border bg-background px-3.5 py-2.5 md:max-w-[75%]">
            {hasSubject && <p className="font-medium">{preview.data.subject}</p>}
            <p className="break-words whitespace-pre-wrap">{preview.data.body}</p>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t('loading')}</p>
        )}
        {sms && (
          <p className={cn('text-xs', sms.parts > 2 ? 'text-danger' : 'text-muted-foreground')}>
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
