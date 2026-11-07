// Settings → Notifications (phase-5a-plan §3.6–§3.8, §7): which updates
// shoppers get by SMS and by email, and the store's own email sender. Without
// one, email goes from the platform's sender, within its daily share.
import {
  type NotificationSettings,
  SHOPPER_EVENTS,
  WHATSAPP_EVENTS,
} from '@managemind/shared/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, PenLine, Plus, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { ChoiceChips } from '../components/ui/segmented';
import { Switch, SwitchRow } from '../components/ui/switch';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/messages';
import { api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { credentialsQuery, fieldErrors } from '../lib/messaging';
import { dateTime } from '../lib/orders';
import { cn } from '../lib/utils';

export function NotificationSettingsPage() {
  const { t } = useLocale();
  const canRead = usePermission('orders.read');
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('notify.title')}
        description={t('notify.intro')}
      />
      {/* Wording and the log, as two cards above the settings (as drawn). */}
      <ul className="grid gap-3 md:grid-cols-2">
        <li>
          <Link
            to="/settings/templates"
            className="flex h-full gap-3 rounded-[12px] border border-border bg-card p-4 hover:bg-[color-mix(in_oklch,var(--color-muted)_40%,var(--color-card))]"
          >
            <span
              aria-hidden
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
            >
              <PenLine className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{t('templates.title')}</span>
              <span className="text-[13px] text-muted-foreground">
                {t('templates.description')}
              </span>
            </span>
          </Link>
        </li>
        {canRead && (
          <li>
            <Link
              to="/settings/messages"
              className="flex h-full gap-3 rounded-[12px] border border-border bg-card p-4 hover:bg-[color-mix(in_oklch,var(--color-muted)_40%,var(--color-card))]"
            >
              <span
                aria-hidden
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
              >
                <ScrollText className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{t('log.title')}</span>
                <span className="text-[13px] text-muted-foreground">{t('log.description')}</span>
              </span>
            </Link>
          </li>
        )}
      </ul>
      <ShopperChannels />
      <StoreEmail />
      <SmsGateway />
    </div>
  );
}

