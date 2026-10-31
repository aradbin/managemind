// Settings → Couriers (phase-7-plan §3.3, §3.8, §3.9): connect each courier
// with its keys, checked with the courier before they are saved; the
// webhook URL and secret to paste into its panel; and the parcel defaults.
import { COURIER_SECRET_FIELDS } from '@managemind/shared/credentials';
import {
  type Courier,
  type CourierSettings,
  defaultCourierSettings,
  needsAreas,
} from '@managemind/shared/orders';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/couriers';
import { api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { type ConnectedCourier, courierName, couriersQuery } from '../lib/couriers';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { fieldErrors } from '../lib/messaging';
import { dateTime } from '../lib/orders';

const card = 'flex flex-col gap-4 rounded-xl border border-border bg-background p-4 md:p-5';

export function CourierSettingsPage() {
  const { t } = useLocale();
  const canConnect = usePermission('settings.credentials');
  const list = useQuery(couriersQuery);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('couriers.title')}
        description={t('couriers.intro')}
      />
      {!canConnect && <Notice>{t('couriers.ownersOnly')}</Notice>}
      {list.isPending && <p role="status">{t('loading')}</p>}
      {list.isError && <Notice tone="error">{errorMessage(list.error, t)}</Notice>}
      {list.data?.available.map((courier) => (
        <CourierCard
          key={courier}
          courier={courier}
          saved={list.data.connected.find((c) => c.courier === courier) ?? null}
          canConnect={canConnect}
        />
      ))}
      {list.data && <Defaults connected={list.data.connected.map((c) => c.courier)} />}
    </div>
  );
}

