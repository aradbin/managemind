// A staff member's alerts in this store (phase-5a-plan §3.9): push on this
// device, the devices that get alerts, and which events come by push or
// email. iOS delivers push only to an app added to the Home Screen.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import '../i18n/messages';
import { type AdminKey, useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import { describeDevice } from '../lib/device';
import { errorMessage } from '../lib/errors';
import { Notice } from './notice';
import { Button } from './ui/button';

const pushQuery = {
  queryKey: ['me', 'push'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/me/push')),
};
const alertsQuery = {
  queryKey: ['me', 'alerts'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/me/alerts')),
};

const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function Alerts() {
  const { t } = useLocale();
  return (
    <section aria-labelledby="alerts-h" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="alerts-h" className="text-lg font-semibold">
          {t('alerts.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('alerts.intro')}</p>
      </div>
      <Devices />
      <Choices />
    </section>
  );
}

function Devices() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const push = useQuery(pushQuery);
  const [problem, setProblem] = useState<AdminKey | null>(null);
  const [tested, setTested] = useState<number | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: pushQuery.queryKey });

  const turnOn = useMutation({
    mutationFn: async (publicKey: string) => {
      setProblem(null);
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setProblem('alerts.device.denied');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const json = subscription.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
      unwrap(
        await api.POST('/v1/admin/me/push-devices', {
          body: {
            endpoint: json.endpoint,
            keys: json.keys,
            userAgent: navigator.userAgent.slice(0, 300),
          },
        }),
      );
    },
    onSettled: refresh,
  });
  const test = useMutation({
    mutationFn: async () => unwrap(await api.POST('/v1/admin/me/push-devices/test')),
    onSuccess: (r) => {
      setTested(r.sent);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/v1/admin/me/push-devices/{id}', { params: { path: { id } } })),
    onSettled: refresh,
  });

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">{t('alerts.device')}</h3>
      {push.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : push.isError ? (
        <Notice tone="error">{errorMessage(push.error, t)}</Notice>
      ) : !push.data.publicKey ? (
        <Notice>{t('alerts.device.off')}</Notice>
      ) : !pushSupported() ? (
        <Notice>
          {t(isIos() && !standalone() ? 'alerts.device.ios' : 'alerts.device.unsupported')}
        </Notice>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={turnOn.isPending}
              onClick={() => turnOn.mutate(push.data.publicKey as string)}
            >
              {t('alerts.device.on')}
            </Button>
            {push.data.devices.length > 0 && (
              <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
                {t('alerts.device.test')}
              </Button>
            )}
          </div>
          {problem && <Notice tone="error">{t(problem)}</Notice>}
          {turnOn.isError && <Notice tone="error">{errorMessage(turnOn.error, t)}</Notice>}
          {test.isError && <Notice tone="error">{errorMessage(test.error, t)}</Notice>}
          {tested !== null && <Notice>{t('alerts.device.tested', { count: tested })}</Notice>}
          {push.data.devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('alerts.device.none')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {push.data.devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="font-medium">
                    {describeDevice(d.userAgent ?? undefined) ?? t('alerts.device.unknown')}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(d.id)}
                  >
                    {t('alerts.device.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Choices() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const alerts = useQuery(alertsQuery);
  const save = useMutation({
    mutationFn: async (body: { event: string; push: boolean; email: boolean }[]) =>
      unwrap(await api.PUT('/v1/admin/me/alerts', { body: body as never })),
    onSuccess: (data) => queryClient.setQueryData(alertsQuery.queryKey, data),
  });
  if (alerts.isPending) return <p role="status">{t('loading')}</p>;
  if (alerts.isError) return <Notice tone="error">{errorMessage(alerts.error, t)}</Notice>;
  const choices = alerts.data;
  const toggle = (event: string, channel: 'push' | 'email', on: boolean) =>
    save.mutate(choices.map((c) => (c.event === event ? { ...c, [channel]: on } : c)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">{t('alerts.choices')}</legend>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th scope="col" className="py-2 pe-3 font-medium" />
              <th scope="col" className="px-3 py-2 font-medium">
                {t('alerts.channel.push')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('alerts.channel.email')}
              </th>
            </tr>
          </thead>
          <tbody>
            {choices.map((c) => {
              const label = t(`alerts.event.${c.event}` as AdminKey);
              return (
                <tr key={c.event} className="border-t border-border">
                  <th scope="row" className="py-2 pe-3 text-left font-normal">
                    {label}
                  </th>
                  {(['push', 'email'] as const).map((channel) => (
                    <td key={channel} className="px-3 py-1">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        aria-label={`${label}: ${t(`alerts.channel.${channel}`)}`}
                        checked={c[channel]}
                        disabled={save.isPending}
                        onChange={(e) => toggle(c.event, channel, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {save.isError && <Notice tone="error">{errorMessage(save.error, t)}</Notice>}
      {save.isSuccess && <Notice>{t('alerts.saved')}</Notice>}
    </fieldset>
  );
}