function ShopperChannels() {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const store = useQuery(storeSettingsQuery);
  const [value, setValue] = useState<NotificationSettings | null>(null);
  // What was loaded or last saved: the save bar shows once something differs.
  const [snapshot, setSnapshot] = useState('');
  useEffect(() => {
    if (store.data && !value) {
      setValue(store.data.notifications as NotificationSettings);
      setSnapshot(JSON.stringify(store.data.notifications));
    }
  }, [store.data, value]);
  const save = useMutation({
    mutationFn: async (notifications: NotificationSettings) =>
      unwrap(await api.PATCH('/v1/admin/store', { body: { notifications } })),
    onSuccess: (saved) => {
      queryClient.setQueryData(storeSettingsQuery.queryKey, saved);
      setSnapshot(JSON.stringify(saved.notifications));
      toast(t('account.saved'));
    },
  });
  if (store.isPending || !value) return <p role="status">{t('loading')}</p>;
  if (store.isError) return <Notice tone="error">{errorMessage(store.error, t)}</Notice>;
  const toggle = (
    channel: 'sms' | 'email' | 'whatsapp',
    event: (typeof SHOPPER_EVENTS)[number],
  ) => {
    const list = value[channel].includes(event)
      ? value[channel].filter((e) => e !== event)
      : SHOPPER_EVENTS.filter((e) => e === event || value[channel].includes(e));
    setValue({ ...value, [channel]: list });
  };
  const dirty = JSON.stringify(value) !== snapshot;
  const channels = ['email', 'sms', 'whatsapp'] as const;
  const channelName = (c: (typeof channels)[number]) =>
    c === 'email' ? t('notify.email') : c === 'sms' ? 'SMS' : 'WhatsApp';
  return (
    <form
      aria-labelledby="channels-h"
      className={cn(cardPadded, 'gap-3 md:gap-3')}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(value);
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 id="channels-h" className={cardTitle}>
          {t('notify.shopper')}
        </h2>
        <p className="text-[13px] text-muted-foreground">{t('notify.shopperHint')}</p>
      </div>
      <fieldset disabled={!canEdit || save.isPending} className="m-0 border-0 p-0">
        <legend className="sr-only">{t('notify.shopper')}</legend>
        <table className="-mx-4 w-[calc(100%+2rem)] border-collapse md:-mx-5 md:w-[calc(100%+2.5rem)]">
          <thead>
            <tr className="h-9 border-t border-border bg-muted text-[13px] text-muted-foreground">
              <th scope="col" className="px-4 text-left font-medium md:px-5">
                {t('notify.event')}
              </th>
              {channels.map((c) => (
                <th key={c} scope="col" className="w-16 text-center font-medium last:pr-2 md:w-20">
                  {channelName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SHOPPER_EVENTS.map((event) => (
              <tr key={event} className="h-11 border-t border-border">
                <th scope="row" className="px-4 text-left font-normal md:px-5">
                  {t(`message.event.${event}`)}
                </th>
                {channels.map((channel) => (
                  <td key={channel} className="text-center last:pr-2">
                    {/* WhatsApp carries only the updates it has a template for (phase-9-plan §3.2.3). */}
                    {channel === 'whatsapp' &&
                    !(WHATSAPP_EVENTS as readonly string[]).includes(event) ? null : (
                      <Switch
                        aria-label={`${t(`message.event.${event}`)}: ${channelName(channel)}`}
                        className="align-middle"
                        checked={value[channel].includes(event)}
                        onCheckedChange={() => toggle(channel, event)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <p className="text-[13px] text-muted-foreground">{t('notify.smsLater')}</p>
      <SwitchRow
        label={t('notify.whatsappFirst')}
        hint={t('notify.whatsappFirstHint')}
        disabled={!canEdit || save.isPending}
        checked={value.whatsappFirst}
        onCheckedChange={(on) => setValue({ ...value, whatsappFirst: on })}
      />
      {save.error && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      <SaveBar
        show={canEdit && dirty}
        message={t('form.unsaved')}
        discardLabel={t('action.discard')}
        onDiscard={() => {
          save.reset();
          setValue(null);
        }}
        saveLabel={t('action.save')}
        busy={save.isPending}
        onSave={() => save.mutate(value)}
      />
    </form>
  );
}

type EmailProvider = 'resend' | 'brevo';

function StoreEmail() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.credentials');
  const list = useQuery({ ...credentialsQuery, enabled: canEdit });
  const saved = list.data?.find((c) => c.kind === 'email') ?? null;
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<EmailProvider>('resend');
  const [apiKey, setApiKey] = useState('');
  const [from, setFrom] = useState('');
  const [fromName, setFromName] = useState('');
  const [missing, setMissing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: credentialsQuery.queryKey });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT('/v1/admin/credentials/{kind}', {
          params: { path: { kind: 'email' } },
          body: {
            provider,
            secrets: { apiKey: apiKey.trim() },
            config: {
              from: from.trim(),
              ...(fromName.trim() ? { fromName: fromName.trim() } : {}),
            },
          },
        }),
      ),
    onSuccess: async () => {
      setEditing(false);
      setApiKey('');
      toast(t('notify.emailSaved'));
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/credentials/{kind}', { params: { path: { kind: 'email' } } }),
      ),
    onSuccess: async () => {
      setRemoving(false);
      await refresh();
    },
  });
  if (!canEdit) return null;
  if (list.isPending) return <p role="status">{t('loading')}</p>;
  if (list.isError) return <Notice tone="error">{errorMessage(list.error, t)}</Notice>;
  const errors = fieldErrors(save.error);
  const showForm = editing;
  const savedFrom = saved ? String(saved.config.from ?? '') : '';
  return (
    <section aria-labelledby="email-h" className={cn(cardPadded, 'gap-3 md:gap-3')}>
      <div className="flex flex-col gap-1">
        <h2 id="email-h" className={cardTitle}>
          {t('notify.storeEmail')}
        </h2>
        <p className="text-[13px] text-muted-foreground">{t('notify.storeEmailHint')}</p>
      </div>
      {saved && !editing && (
        <>
          <ConnectedLine
            failing={Boolean(saved.checkError)}
            title={t('notify.sendingFrom', {
              from: savedFrom,
              provider: saved.provider === 'brevo' ? 'Brevo' : 'Resend',
            })}
            meta={
              saved.checkedAt
                ? t('payments.checked', { when: dateTime(locale, saved.checkedAt) })
                : undefined
            }
          />
          {saved.checkError && (
            <Notice tone="error">{t('notify.emailFailing', { reason: saved.checkError })}</Notice>
          )}
          <ChangeOrRemove onChange={() => setEditing(true)} onRemove={() => setRemoving(true)} />
        </>
      )}
      {!saved && !editing && (
        <Button variant="secondary" className="self-start" onClick={() => setEditing(true)}>
          <Plus aria-hidden />
          {t('notify.useOwnAddress')}
        </Button>
      )}
      {showForm && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!apiKey.trim() || !from.trim()) {
              setMissing(true);
              return;
            }
            setMissing(false);
            save.mutate();
          }}
        >
          <fieldset disabled={save.isPending} className="m-0 flex flex-col gap-4 border-0 p-0">
            <div className="flex flex-col">
              <span className={fieldLabel}>{t('notify.provider')}</span>
              <ChoiceChips<EmailProvider>
                label={t('notify.provider')}
                value={provider}
                options={[
                  { value: 'resend', label: 'Resend' },
                  { value: 'brevo', label: 'Brevo' },
                ]}
                onChange={setProvider}
              />
            </div>
            <Field
              label={t('notify.apiKey')}
              type="password"
              autoComplete="off"
              value={apiKey}
              maxLength={200}
              onChange={(e) => setApiKey(e.target.value)}
              error={missing && !apiKey.trim() ? t('form.required') : undefined}
            />
            <Field
              label={t('notify.from')}
              hint={t('notify.fromHint')}
              type="email"
              autoComplete="off"
              value={from}
              maxLength={254}
              onChange={(e) => setFrom(e.target.value)}
              error={
                missing && !from.trim()
                  ? t('form.required')
                  : errors['config.from']
                    ? t('form.invalid')
                    : undefined
              }
            />
            <Field
              label={t('notify.fromName')}
              hint={t('notify.fromNameHint')}
              value={fromName}
              maxLength={100}
              onChange={(e) => setFromName(e.target.value)}
            />
          </fieldset>
          {errors.secrets && (
            <Notice tone="error">
              {t('payments.refused', { reason: errors.secrets.message })}
            </Notice>
          )}
          {save.error && !errors.secrets && (
            <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('payments.checking') : t('payments.save')}
            </Button>
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setEditing(false);
                setMissing(false);
                save.reset();
              }}
            >
              {t('action.cancel')}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('notify.removeTitle')}
        confirmLabel={t('payments.remove')}
        busy={remove.isPending}
        error={remove.error ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('notify.removeBody')}</p>
      </ConfirmDialog>
    </section>
  );
}

type SmsProviderName = 'sms_net_bd' | 'bulksmsbd' | 'sms_http';

/** The store's SMS gateway (§3.6): it pays for its own messages. Checked by reading its balance. */
function SmsGateway() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.credentials');
  const list = useQuery({ ...credentialsQuery, enabled: canEdit });
  const saved = list.data?.find((c) => c.kind === 'sms') ?? null;
  const balance = useQuery({
    queryKey: ['sms-balance'],
    queryFn: async () => unwrap(await api.GET('/v1/admin/credentials/sms/balance')),
    enabled: canEdit && saved !== null && saved.provider !== 'sms_http',
    staleTime: 60_000,
  });
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<SmsProviderName>('sms_net_bd');
  const [apiKey, setApiKey] = useState('');
  const [senderId, setSenderId] = useState('');
  const [http, setHttp] = useState({
    url: '',
    method: 'POST' as 'GET' | 'POST',
    toField: 'to',
    messageField: 'message',
    authHeader: '',
    authValue: '',
    successText: '',
  });
  const [missing, setMissing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: credentialsQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: ['sms-balance'] }),
    ]);
  const body = () =>
    provider === 'sms_http'
      ? {
          provider,
          secrets: http.authValue.trim() ? { authValue: http.authValue.trim() } : {},
          config: {
            url: http.url.trim(),
            method: http.method,
            toField: http.toField.trim(),
            messageField: http.messageField.trim(),
            ...(http.authHeader.trim() ? { authHeader: http.authHeader.trim() } : {}),
            ...(http.successText.trim() ? { successText: http.successText.trim() } : {}),
          },
        }
      : {
          provider,
          secrets: { apiKey: apiKey.trim() },
          config: senderId.trim() ? { senderId: senderId.trim() } : {},
        };
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT('/v1/admin/credentials/{kind}', {
          params: { path: { kind: 'sms' } },
          body: body(),
        }),
      ),
    onSuccess: async () => {
      setEditing(false);
      setApiKey('');
      toast(t('sms.saved'));
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/credentials/{kind}', { params: { path: { kind: 'sms' } } }),
      ),
    onSuccess: async () => {
      setRemoving(false);
      await refresh();
    },
  });
  if (!canEdit) return null;
  if (list.isPending) return <p role="status">{t('loading')}</p>;
  if (list.isError) return <Notice tone="error">{errorMessage(list.error, t)}</Notice>;
  const errors = fieldErrors(save.error);
  const showForm = editing;
  const incomplete =
    provider === 'sms_http'
      ? !http.url.trim().startsWith('https://') || !http.toField.trim() || !http.messageField.trim()
      : !apiKey.trim() || (provider === 'bulksmsbd' && !senderId.trim());
  const name = (p: string) => t(`sms.provider.${p}` as AdminKey);
  return (
    <section aria-labelledby="sms-h" className={cn(cardPadded, 'gap-3 md:gap-3')}>
      <div className="flex flex-col gap-1">
        <h2 id="sms-h" className={cardTitle}>
          {t('sms.title')}
        </h2>
        <p className="text-[13px] text-muted-foreground">{t('sms.hint')}</p>
      </div>
      {saved && !editing && (
        <>
          <ConnectedLine
            failing={Boolean(balance.data?.error)}
            title={t('sms.connected', { provider: name(saved.provider) })}
            meta={[
              balance.data?.balance != null &&
                t('sms.balance', {
                  balance: balance.data.balance.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD'),
                }),
              saved.checkedAt && t('payments.checked', { when: dateTime(locale, saved.checkedAt) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          />
          {balance.data?.error && <Notice tone="error">{balance.data.error}</Notice>}
          <ChangeOrRemove onChange={() => setEditing(true)} onRemove={() => setRemoving(true)} />
        </>
      )}
      {!saved && !editing && (
        <Button variant="secondary" className="self-start" onClick={() => setEditing(true)}>
          <Plus aria-hidden />
          {t('sms.connect')}
        </Button>
      )}
      {showForm && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (incomplete) {
              setMissing(true);
              return;
            }
            setMissing(false);
            save.mutate();
          }}
        >
          <fieldset disabled={save.isPending} className="m-0 flex flex-col gap-4 border-0 p-0">
            <div className="flex flex-col">
              <span className={fieldLabel}>{t('notify.provider')}</span>
              <ChoiceChips<SmsProviderName>
                label={t('notify.provider')}
                value={provider}
                options={(['sms_net_bd', 'bulksmsbd', 'sms_http'] as const).map((p) => ({
                  value: p,
                  label: name(p),
                }))}
                onChange={setProvider}
              />
            </div>
            {provider !== 'sms_http' && (
              <>
                <Field
                  label={t('notify.apiKey')}
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  maxLength={200}
                  onChange={(e) => setApiKey(e.target.value)}
                  error={missing && !apiKey.trim() ? t('form.required') : undefined}
                />
                <Field
                  label={t('sms.senderId')}
                  hint={t(
                    provider === 'bulksmsbd' ? 'sms.senderIdRequired' : 'sms.senderIdOptional',
                  )}
                  value={senderId}
                  maxLength={20}
                  onChange={(e) => setSenderId(e.target.value)}
                  error={
                    missing && provider === 'bulksmsbd' && !senderId.trim()
                      ? t('form.required')
                      : undefined
                  }
                />
                {provider === 'bulksmsbd' && <Notice>{t('sms.bulksmsbdIp')}</Notice>}
              </>
            )}
            {provider === 'sms_http' && (
              <>
                <Field
                  label={t('sms.url')}
                  hint={t('sms.urlHint')}
                  type="url"
                  value={http.url}
                  maxLength={500}
                  onChange={(e) => setHttp({ ...http, url: e.target.value })}
                  error={
                    missing && !http.url.trim().startsWith('https://')
                      ? t('form.invalid')
                      : undefined
                  }
                />
                <fieldset className="flex gap-4">
                  <legend className="mb-1 text-sm font-medium">{t('sms.method')}</legend>
                  {(['POST', 'GET'] as const).map((m) => (
                    <label key={m} className="flex min-h-10 items-center gap-2 md:min-h-9">
                      <input
                        type="radio"
                        name="sms-method"
                        checked={http.method === m}
                        onChange={() => setHttp({ ...http, method: m })}
                      />
                      {m}
                    </label>
                  ))}
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t('sms.toField')}
                    value={http.toField}
                    maxLength={50}
                    onChange={(e) => setHttp({ ...http, toField: e.target.value })}
                  />
                  <Field
                    label={t('sms.messageField')}
                    value={http.messageField}
                    maxLength={50}
                    onChange={(e) => setHttp({ ...http, messageField: e.target.value })}
                  />
                  <Field
                    label={t('sms.authHeader')}
                    value={http.authHeader}
                    maxLength={50}
                    onChange={(e) => setHttp({ ...http, authHeader: e.target.value })}
                  />
                  <Field
                    label={t('sms.authValue')}
                    type="password"
                    autoComplete="off"
                    value={http.authValue}
                    maxLength={500}
                    onChange={(e) => setHttp({ ...http, authValue: e.target.value })}
                  />
                </div>
                <Field
                  label={t('sms.successText')}
                  hint={t('sms.successTextHint')}
                  value={http.successText}
                  maxLength={100}
                  onChange={(e) => setHttp({ ...http, successText: e.target.value })}
                />
              </>
            )}
          </fieldset>
          {errors.secrets && (
            <Notice tone="error">
              {t('payments.refused', { reason: errors.secrets.message })}
            </Notice>
          )}
          {save.error && !errors.secrets && (
            <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('payments.checking') : t('payments.save')}
            </Button>
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setEditing(false);
                setMissing(false);
                save.reset();
              }}
            >
              {t('action.cancel')}
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('sms.removeTitle')}
        confirmLabel={t('payments.remove')}
        busy={remove.isPending}
        error={remove.error ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('sms.removeBody')}</p>
      </ConfirmDialog>
    </section>
  );
}

/** A connected account, as drawn: a check (or a warning) beside its line and when it was checked. */
function ConnectedLine({
  title,
  meta,
  failing,
}: {
  title: string;
  meta?: string | undefined;
  failing?: boolean;
}) {
  return (
    <div className="flex gap-2.5">
      {failing ? (
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      ) : (
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {meta && <span className="text-[13px] text-muted-foreground">{meta}</span>}
      </div>
    </div>
  );
}

function ChangeOrRemove({ onChange, onRemove }: { onChange: () => void; onRemove: () => void }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={onChange}>
        {t('payments.change')}
      </Button>
      <Button variant="ghost" className="text-danger hover:text-danger" onClick={onRemove}>
        {t('payments.remove')}
      </Button>
    </div>
  );
}