function CourierCard({
  courier,
  saved,
  canConnect,
}: {
  courier: Courier;
  saved: ConnectedCourier | null;
  canConnect: boolean;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const name = courierName(courier, t);
  const fields = COURIER_SECRET_FIELDS[courier];
  const [editing, setEditing] = useState(false);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'sandbox' | 'live'>('live');
  const [pickup, setPickup] = useState<number | null>(null);
  const [integration, setIntegration] = useState('');
  const [missing, setMissing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: couriersQuery.queryKey });
  const moded = courier === 'pathao' || courier === 'redx';
  const pickupKey = courier === 'pathao' ? 'storeId' : 'pickupStoreId';
  const body = () => ({
    ...(moded ? { mode } : {}),
    secrets: Object.fromEntries(fields.map((f) => [f, (secrets[f] ?? '').trim()])),
    config: {
      ...(needsAreas(courier) && pickup ? { [pickupKey]: pickup } : {}),
      ...(courier === 'pathao' && integration.trim()
        ? { integrationSecret: integration.trim() }
        : {}),
    },
  });

  const check = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/couriers/{courier}/check', {
          params: { path: { courier } },
          body: body(),
        }),
      ),
    onSuccess: (r) => setPickup(r.pickupStores[0]?.id ?? null),
  });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT('/v1/admin/couriers/{courier}', {
          params: { path: { courier } },
          body: body(),
        }),
      ),
    onSuccess: async () => {
      setEditing(false);
      setSecrets({});
      check.reset();
      toast(t('couriers.saved', { courier: name }));
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(await api.DELETE('/v1/admin/couriers/{courier}', { params: { path: { courier } } })),
    onSuccess: async () => {
      setRemoving(false);
      await refresh();
    },
  });

  const refused = fieldErrors(save.error).secrets ?? fieldErrors(check.error).secrets;
  const showForm = canConnect && (editing || !saved);
  const titleId = `courier-${courier}`;
  return (
    <section aria-labelledby={titleId} className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="font-semibold">
          {name}
        </h2>
        <span className="text-sm text-muted-foreground">
          {saved
            ? saved.mode === 'sandbox'
              ? t('couriers.connectedSandbox')
              : t('couriers.connected')
            : t('couriers.notConnected')}
        </span>
      </div>
      {courier === 'fake' && <Notice>{t('couriers.testNotice')}</Notice>}
      {saved && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {saved.hint && t('couriers.keyEnds', { hint: saved.hint })}
            {saved.checkedAt &&
              ` · ${t('couriers.checked', { when: dateTime(locale, saved.checkedAt) })}`}
          </p>
          {saved.checkError && (
            <Notice tone="error">{t('couriers.failing', { reason: saved.checkError })}</Notice>
          )}
          {canConnect && !editing && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('couriers.change')}
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(true)}>
                {t('couriers.remove')}
              </Button>
            </div>
          )}
          {canConnect && <Webhook courier={courier} name={name} />}
        </div>
      )}
      {showForm && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (fields.some((f) => !(secrets[f] ?? '').trim())) {
              setMissing(true);
              return;
            }
            setMissing(false);
            save.mutate();
          }}
        >
          <fieldset disabled={save.isPending || check.isPending} className="flex flex-col gap-4">
            {fields.map((f) => (
              <Field
                key={f}
                label={t(`couriers.field.${f}` as AdminKey)}
                hint={f === 'password' ? t('couriers.passwordHint') : undefined}
                type={f === 'username' ? 'email' : 'password'}
                autoComplete={f === 'username' ? 'off' : 'new-password'}
                value={secrets[f] ?? ''}
                maxLength={2000}
                onChange={(e) => setSecrets((s) => ({ ...s, [f]: e.target.value }))}
                error={missing && !(secrets[f] ?? '').trim() ? t('form.required') : undefined}
              />
            ))}
            {moded && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">{t('couriers.mode')}</legend>
                {(['sandbox', 'live'] as const).map((m) => (
                  <label key={m} className="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name={`${courier}-mode`}
                      className="size-5"
                      checked={mode === m}
                      onChange={() => setMode(m)}
                    />
                    {t(`couriers.mode.${m}`)}
                  </label>
                ))}
              </fieldset>
            )}
            {courier === 'pathao' && (
              <Field
                label={t('couriers.integration')}
                hint={t('couriers.integrationHint')}
                autoComplete="off"
                value={integration}
                maxLength={100}
                onChange={(e) => setIntegration(e.target.value)}
              />
            )}
            {needsAreas(courier) && (
              <div className="flex flex-col gap-2">
                <label htmlFor={`${courier}-pickup`} className="text-sm font-medium">
                  {t('couriers.pickupStore')}
                </label>
                {check.data?.pickupStores.length ? (
                  <select
                    id={`${courier}-pickup`}
                    className="min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm"
                    value={pickup ?? ''}
                    onChange={(e) => setPickup(Number(e.target.value))}
                  >
                    {check.data.pickupStores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p id={`${courier}-pickup`} className="text-sm text-muted-foreground">
                    {t('couriers.pickupNone')}
                  </p>
                )}
              </div>
            )}
          </fieldset>
          {refused && (
            <Notice tone="error">
              {t('couriers.refused', { courier: name, reason: refused.message })}
            </Notice>
          )}
          {save.error && !refused && (
            <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>
          )}
          <div className="flex flex-wrap gap-2">
            {needsAreas(courier) && (
              <Button
                variant="secondary"
                disabled={check.isPending}
                onClick={() => {
                  if (fields.some((f) => !(secrets[f] ?? '').trim())) {
                    setMissing(true);
                    return;
                  }
                  check.mutate();
                }}
              >
                {check.isPending
                  ? t('couriers.checking', { courier: name })
                  : t('couriers.checkKeys')}
              </Button>
            )}
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('couriers.checking', { courier: name }) : t('couriers.save')}
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
        title={t('couriers.removeTitle', { courier: name })}
        confirmLabel={t('couriers.remove')}
        busy={remove.isPending}
        error={remove.error ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('couriers.removeBody', { courier: name })}</p>
      </ConfirmDialog>
    </section>
  );
}

