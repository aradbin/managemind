// Settings → Notifications (phase-5a-plan §3.6–§3.8, §7): which updates
// shoppers get by SMS and by email, and the store's own email sender. Without
// one, email goes from the platform's sender, within its daily share.
import { type NotificationSettings, SHOPPER_EVENTS } from '@managemind/shared/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/messages';
import { api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { credentialsQuery, fieldErrors } from '../lib/messaging';
import { dateTime } from '../lib/orders';

export function NotificationSettingsPage() {
  const { t } = useLocale();
  const canRead = usePermission('orders.read');
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <PageHeader title={t('notify.title')} description={t('notify.intro')} />
      <ShopperChannels />
      <SmsGateway />
      <StoreEmail />
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        <li>
          <Link
            to="/settings/templates"
            className="flex min-h-14 items-center gap-3 p-4 hover:bg-muted"
          >
            <span className="flex flex-1 flex-col">
              <span className="font-medium">{t('templates.title')}</span>
              <span className="text-sm text-muted-foreground">{t('templates.description')}</span>
            </span>
            <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
          </Link>
        </li>
        {canRead && (
          <li>
            <Link
              to="/settings/messages"
              className="flex min-h-14 items-center gap-3 p-4 hover:bg-muted"
            >
              <span className="flex flex-1 flex-col">
                <span className="font-medium">{t('log.title')}</span>
                <span className="text-sm text-muted-foreground">{t('log.description')}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
            </Link>
          </li>
        )}
      </ul>
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
  useEffect(() => {
    if (store.data && !value) setValue(store.data.notifications as NotificationSettings);
  }, [store.data, value]);
  const save = useMutation({
    mutationFn: async (notifications: NotificationSettings) =>
      unwrap(await api.PATCH('/v1/admin/store', { body: { notifications } })),
    onSuccess: (saved) => {
      queryClient.setQueryData(storeSettingsQuery.queryKey, saved);
      toast(t('account.saved'));
    },
  });
  if (store.isPending || !value) return <p role="status">{t('loading')}</p>;
  if (store.isError) return <Notice tone="error">{errorMessage(store.error, t)}</Notice>;
  const toggle = (channel: 'sms' | 'email', event: (typeof SHOPPER_EVENTS)[number]) => {
    const list = value[channel].includes(event)
      ? value[channel].filter((e) => e !== event)
      : SHOPPER_EVENTS.filter((e) => e === event || value[channel].includes(e));
    setValue({ ...value, [channel]: list });
  };
  return (
    <form
      aria-labelledby="channels-h"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(value);
      }}
    >
      <h2 id="channels-h" className="text-lg font-semibold">
        {t('notify.shopper')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('notify.shopperHint')}</p>
      <fieldset disabled={!canEdit || save.isPending}>
        <legend className="sr-only">{t('notify.shopper')}</legend>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th scope="col" className="py-2 font-medium">
                {t('notify.event')}
              </th>
              <th scope="col" className="w-20 py-2 text-center font-medium">
                SMS
              </th>
              <th scope="col" className="w-20 py-2 text-center font-medium">
                {t('notify.email')}
              </th>
            </tr>
          </thead>
          <tbody>
            {SHOPPER_EVENTS.map((event) => (
              <tr key={event} className="border-b border-border">
                <th scope="row" className="py-1 font-normal">
                  {t(`message.event.${event}`)}
                </th>
                {(['sms', 'email'] as const).map((channel) => (
                  <td key={channel} className="text-center">
                    <label className="inline-flex size-11 items-center justify-center">
                      <input
                        type="checkbox"
                        className="size-5"
                        aria-label={`${t(`message.event.${event}`)}: ${channel === 'sms' ? 'SMS' : t('notify.email')}`}
                        checked={value[channel].includes(event)}
                        onChange={() => toggle(channel, event)}
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <p className="text-sm text-muted-foreground">{t('notify.smsLater')}</p>
      {save.error && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {canEdit && (
        <div>
          <Button type="submit" disabled={save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      )}
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
  const showForm = editing || !saved;
  const savedFrom = saved ? String(saved.config.from ?? '') : '';
  return (
    <section aria-labelledby="email-h" className="flex flex-col gap-3">
      <h2 id="email-h" className="text-lg font-semibold">
        {t('notify.storeEmail')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('notify.storeEmailHint')}</p>
      {saved && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-4">
          <p className="font-medium">
            {t('notify.sendingFrom', {
              from: savedFrom,
              provider: saved.provider === 'brevo' ? 'Brevo' : 'Resend',
            })}
          </p>
          {saved.checkedAt && (
            <p className="text-sm text-muted-foreground">
              {t('payments.checked', { when: dateTime(locale, saved.checkedAt) })}
            </p>
          )}
          {saved.checkError && (
            <Notice tone="error">{t('notify.emailFailing', { reason: saved.checkError })}</Notice>
          )}
          {!editing && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('payments.change')}
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(true)}>
                {t('payments.remove')}
              </Button>
            </div>
          )}
        </div>
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
          <fieldset disabled={save.isPending} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">{t('notify.provider')}</legend>
              {(['resend', 'brevo'] as const).map((p) => (
                <label key={p} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name="email-provider"
                    className="size-5"
                    checked={provider === p}
                    onChange={() => setProvider(p)}
                  />
                  {p === 'brevo' ? 'Brevo' : 'Resend'}
                </label>
              ))}
            </fieldset>
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
            {saved && (
              <Button
                variant="secondary"
                disabled={save.isPending}
                onClick={() => {
                  setEditing(false);
                  save.reset();
                }}
              >
                {t('action.cancel')}
              </Button>
            )}
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
  const showForm = editing || !saved;
  const incomplete =
    provider === 'sms_http'
      ? !http.url.trim().startsWith('https://') || !http.toField.trim() || !http.messageField.trim()
      : !apiKey.trim() || (provider === 'bulksmsbd' && !senderId.trim());
  const name = (p: string) => t(`sms.provider.${p}` as AdminKey);
  return (
    <section aria-labelledby="sms-h" className="flex flex-col gap-3">
      <h2 id="sms-h" className="text-lg font-semibold">
        {t('sms.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('sms.hint')}</p>
      {saved && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-4">
          <p className="font-medium">{t('sms.connected', { provider: name(saved.provider) })}</p>
          {balance.data?.balance != null && (
            <p className="text-sm text-muted-foreground">
              {t('sms.balance', {
                balance: balance.data.balance.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-BD'),
              })}
            </p>
          )}
          {balance.data?.error && <Notice tone="error">{balance.data.error}</Notice>}
          {saved.checkedAt && (
            <p className="text-sm text-muted-foreground">
              {t('payments.checked', { when: dateTime(locale, saved.checkedAt) })}
            </p>
          )}
          {!editing && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('payments.change')}
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(true)}>
                {t('payments.remove')}
              </Button>
            </div>
          )}
        </div>
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
          <fieldset disabled={save.isPending} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">{t('notify.provider')}</legend>
              {(['sms_net_bd', 'bulksmsbd', 'sms_http'] as const).map((p) => (
                <label key={p} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name="sms-provider"
                    className="size-5"
                    checked={provider === p}
                    onChange={() => setProvider(p)}
                  />
                  {name(p)}
                </label>
              ))}
            </fieldset>
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
                    <label key={m} className="flex min-h-11 items-center gap-2">
                      <input
                        type="radio"
                        name="sms-method"
                        className="size-5"
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
            {saved && (
              <Button
                variant="secondary"
                disabled={save.isPending}
                onClick={() => {
                  setEditing(false);
                  save.reset();
                }}
              >
                {t('action.cancel')}
              </Button>
            )}
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