/** The callback URL and secret, shown on request, each with Copy (§3.3). */
function Webhook({ courier, name }: { courier: Courier; name: string }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState(false);
  const [rotating, setRotating] = useState(false);
  const key = ['courier-webhook', courier] as const;
  const hook = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/couriers/{courier}/webhook', { params: { path: { courier } } }),
      ),
    enabled: shown,
  });
  const rotate = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/couriers/{courier}/webhook-secret', {
          params: { path: { courier } },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setRotating(false);
      toast(t('couriers.webhook.rotated'));
    },
  });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('couriers.copied'));
    } catch {
      // The text stays selectable on the page.
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
      <h3 className="text-sm font-semibold">{t('couriers.webhook.title')}</h3>
      <p className="text-sm text-muted-foreground">
        {t('couriers.webhook.steps', { courier: name })}
      </p>
      {!shown ? (
        <Button variant="secondary" className="self-start" onClick={() => setShown(true)}>
          {t('couriers.webhook.show')}
        </Button>
      ) : hook.data ? (
        <>
          <dl className="flex flex-col gap-2 text-sm">
            {(
              [
                ['couriers.webhook.url', hook.data.url],
                ['couriers.webhook.secret', hook.data.secret],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1">
                <dt className="font-medium">{t(label)}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-background px-2 py-1">{value}</code>
                  <Button variant="ghost" onClick={() => copy(value)}>
                    {t('couriers.copy')}
                  </Button>
                </dd>
              </div>
            ))}
          </dl>
          <Button variant="quiet" className="self-start" onClick={() => setRotating(true)}>
            {t('couriers.webhook.rotate')}
          </Button>
        </>
      ) : hook.isError ? (
        <Notice tone="error">{errorMessage(hook.error, t)}</Notice>
      ) : (
        <p role="status">{t('loading')}</p>
      )}
      <ConfirmDialog
        open={rotating}
        onOpenChange={setRotating}
        title={t('couriers.webhook.rotate')}
        confirmLabel={t('couriers.webhook.rotate')}
        busy={rotate.isPending}
        error={rotate.error ? saveErrorMessage(rotate.error, t) : undefined}
        onConfirm={() => rotate.mutate()}
      >
        <p>{t('couriers.webhook.rotateBody', { courier: name })}</p>
      </ConfirmDialog>
    </div>
  );
}

/** The parcel defaults (§3.8): the store's settings, owners and managers. */
function Defaults({ connected }: { connected: Courier[] }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const store = useQuery(storeSettingsQuery);
  const [value, setValue] = useState<CourierSettings>(defaultCourierSettings);
  const [weight, setWeight] = useState('500');
  useEffect(() => {
    if (!store.data) return;
    setValue(store.data.couriers);
    setWeight(String(store.data.couriers.defaultWeightGrams));
  }, [store.data]);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH('/v1/admin/store', {
          body: { couriers: { ...value, defaultWeightGrams: Number(weight) || 500 } },
        }),
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(storeSettingsQuery.queryKey, saved);
      toast(t('couriers.defaultsSaved'));
    },
  });
  if (!store.data) return null;
  const toggle = (key: 'autoReceive', label: AdminKey, hint?: AdminKey) => (
    <label className="flex min-h-11 items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 size-5"
        checked={value[key]}
        onChange={(e) => setValue((v) => ({ ...v, [key]: e.target.checked }))}
      />
      <span className="flex flex-col">
        {t(label)}
        {hint && <span className="text-sm text-muted-foreground">{t(hint)}</span>}
      </span>
    </label>
  );
  return (
    <section aria-labelledby="courier-defaults" className={card}>
      <h2 id="courier-defaults" className="font-semibold">
        {t('couriers.defaults')}
      </h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={!canEdit || save.isPending} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="courier-default" className="text-sm font-medium">
              {t('couriers.default')}
            </label>
            <select
              id="courier-default"
              className="min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm"
              value={value.default ?? ''}
              onChange={(e) =>
                setValue((v) => ({ ...v, default: (e.target.value || null) as Courier | null }))
              }
            >
              <option value="">{t('couriers.default.first')}</option>
              {connected.map((c) => (
                <option key={c} value={c}>
                  {courierName(c, t)}
                </option>
              ))}
            </select>
          </div>
          <Field
            label={t('couriers.weight')}
            inputMode="numeric"
            value={weight}
            onChange={(e) => setWeight(e.target.value.replace(/\D/g, ''))}
          />
          <Field
            label={t('couriers.note')}
            value={value.note}
            maxLength={200}
            onChange={(e) => setValue((v) => ({ ...v, note: e.target.value }))}
          />
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={value.autoBook === 'on_confirm'}
              onChange={(e) =>
                setValue((v) => ({ ...v, autoBook: e.target.checked ? 'on_confirm' : 'never' }))
              }
            />
            {t('couriers.autoBook')}
          </label>
          {toggle('autoReceive', 'couriers.autoReceive', 'couriers.autoReceiveHint')}
        </fieldset>
        {save.error && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        {canEdit && (
          <Button type="submit" className="self-start" disabled={save.isPending}>
            {t('couriers.save')}
          </Button>
        )}
      </form>
    </section>
  );
}
